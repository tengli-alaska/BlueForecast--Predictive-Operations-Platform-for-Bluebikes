#!/usr/bin/env python3
"""
production_feature_engineering.py
Builds ML feature matrix by joining hourly demand with weather,
station metadata, and holidays, then adds lag and rolling features.
Processes full year at once for accurate lag features.
"""
import math
import argparse
import logging
import subprocess
from datetime import datetime

from pyspark.sql import SparkSession, Window
from pyspark.sql.functions import (
    col, lit, hour, dayofweek, month, year,
    when, coalesce, broadcast,
    lag as spark_lag, avg as spark_avg,
    sum as spark_sum, sin, cos, from_utc_timestamp
)
from pyspark.sql.types import IntegerType, DoubleType

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────
GCS_BUCKET      = "bluebikes-demand-predictor-data"
AGGREGATED_BASE = "aggregated/demand"
WEATHER_PATH    = "processed/weather/weather_hourly.parquet"
STATIONS_PATH   = "raw/metadata/stations/station_capacity_lookup.parquet"
HOLIDAYS_PATH   = "processed/holidays/holidays.parquet"
FEATURES_BASE   = "features/feature_matrix"


def gcs_path_exists(path):
    result = subprocess.run(
        ["gsutil", "-q", "stat", path],
        capture_output=True
    )
    return result.returncode == 0


class FeatureEngineeringPipeline:

    def __init__(self, bucket: str, year: int, run_id: str, force: bool = False):
        self.bucket  = bucket
        self.year    = year
        self.run_id  = run_id
        self.force   = force
        self.spark   = None

    def create_spark_session(self):
        self.spark = (
            SparkSession.builder
            .appName(f"BluebikesFeatures-{self.year}-{self.run_id}")
            .config("spark.driver.memory", "4g")
            .config("spark.sql.shuffle.partitions", "16")
            .getOrCreate()
        )
        self.spark.sparkContext.setLogLevel("WARN")

    def input_path(self):
        return f"gs://{self.bucket}/{AGGREGATED_BASE}/year={self.year}/"

    def output_path(self):
        return f"gs://{self.bucket}/{FEATURES_BASE}/year={self.year}"

    def already_processed(self):
        return gcs_path_exists(f"{self.output_path()}/_SUCCESS")

    # ── Load data ─────────────────────────────────────────────────────────────

    def load_demand(self):
        path = self.input_path()
        logger.info(f"Loading demand from {path}")
        df = self.spark.read.parquet(path)
        logger.info(f"Loaded {df.count():,} demand rows for year={self.year}")
        return df

    def load_weather(self):
        path = f"gs://{self.bucket}/{WEATHER_PATH}"
        logger.info(f"Loading weather from {path}")
        df = self.spark.read.parquet(path)
        df = df.filter(col("year") == self.year)
        logger.info(f"Loaded {df.count():,} weather rows for year={self.year}")
        return df

    def load_stations(self):
        path = f"gs://{self.bucket}/{STATIONS_PATH}"
        logger.info(f"Loading stations from {path}")
        df = self.spark.read.parquet(path)
        logger.info(f"Loaded {df.count():,} station records")
        return df

    def load_holidays(self):
        path = f"gs://{self.bucket}/{HOLIDAYS_PATH}"
        logger.info(f"Loading holidays from {path}")
        df = self.spark.read.parquet(path)
        df = df.filter(col("year") == self.year)
        logger.info(f"Loaded {df.count():,} holiday records for year={self.year}")
        return df

    # ── Join data ─────────────────────────────────────────────────────────────

    def join_weather(self, demand, weather):
        logger.info("Joining weather data")
        from pyspark.sql.functions import from_utc_timestamp, row_number
        from pyspark.sql import Window

        weather_features = weather.select(
            from_utc_timestamp(col("datetime"), "US/Eastern").alias("weather_hour"),
            "temperature_c", "precipitation_mm", "wind_speed_kmh",
            "humidity_pct", "weather_code", "is_precipitation",
            "is_cold", "is_hot", "feels_like_c"
        )

        # Deduplicate by ET hour — handles DST fall-back where 2 UTC hours = same ET hour
        w = Window.partitionBy("weather_hour").orderBy("weather_hour")
        weather_features = weather_features \
            .withColumn("rn", row_number().over(w)) \
            .filter(col("rn") == 1) \
            .drop("rn")

        result = demand.join(
            broadcast(weather_features),
            demand["hour_et"] == weather_features["weather_hour"],
            "left"
        ).drop("weather_hour")

        missing = result.filter(col("temperature_c").isNull()).count()
        logger.info(f"Weather join complete — {missing:,} rows missing weather")
        return result

    def join_stations(self, df, stations):
        logger.info("Joining station capacity")
        capacity = stations.select(
            col("start_station_id"),
            col("capacity").cast(IntegerType())
        ).dropDuplicates(["start_station_id"])  # ← add this
        median_capacity = int(stations.approxQuantile("capacity", [0.5], 0.01)[0])
        result = df.join(
            broadcast(capacity),
            on="start_station_id",
            how="left"
        )
        result = result.withColumn(
            "capacity",
            coalesce(col("capacity"), lit(median_capacity)).cast(IntegerType())
        )
        logger.info(f"Station join complete — median fill capacity={median_capacity}")
        return result

    def join_holidays(self, df, holidays):
        logger.info("Joining holidays")
        holiday_flags = holidays.select(
            col("date").alias("holiday_date"),
            col("is_holiday")
        )
        result = df.join(
            broadcast(holiday_flags),
            df["date"] == holiday_flags["holiday_date"],
            "left"
        ).drop("holiday_date")
        result = result.withColumn(
            "is_holiday",
            coalesce(col("is_holiday"), lit(0)).cast(IntegerType())
        )
        holiday_rows = result.filter(col("is_holiday") == 1).count()
        logger.info(f"Holiday join complete — {holiday_rows:,} holiday rows")
        return result

    # ── Feature engineering ───────────────────────────────────────────────────

    def create_lag_features(self, df):
        logger.info("Creating lag features")
        w = Window.partitionBy("start_station_id").orderBy("hour_et")
        df = df.withColumn("demand_lag_1h",   spark_lag("demand_count", 1).over(w))
        df = df.withColumn("demand_lag_24h",  spark_lag("demand_count", 24).over(w))
        df = df.withColumn("demand_lag_168h", spark_lag("demand_count", 168).over(w))
        for c in ["demand_lag_1h", "demand_lag_24h", "demand_lag_168h"]:
            df = df.withColumn(c, coalesce(col(c), lit(0)).cast(IntegerType()))
        logger.info("Lag features created: 1h, 24h, 168h")
        return df

    def create_rolling_averages(self, df):
        logger.info("Creating rolling average features")
        w3  = Window.partitionBy("start_station_id").orderBy("hour_et").rowsBetween(-3,  -1)
        w6  = Window.partitionBy("start_station_id").orderBy("hour_et").rowsBetween(-6,  -1)
        w24 = Window.partitionBy("start_station_id").orderBy("hour_et").rowsBetween(-24, -1)
        df = df.withColumn("rolling_avg_3h",  spark_avg("demand_count").over(w3))
        df = df.withColumn("rolling_avg_6h",  spark_avg("demand_count").over(w6))
        df = df.withColumn("rolling_avg_24h", spark_avg("demand_count").over(w24))
        for c in ["rolling_avg_3h", "rolling_avg_6h", "rolling_avg_24h"]:
            df = df.withColumn(c, coalesce(col(c), lit(0.0)).cast(DoubleType()))
        logger.info("Rolling averages created: 3h, 6h, 24h")
        return df

    def add_cyclical_encoding(self, df):
        logger.info("Adding cyclical time encodings")
        df = df.withColumn("hour_sin",  sin(lit(2 * math.pi) * col("hour_of_day") / lit(24)))
        df = df.withColumn("hour_cos",  cos(lit(2 * math.pi) * col("hour_of_day") / lit(24)))
        df = df.withColumn("dow_sin",   sin(lit(2 * math.pi) * col("day_of_week") / lit(7)))
        df = df.withColumn("dow_cos",   cos(lit(2 * math.pi) * col("day_of_week") / lit(7)))
        df = df.withColumn("month_sin", sin(lit(2 * math.pi) * col("month") / lit(12)))
        df = df.withColumn("month_cos", cos(lit(2 * math.pi) * col("month") / lit(12)))
        logger.info("Cyclical encodings added: hour, dow, month")
        return df

    # ── Validation ────────────────────────────────────────────────────────────

    def validate(self, df, original_count):
        logger.info("Running validation checks")
        issues = []

        final_count = df.count()
        if final_count != original_count:
            issues.append(f"Row count mismatch: {final_count} vs {original_count}")

        null_target = df.filter(col("demand_count").isNull()).count()
        if null_target > 0:
            issues.append(f"Null demand_count: {null_target}")

        # Check temperature_c with tolerance (edge cases at year boundaries)
        weather_nulls = df.filter(col("temperature_c").isNull()).count()
        if weather_nulls > 0:
            null_pct = weather_nulls / final_count * 100
            if null_pct > 0.1:
                issues.append(f"temperature_c has {weather_nulls:,} nulls ({null_pct:.2f}%)")
            else:
                logger.warning(f"temperature_c has {weather_nulls:,} nulls ({null_pct:.4f}%) — within acceptable threshold")

        # Check all other key features — zero tolerance
        key_features = [
            "capacity", "is_holiday",
            "demand_lag_1h", "demand_lag_24h", "demand_lag_168h",
            "rolling_avg_3h", "rolling_avg_6h", "rolling_avg_24h",
            "hour_sin", "hour_cos"
        ]
        for feat in key_features:
            nulls = df.filter(col(feat).isNull()).count()
            if nulls > 0:
                issues.append(f"{feat} has {nulls:,} nulls")

        if issues:
            raise ValueError(f"Validation FAILED: {issues}")

        total_demand = df.agg(spark_sum("demand_count")).first()[0]
        logger.info(f"Validation PASSED | rows={final_count:,} | total_demand={int(total_demand):,} | columns={len(df.columns)}")
        return True

    # ── Run ───────────────────────────────────────────────────────────────────

    def run(self):
        print(f"[START] feature_engineering | year={self.year} | run_id={self.run_id}")

        if not self.force and self.already_processed():
            print(f"[SKIP] feature_engineering | year={self.year} already exists | use --force to reprocess | status=SKIPPED")
            return

        self.create_spark_session()

        demand         = self.load_demand()
        original_count = demand.count()

        weather  = self.load_weather()
        stations = self.load_stations()
        holidays = self.load_holidays()

        df = self.join_weather(demand, weather)
        df = self.join_stations(df, stations)
        df = self.join_holidays(df, holidays)
        df = self.create_lag_features(df)
        df = self.create_rolling_averages(df)
        df = self.add_cyclical_encoding(df)

        self.validate(df, original_count)

        output_path = self.output_path()
        df.write.mode("overwrite").parquet(output_path)

        final_count = df.count()
        self.spark.stop()
        print(f"[END] feature_engineering | year={self.year} | output={output_path} | rows={final_count:,} | columns={len(df.columns)} | status=OK")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--year",   required=True, type=int, help="Year to process e.g. 2023")
    parser.add_argument("--bucket", default=GCS_BUCKET)
    parser.add_argument("--run_id", default=datetime.utcnow().strftime("%Y%m%dT%H%M%S"))
    parser.add_argument("--force",  action="store_true")
    args = parser.parse_args()

    FeatureEngineeringPipeline(
        bucket  = args.bucket,
        year    = args.year,
        run_id  = args.run_id,
        force   = args.force,
    ).run()


if __name__ == "__main__":
    main()