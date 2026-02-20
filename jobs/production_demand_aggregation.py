#!/usr/bin/env python3
"""
production_demand_aggregation.py
Aggregates cleaned trip data into hourly demand per station.
Processes month by month with skip logic.
"""

import argparse
import logging
import subprocess
from datetime import datetime
from typing import List

from pyspark.sql import SparkSession
from pyspark.sql.functions import (
    col, count, lit, hour, dayofweek, month, year,
    date_format, from_utc_timestamp,
    min as spark_min, max as spark_max,
    when
)
from pyspark.sql.types import (
    StructType, StructField, StringType, TimestampType,
    IntegerType, DoubleType
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────
GCS_BUCKET        = "bluebikes-demand-predictor-data"
CLEANED_BASE      = "cleaned/trips"
AGGREGATED_BASE   = "aggregated/demand"
TIMEZONE          = "US/Eastern"

# ── Schema for reading cleaned trips ─────────────────────────────────────────
TRIP_SCHEMA = StructType([
    StructField("ride_id",             StringType(),    True),
    StructField("rideable_type",       StringType(),    True),
    StructField("started_at",          StringType(),    True),
    StructField("ended_at",            StringType(),    True),
    StructField("start_station_name",  StringType(),    True),
    StructField("start_station_id",    StringType(),    True),
    StructField("end_station_name",    StringType(),    True),
    StructField("end_station_id",      StringType(),    True),
    StructField("start_lat",           DoubleType(),    True),
    StructField("start_lng",           DoubleType(),    True),
    StructField("end_lat",             DoubleType(),    True),
    StructField("end_lng",             DoubleType(),    True),
    StructField("member_casual",       StringType(),    True),
    StructField("started_at_ts",       TimestampType(), True),
    StructField("ended_at_ts",         TimestampType(), True),
])


def gcs_path_exists(path):
    result = subprocess.run(
        ["gsutil", "-q", "stat", path],
        capture_output=True
    )
    return result.returncode == 0


def month_range(start_yyyymm: str, end_yyyymm: str) -> List[str]:
    sy, sm = int(start_yyyymm[:4]), int(start_yyyymm[4:])
    ey, em = int(end_yyyymm[:4]), int(end_yyyymm[4:])
    months = []
    y, m = sy, sm
    while (y, m) <= (ey, em):
        months.append(f"{y:04d}{m:02d}")
        m += 1
        if m == 13:
            m = 1
            y += 1
    return months


class DemandAggregationPipeline:

    def __init__(self, bucket: str, start_yyyymm: str, end_yyyymm: str,
                 run_id: str, force: bool = False):
        self.bucket       = bucket
        self.start_yyyymm = start_yyyymm
        self.end_yyyymm   = end_yyyymm
        self.run_id       = run_id
        self.force        = force
        self.spark        = None

    def create_spark_session(self):
        self.spark = (
            SparkSession.builder
            .appName(f"BluebikesAggregation-{self.run_id}")
            .config("spark.driver.memory", "4g")
            .config("spark.sql.shuffle.partitions", "16")
            .getOrCreate()
        )
        self.spark.sparkContext.setLogLevel("WARN")

    def input_path(self, yyyymm):
        y = yyyymm[:4]
        m = yyyymm[4:]
        return f"gs://{self.bucket}/{CLEANED_BASE}/year={y}/month={m}/"

    def output_path(self, yyyymm):
        y = yyyymm[:4]
        m = yyyymm[4:]
        return f"gs://{self.bucket}/{AGGREGATED_BASE}/year={y}/month={m}"

    def already_processed(self, yyyymm):
        return gcs_path_exists(f"{self.output_path(yyyymm)}/_SUCCESS")

    def process_month(self, yyyymm):
        input_path  = self.input_path(yyyymm)
        output_path = self.output_path(yyyymm)

        logger.info(f"[START] aggregation | month={yyyymm} | input={input_path}")

        # ── Read cleaned trips ────────────────────────────────────────────
        df = self.spark.read.schema(TRIP_SCHEMA).parquet(input_path)
        original_count = df.count()
        logger.info(f"Loaded {original_count:,} trips for month={yyyymm}")

        # ── Convert UTC → Eastern Time, floor to hour ─────────────────────
        df = df.withColumn(
            "started_at_et",
            from_utc_timestamp(col("started_at_ts"), TIMEZONE)
        ).withColumn(
            "hour_et",
            date_format(col("started_at_et"), "yyyy-MM-dd HH:00:00").cast("timestamp")
        )

        # ── Aggregate: count pickups per station per hour ─────────────────
        actual_demand = (
            df.groupBy("start_station_id", "hour_et")
            .agg(count("*").alias("demand_count"))
        )

        # ── Build complete station × hour grid with zero-fill ─────────────
        all_stations = actual_demand.select("start_station_id").distinct()
        date_range   = actual_demand.agg(
            spark_min("hour_et").alias("min_hour"),
            spark_max("hour_et").alias("max_hour")
        ).first()

        all_hours = self.spark.sql(f"""
            SELECT explode(
                sequence(
                    timestamp('{date_range["min_hour"]}'),
                    timestamp('{date_range["max_hour"]}'),
                    interval 1 hour
                )
            ) as hour_et
        """)

        complete_grid = all_stations.crossJoin(all_hours)

        hourly_demand = complete_grid.join(
            actual_demand,
            on=["start_station_id", "hour_et"],
            how="left"
        ).withColumn(
            "demand_count",
            when(col("demand_count").isNull(), lit(0))
            .otherwise(col("demand_count"))
            .cast(IntegerType())
        )

        # ── Add time features ─────────────────────────────────────────────
        hourly_demand = (
            hourly_demand
            .withColumn("date",        col("hour_et").cast("date"))
            .withColumn("year",        year(col("hour_et")))
            .withColumn("month",       month(col("hour_et")))
            .withColumn("day_of_week", dayofweek(col("hour_et")))
            .withColumn("hour_of_day", hour(col("hour_et")))
            .withColumn("is_weekend",
                when(col("day_of_week").isin(1, 7), lit(1)).otherwise(lit(0)))
        )

        # ── Validate ──────────────────────────────────────────────────────
        total_demand = hourly_demand.agg({"demand_count": "sum"}).first()[0]
        match        = int(total_demand) == original_count
        if not match:
            raise ValueError(
                f"Validation FAILED month={yyyymm}: "
                f"demand sum {int(total_demand)} != trip count {original_count}"
            )

        # ── Write output ──────────────────────────────────────────────────
        hourly_demand.write.mode("overwrite").parquet(output_path)
        row_count = hourly_demand.count()

        logger.info(
            f"[END] aggregation | month={yyyymm} | "
            f"output={output_path} | rows={row_count:,} | "
            f"trips={original_count:,} | status=OK"
        )
        return row_count

    def run(self):
        print(f"[START] demand_aggregation | run_id={self.run_id}")
        self.create_spark_session()

        months     = month_range(self.start_yyyymm, self.end_yyyymm)
        total_rows = 0
        skipped    = 0
        processed  = 0

        for yyyymm in months:
            if not self.force and self.already_processed(yyyymm):
                logger.info(f"[SKIP] month={yyyymm} already aggregated | use --force to reprocess")
                skipped += 1
                continue

            rows       = self.process_month(yyyymm)
            total_rows += rows
            processed  += 1

        self.spark.stop()
        print(
            f"[END] demand_aggregation | "
            f"processed={processed} | skipped={skipped} | "
            f"rows_written={total_rows} | status=OK"
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start_yyyymm", required=True)
    parser.add_argument("--end_yyyymm",   required=True)
    parser.add_argument("--bucket",       default=GCS_BUCKET)
    parser.add_argument("--run_id",       default=datetime.utcnow().strftime("%Y%m%dT%H%M%S"))
    parser.add_argument("--force",        action="store_true")
    args = parser.parse_args()

    DemandAggregationPipeline(
        bucket       = args.bucket,
        start_yyyymm = args.start_yyyymm,
        end_yyyymm   = args.end_yyyymm,
        run_id       = args.run_id,
        force        = args.force,
    ).run()


if __name__ == "__main__":
    main()