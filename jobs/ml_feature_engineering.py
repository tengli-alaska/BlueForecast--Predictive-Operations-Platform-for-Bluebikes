#!/usr/bin/env python3
"""
ml_feature_engineering.py
ML team's custom feature engineering layer on top of the base feature matrix.
When feature_set=base, simply copies base features to ml_features path.
When feature_set=extended, adds custom ML features on top.

This job is intentionally separate from the data pipeline's feature engineering.
The data pipeline owns base features. The ML team owns this job.

Adding new features:
    1. Add your feature logic in the `add_extended_features()` method
    2. Set feature_set=extended when triggering the ML DAG
    3. Base features are never modified — only new columns are added here
"""

import argparse
import logging
import subprocess
from datetime import datetime

from pyspark.sql import SparkSession, Window
from pyspark.sql.functions import (
    col, lit, when, lag as spark_lag, avg as spark_avg,
    coalesce, stddev, min as spark_min, max as spark_max
)
from pyspark.sql.types import DoubleType, IntegerType

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

GCS_BUCKET       = "bluebikes-demand-predictor-data"
FEATURES_BASE    = "features/feature_matrix"
ML_FEATURES_BASE = "features/ml_feature_matrix"


def gcs_path_exists(path):
    result = subprocess.run(["gsutil", "-q", "stat", path], capture_output=True)
    return result.returncode == 0


class MLFeatureEngineeringPipeline:

    def __init__(self, bucket: str, train_years: list, feature_set: str,
                 run_id: str, force: bool = False):
        self.bucket      = bucket
        self.train_years = train_years
        self.feature_set = feature_set
        self.run_id      = run_id
        self.force       = force
        self.spark       = None

    def create_spark_session(self):
        self.spark = (
            SparkSession.builder
            .appName(f"BluebikesMLFeatures-{self.run_id}")
            .config("spark.driver.memory", "4g")
            .config("spark.sql.shuffle.partitions", "16")
            .getOrCreate()
        )
        self.spark.sparkContext.setLogLevel("WARN")

    def input_path(self, year):
        return f"gs://{self.bucket}/{FEATURES_BASE}/year={year}/"

    def output_path(self, year):
        return f"gs://{self.bucket}/{ML_FEATURES_BASE}/year={year}"

    def already_processed(self, year):
        return gcs_path_exists(f"{self.output_path(year)}/_SUCCESS")

    def load_features(self, year):
        path = self.input_path(year)
        logger.info(f"Loading base features for year={year} from {path}")
        df = self.spark.read.parquet(path)
        logger.info(f"Loaded {df.count():,} rows for year={year}")
        return df

    # =========================================================================
    # ADD EXTENDED FEATURES HERE
    # This is where the ML team adds custom features on top of the base matrix.
    # Base features are never modified — only new columns are added.
    # =========================================================================

    def add_extended_features(self, df):
        """
        ML team's custom feature extensions.
        Add new features here without modifying the data pipeline.

        Current extended features:
        - demand_lag_2h:       demand 2 hours ago
        - demand_lag_48h:      demand same hour 2 days ago
        - rolling_std_24h:     demand volatility over past 24h
        - demand_change_1h:    difference from 1h lag (momentum)
        - is_peak_hour:        1 if 7-9am or 4-7pm weekday
        - is_summer:           1 if June-August
        - temp_x_hour:         interaction between temperature and hour
        """
        logger.info("Adding extended ML features")

        w     = Window.partitionBy("start_station_id").orderBy("hour_et")
        w24   = Window.partitionBy("start_station_id").orderBy("hour_et").rowsBetween(-24, -1)

        # Additional lag features
        df = df.withColumn("demand_lag_2h",
                           coalesce(spark_lag("demand_count", 2).over(w), lit(0)).cast(IntegerType()))
        df = df.withColumn("demand_lag_48h",
                           coalesce(spark_lag("demand_count", 48).over(w), lit(0)).cast(IntegerType()))

        # Demand volatility
        df = df.withColumn("rolling_std_24h",
                           coalesce(stddev("demand_count").over(w24), lit(0.0)).cast(DoubleType()))

        # Momentum — how much demand changed from last hour
        df = df.withColumn("demand_change_1h",
                           (col("demand_count") - col("demand_lag_1h")).cast(IntegerType()))

        # Peak hour flag (Boston commute patterns)
        df = df.withColumn("is_peak_hour",
                           when(
                               (col("is_weekend") == 0) &
                               (
                                   ((col("hour_of_day") >= 7) & (col("hour_of_day") <= 9)) |
                                   ((col("hour_of_day") >= 16) & (col("hour_of_day") <= 19))
                               ),
                               lit(1)
                           ).otherwise(lit(0)).cast(IntegerType()))

        # Season flag
        df = df.withColumn("is_summer",
                           when(col("month").isin(6, 7, 8), lit(1)).otherwise(lit(0)).cast(IntegerType()))

        # Temperature × hour interaction
        df = df.withColumn("temp_x_hour",
                           (col("temperature_c") * col("hour_of_day")).cast(DoubleType()))

        logger.info("Extended features added: demand_lag_2h, demand_lag_48h, rolling_std_24h, demand_change_1h, is_peak_hour, is_summer, temp_x_hour")
        return df

    def run(self):
        print(f"[START] ml_feature_engineering | years={self.train_years} | feature_set={self.feature_set} | run_id={self.run_id}")

        self.create_spark_session()

        total_rows = 0
        skipped    = 0
        processed  = 0

        for year in self.train_years:
            if not self.force and self.already_processed(year):
                logger.info(f"[SKIP] year={year} ml features already exist | use --force to reprocess")
                skipped += 1
                continue

            df = self.load_features(year)

            if self.feature_set == "extended":
                df = self.add_extended_features(df)
                logger.info(f"year={year} | extended features added | total columns={len(df.columns)}")
            else:
                logger.info(f"year={year} | feature_set=base | passing through without modification")

            output_path = self.output_path(year)
            df.write.mode("overwrite").parquet(output_path)

            count = df.count()
            total_rows += count
            processed  += 1
            logger.info(f"year={year} | output={output_path} | rows={count:,} | columns={len(df.columns)}")

        self.spark.stop()
        print(f"[END] ml_feature_engineering | processed={processed} | skipped={skipped} | rows_written={total_rows} | status=OK")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--train_years",  required=True, help="Comma-separated years e.g. 2023,2024")
    parser.add_argument("--feature_set",  default="base", choices=["base", "extended"])
    parser.add_argument("--bucket",       default=GCS_BUCKET)
    parser.add_argument("--run_id",       default=datetime.utcnow().strftime("%Y%m%dT%H%M%S"))
    parser.add_argument("--force",        action="store_true")
    args = parser.parse_args()

    years = [y.strip() for y in args.train_years.split(",")]

    MLFeatureEngineeringPipeline(
        bucket      = args.bucket,
        train_years = years,
        feature_set = args.feature_set,
        run_id      = args.run_id,
        force       = args.force,
    ).run()


if __name__ == "__main__":
    main()