#!/usr/bin/env python3

import argparse
import logging
import subprocess
from datetime import datetime
from typing import List
from pyspark.sql import SparkSession
from pyspark.sql.functions import (
    col, unix_timestamp, lower, trim,
    hour, dayofweek, month, year, to_timestamp
)
from pyspark.sql.types import (
    StructType, StructField, StringType, DoubleType,
    IntegerType, TimestampType
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

GCS_BUCKET           = "bluebikes-demand-predictor-data"
RAW_TRIPS_BASE       = "raw_enforced/trips"
PROCESSED_CLEAN_BASE = "cleaned/trips"

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


class BluebikesCleaningPipeline:

    def __init__(self, bucket: str, mode: str, start_yyyymm: str,
                 end_yyyymm: str, run_id: str, force: bool = False):
        self.bucket       = bucket
        self.mode         = mode
        self.start_yyyymm = start_yyyymm
        self.end_yyyymm   = end_yyyymm
        self.run_id       = run_id
        self.force        = force
        self.spark        = None

    def create_spark_session(self):
        self.spark = (
            SparkSession.builder
            .appName(f"BluebikesCleaning-{self.run_id}")
            .config("spark.driver.memory", "4g")
            .config("spark.sql.shuffle.partitions", "16")
            .getOrCreate()
        )
        self.spark.sparkContext.setLogLevel("WARN")

    def raw_path(self, yyyymm):
        y = yyyymm[:4]
        m = str(int(yyyymm[4:]))  # strip leading zero: 01 -> 1
        return f"gs://{self.bucket}/{RAW_TRIPS_BASE}/year={y}/month={m}/"

    def output_path(self, yyyymm):
        y = yyyymm[:4]
        m = yyyymm[4:]
        return f"gs://{self.bucket}/{PROCESSED_CLEAN_BASE}/year={y}/month={m}"

    def already_processed(self, yyyymm):
        success_file = f"{self.output_path(yyyymm)}/_SUCCESS"
        return gcs_path_exists(success_file)

    def clean_df(self, df):
        df = df.dropDuplicates(["ride_id"])

        df = df.withColumn("started_at", to_timestamp(col("started_at"))) \
               .withColumn("ended_at",   to_timestamp(col("ended_at")))

        df = df.withColumn(
            "trip_duration_seconds",
            unix_timestamp("ended_at") - unix_timestamp("started_at")
        ).withColumn(
            "trip_duration_minutes",
            col("trip_duration_seconds") / 60
        )

        df = df.filter(
            col("ride_id").isNotNull() &
            col("started_at").isNotNull() &
            col("ended_at").isNotNull() &
            col("start_station_id").isNotNull() &
            col("end_station_id").isNotNull()
        )

        df = df.filter(
            (col("trip_duration_seconds") >= 60) &
            (col("trip_duration_seconds") <= 86400)
        )

        df = df.withColumn("rideable_type",  lower(trim(col("rideable_type")))) \
               .withColumn("member_casual",  lower(trim(col("member_casual"))))

        df = df.withColumn("start_hour",        hour(col("started_at"))) \
               .withColumn("start_day_of_week", dayofweek(col("started_at"))) \
               .withColumn("start_month",       month(col("started_at"))) \
               .withColumn("start_year",        year(col("started_at"))) \
               .withColumn("start_date",        col("started_at").cast("date"))

        return df

    def run(self):
        print(f"[START] cleaning_job | mode={self.mode} | run_id={self.run_id}")
        self.create_spark_session()

        months = [self.end_yyyymm] if self.mode == "incremental" \
                 else month_range(self.start_yyyymm, self.end_yyyymm)

        logger.info(f"Processing months: {months}")

        total_rows    = 0
        skipped       = 0
        processed     = 0

        for yyyymm in months:
            # ── Skip if already processed and not forcing ─────────────────
            if not self.force and self.already_processed(yyyymm):
                logger.info(f"[SKIP] month={yyyymm} already exists | use --force to reprocess")
                skipped += 1
                continue

            input_path  = self.raw_path(yyyymm)
            output_path = self.output_path(yyyymm)
            logger.info(f"[START] month={yyyymm} | input={input_path}")

            df       = self.spark.read.schema(TRIP_SCHEMA).parquet(input_path)
            df_clean = self.clean_df(df)

            df_clean.write.mode("overwrite").parquet(output_path)
            count      = df_clean.count()
            total_rows += count
            processed  += 1
            logger.info(f"[END] month={yyyymm} | output={output_path} | rows={count}")

        self.spark.stop()
        print(f"[END] cleaning_job | processed={processed} | skipped={skipped} | rows_written={total_rows} | status=OK")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode",         required=True, choices=["incremental", "backfill", "demo"])
    parser.add_argument("--start_yyyymm")
    parser.add_argument("--end_yyyymm",   required=True)
    parser.add_argument("--bucket",       default=GCS_BUCKET)
    parser.add_argument("--run_id",       default=datetime.utcnow().strftime("%Y%m%dT%H%M%S"))
    parser.add_argument("--force",        action="store_true", help="Reprocess even if output exists")
    args = parser.parse_args()

    BluebikesCleaningPipeline(
        bucket       = args.bucket,
        mode         = args.mode,
        start_yyyymm = args.start_yyyymm,
        end_yyyymm   = args.end_yyyymm,
        run_id       = args.run_id,
        force        = args.force,
    ).run()


if __name__ == "__main__":
    main()