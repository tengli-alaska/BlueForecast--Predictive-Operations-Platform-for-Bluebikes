#!/usr/bin/env python3
"""
Bluebikes Feature Engineering Pipeline - Production Version

This script builds the complete ML feature matrix by joining hourly demand
data with weather, station metadata, and holiday data, then creating
lag features, rolling averages, and cyclical time encodings.

Pipeline steps:
1. Read hourly demand data (output of demand aggregation pipeline)
2. Join weather data (by hourly timestamp)
3. Join station capacity lookup (by station ID)
4. Join holiday calendar (by date)
5. Create lag features (1h, 24h, 168h)
6. Create rolling averages (3h, 6h, 24h)
7. Add cyclical time encoding (hour, day of week, month)
8. Validate and save feature matrix

Usage:
    Local mode (development):
        python jobs/production_feature_engineering.py --local

    GCS mode (production):
        python jobs/production_feature_engineering.py

Author: Data Engineering Team
Project: Bluebikes Demand Prediction (BlueForecast)
"""

import argparse
import sys
import os
import logging
from datetime import datetime

from pyspark.sql import SparkSession, Window
from pyspark.sql.functions import (
    col, lit, count, hour, dayofweek, month, year,
    date_format, from_utc_timestamp, when, coalesce,
    lag as spark_lag, avg as spark_avg, sin, cos,
    min as spark_min, max as spark_max, sum as spark_sum,
    pi, broadcast
)
from pyspark.sql.types import IntegerType, DoubleType

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class FeatureEngineeringPipeline:
    """
    Production pipeline for building the ML feature matrix.

    Joins hourly demand with weather, station metadata, and holidays,
    then engineers lag features, rolling averages, and cyclical encodings.

    Supports both local filesystem and Google Cloud Storage backends.
    """

    def __init__(self, gcs_bucket="bluebikes-demand-predictor-data", local_mode=False):
        """
        Initialize the feature engineering pipeline.

        Args:
            gcs_bucket (str): Name of the GCS bucket containing data
            local_mode (bool): If True, use local filesystem; if False, use GCS
        """
        self.gcs_bucket = gcs_bucket
        self.local_mode = local_mode
        self.spark = None

        if local_mode:
            logger.info("Pipeline initialized in LOCAL mode (development)")
            self.base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        else:
            logger.info(f"Pipeline initialized in GCS mode with bucket: {gcs_bucket}")

    def _get_path(self, relative_path):
        """
        Resolve path based on local or GCS mode.

        Args:
            relative_path (str): Path relative to project root / bucket root

        Returns:
            str: Full resolved path
        """
        if self.local_mode:
            return os.path.join(self.base_dir, relative_path)
        else:
            return f"gs://{self.gcs_bucket}/{relative_path}"

    def create_spark_session(self):
        """Initialize Apache Spark session with appropriate configuration."""
        logger.info("Initializing Spark session")

        builder = SparkSession.builder \
            .appName("Bluebikes Feature Engineering Pipeline") \
            .config("spark.driver.memory", "4g") \
            .config("spark.sql.shuffle.partitions", "8")

        # Add GCS connector configuration if not in local mode
        if not self.local_mode:
            builder = builder \
                .config("spark.hadoop.fs.gs.impl",
                        "com.google.cloud.hadoop.fs.gcs.GoogleHadoopFileSystem") \
                .config("spark.hadoop.fs.AbstractFileSystem.gs.impl",
                        "com.google.cloud.hadoop.fs.gcs.GoogleHadoopFS")

        self.spark = builder.getOrCreate()
        self.spark.sparkContext.setLogLevel("WARN")
        logger.info(f"Spark {self.spark.version} initialized successfully")

    # =========================================================
    # STEP 1: Load all data sources
    # =========================================================

    def load_demand(self):
        """
        Load hourly demand data (output of demand aggregation pipeline).

        Returns:
            pyspark.sql.DataFrame: Hourly demand per station
        """
        path = self._get_path("processed/features/hourly_demand_by_station")
        logger.info(f"Loading hourly demand from: {path}")

        df = self.spark.read.parquet(path)
        count = df.count()
        logger.info(f"  Loaded {count:,} demand rows")

        return df

    def load_weather(self):
        """
        Load hourly weather data.

        Returns:
            pyspark.sql.DataFrame: Hourly weather records
        """
        path = self._get_path("data/weather/weather_hourly_2023_2024.parquet")
        logger.info(f"Loading weather from: {path}")

        df = self.spark.read.parquet(path)
        count = df.count()
        logger.info(f"  Loaded {count:,} weather rows")

        return df

    def load_station_lookup(self):
        """
        Load station capacity lookup (pre-built mapping of station_id → capacity).

        Returns:
            pyspark.sql.DataFrame: Station ID and capacity
        """
        path = self._get_path("metadata/stations/station_capacity_lookup.parquet")
        logger.info(f"Loading station lookup from: {path}")

        df = self.spark.read.parquet(path)
        count = df.count()
        logger.info(f"  Loaded {count:,} station records")

        return df

    def load_holidays(self):
        """
        Load US holiday calendar.

        Returns:
            pyspark.sql.DataFrame: Holiday dates
        """
        path = self._get_path("data/contextual/us_holidays_2023_2024.parquet")
        logger.info(f"Loading holidays from: {path}")

        df = self.spark.read.parquet(path)
        count = df.count()
        logger.info(f"  Loaded {count:,} holiday records")

        return df

    # =========================================================
    # STEP 2: Join all data sources
    # =========================================================

    def join_weather(self, demand, weather):
        """
        Join weather features to demand data by hourly timestamp.

        Weather columns like 'hour', 'day_of_week', 'month', 'year' overlap
        with demand columns, so we select only the weather-specific features.

        Args:
            demand (pyspark.sql.DataFrame): Hourly demand data
            weather (pyspark.sql.DataFrame): Hourly weather data

        Returns:
            pyspark.sql.DataFrame: Demand with weather features
        """
        logger.info("Joining weather data to demand")

        # Select only weather-specific features (avoid column name conflicts)
        weather_features = weather.select(
            col("datetime").alias("weather_hour"),
            "temperature_c",
            "precipitation_mm",
            "wind_speed_kmh",
            "humidity_pct",
            "weather_code",
            "is_precipitation",
            "is_cold",
            "is_hot",
            "feels_like_c"
        )

        # Join on hourly timestamp
        result = demand.join(
            broadcast(weather_features),
            demand["hour"] == weather_features["weather_hour"],
            "left"
        ).drop("weather_hour")

        # Check for missing weather
        total = result.count()
        missing = result.filter(col("temperature_c").isNull()).count()
        logger.info(f"  Weather join complete: {total:,} rows, {missing:,} missing weather ({missing/total*100:.2f}%)")

        return result

    def join_stations(self, df, station_lookup):
        """
        Join station capacity to demand data by station ID.

        Stations without a match get filled with the median capacity.

        Args:
            df (pyspark.sql.DataFrame): Demand data
            station_lookup (pyspark.sql.DataFrame): Station ID → capacity mapping

        Returns:
            pyspark.sql.DataFrame: Data with station capacity
        """
        logger.info("Joining station metadata")

        # Calculate median capacity for filling unmatched stations
        median_capacity = float(
            station_lookup.approxQuantile("capacity", [0.5], 0.01)[0]
        )
        logger.info(f"  Median capacity for fill: {median_capacity}")

        # Join
        result = df.join(
            broadcast(station_lookup),
            on="start_station_id",
            how="left"
        )

        # Fill missing capacity with median
        missing_before = result.filter(col("capacity").isNull()).count()
        result = result.withColumn(
            "capacity",
            coalesce(col("capacity"), lit(median_capacity)).cast(IntegerType())
        )

        logger.info(f"  Station join complete: {missing_before:,} rows filled with median capacity")

        return result

    def join_holidays(self, df, holidays):
        """
        Join holiday flags to demand data by date.

        Non-holiday dates get filled with 0.

        Args:
            df (pyspark.sql.DataFrame): Demand data with 'date' column
            holidays (pyspark.sql.DataFrame): Holiday dates with 'is_holiday' flag

        Returns:
            pyspark.sql.DataFrame: Data with holiday flag
        """
        logger.info("Joining holiday data")

        # Select only date and is_holiday
        holiday_flags = holidays.select(
            col("date").alias("holiday_date"),
            col("is_holiday")
        )

        # Join on date
        result = df.join(
            broadcast(holiday_flags),
            df["date"] == holiday_flags["holiday_date"],
            "left"
        ).drop("holiday_date")

        # Fill non-holidays with 0
        result = result.withColumn(
            "is_holiday",
            coalesce(col("is_holiday"), lit(0)).cast(IntegerType())
        )

        holiday_rows = result.filter(col("is_holiday") == 1).count()
        logger.info(f"  Holiday join complete: {holiday_rows:,} holiday rows")

        return result

    # =========================================================
    # STEP 3: Create lag and rolling features
    # =========================================================

    def create_lag_features(self, df):
        """
        Create lag features for demand prediction.

        Lag features use past demand as predictors:
        - demand_lag_1h: demand 1 hour ago (short-term trend)
        - demand_lag_24h: demand same hour yesterday (daily pattern)
        - demand_lag_168h: demand same hour last week (weekly pattern)

        All lags are shifted (look-back only) to prevent target leakage.

        Args:
            df (pyspark.sql.DataFrame): Feature data sorted by station and time

        Returns:
            pyspark.sql.DataFrame: Data with lag features
        """
        logger.info("Creating lag features")

        # Window: per station, ordered by time
        station_window = Window.partitionBy("start_station_id").orderBy("hour")

        # Lag features
        df = df.withColumn("demand_lag_1h",
                           spark_lag("demand_count", 1).over(station_window))
        logger.info("  ✓ demand_lag_1h")

        df = df.withColumn("demand_lag_24h",
                           spark_lag("demand_count", 24).over(station_window))
        logger.info("  ✓ demand_lag_24h")

        df = df.withColumn("demand_lag_168h",
                           spark_lag("demand_count", 168).over(station_window))
        logger.info("  ✓ demand_lag_168h")

        # Fill nulls with 0 (first rows per station have no history)
        for col_name in ["demand_lag_1h", "demand_lag_24h", "demand_lag_168h"]:
            nulls = df.filter(col(col_name).isNull()).count()
            df = df.withColumn(col_name,
                               coalesce(col(col_name), lit(0)).cast(IntegerType()))
            logger.info(f"  {col_name}: filled {nulls:,} nulls with 0")

        return df

    def create_rolling_averages(self, df):
        """
        Create rolling average features for demand prediction.

        Rolling averages smooth out noise and capture trends:
        - rolling_avg_3h: average demand over past 3 hours
        - rolling_avg_6h: average demand over past 6 hours
        - rolling_avg_24h: average demand over past 24 hours

        Uses shift(1) equivalent (rows between -N and -1) to prevent leakage.

        Args:
            df (pyspark.sql.DataFrame): Feature data

        Returns:
            pyspark.sql.DataFrame: Data with rolling average features
        """
        logger.info("Creating rolling average features")

        # Windows: per station, ordered by time, looking back N rows (excluding current)
        # rowsBetween(-3, -1) means 3 rows before to 1 row before (excludes current)
        window_3h = Window.partitionBy("start_station_id") \
            .orderBy("hour").rowsBetween(-3, -1)
        window_6h = Window.partitionBy("start_station_id") \
            .orderBy("hour").rowsBetween(-6, -1)
        window_24h = Window.partitionBy("start_station_id") \
            .orderBy("hour").rowsBetween(-24, -1)

        df = df.withColumn("rolling_avg_3h",
                           spark_avg("demand_count").over(window_3h))
        logger.info("  ✓ rolling_avg_3h")

        df = df.withColumn("rolling_avg_6h",
                           spark_avg("demand_count").over(window_6h))
        logger.info("  ✓ rolling_avg_6h")

        df = df.withColumn("rolling_avg_24h",
                           spark_avg("demand_count").over(window_24h))
        logger.info("  ✓ rolling_avg_24h")

        # Fill nulls with 0
        for col_name in ["rolling_avg_3h", "rolling_avg_6h", "rolling_avg_24h"]:
            nulls = df.filter(col(col_name).isNull()).count()
            df = df.withColumn(col_name,
                               coalesce(col(col_name), lit(0.0)).cast(DoubleType()))
            logger.info(f"  {col_name}: filled {nulls:,} nulls with 0")

        return df

    # =========================================================
    # STEP 4: Cyclical time encoding
    # =========================================================

    def add_cyclical_encoding(self, df):
        """
        Add cyclical (sin/cos) encoding for time features.

        Cyclical encoding preserves the circular nature of time:
        hour 23 and hour 0 are close in reality but far numerically.
        Sin/cos encoding maps them to nearby points on a circle.

        Args:
            df (pyspark.sql.DataFrame): Feature data

        Returns:
            pyspark.sql.DataFrame: Data with cyclical features
        """
        logger.info("Adding cyclical time encodings")

        # Hour of day (0-23 cycle)
        df = df.withColumn("hour_sin",
                           sin(2 * pi() * col("hour_of_day") / lit(24)))
        df = df.withColumn("hour_cos",
                           cos(2 * pi() * col("hour_of_day") / lit(24)))

        # Day of week (1-7 cycle in Spark: 1=Sunday, 7=Saturday)
        df = df.withColumn("dow_sin",
                           sin(2 * pi() * col("day_of_week") / lit(7)))
        df = df.withColumn("dow_cos",
                           cos(2 * pi() * col("day_of_week") / lit(7)))

        # Month (1-12 cycle)
        df = df.withColumn("month_sin",
                           sin(2 * pi() * col("month") / lit(12)))
        df = df.withColumn("month_cos",
                           cos(2 * pi() * col("month") / lit(12)))

        logger.info("  Added: hour_sin, hour_cos, dow_sin, dow_cos, month_sin, month_cos")

        return df

    # =========================================================
    # STEP 5: Validation
    # =========================================================

    def validate(self, df, original_demand_count):
        """
        Run validation checks on the feature matrix.

        Args:
            df (pyspark.sql.DataFrame): Final feature matrix
            original_demand_count (int): Row count of input demand table

        Returns:
            bool: True if all checks pass
        """
        logger.info("="*60)
        logger.info("RUNNING VALIDATION CHECKS")
        logger.info("="*60)

        all_passed = True

        # 1. Row count preserved
        final_count = df.count()
        match = final_count == original_demand_count
        status = "PASS" if match else "FAIL"
        logger.info(f"  [{status}] Row count: {final_count:,} (expected {original_demand_count:,})")
        if not match:
            all_passed = False

        # 2. No null target variable
        null_target = df.filter(col("demand_count").isNull()).count()
        status = "PASS" if null_target == 0 else "FAIL"
        logger.info(f"  [{status}] Null demand_count: {null_target}")
        if null_target > 0:
            all_passed = False

        # 3. No null features (check key columns)
        key_features = [
            "temperature_c", "capacity", "is_holiday",
            "demand_lag_1h", "demand_lag_24h", "demand_lag_168h",
            "rolling_avg_3h", "rolling_avg_6h", "rolling_avg_24h",
            "hour_sin", "hour_cos"
        ]
        for feat in key_features:
            nulls = df.filter(col(feat).isNull()).count()
            if nulls > 0:
                logger.warning(f"  [FAIL] {feat} has {nulls:,} nulls")
                all_passed = False

        if all_passed:
            logger.info("  [PASS] All key features have zero nulls")

        # 4. Total demand preserved
        total_demand = df.agg(spark_sum("demand_count")).first()[0]
        logger.info(f"  [INFO] Total demand (pickups): {int(total_demand):,}")

        # 5. Feature count
        logger.info(f"  [INFO] Total columns: {len(df.columns)}")
        logger.info(f"  [INFO] Columns: {df.columns}")

        logger.info("="*60)
        if all_passed:
            logger.info("ALL VALIDATION CHECKS PASSED")
        else:
            logger.warning("SOME VALIDATION CHECKS FAILED")
        logger.info("="*60)

        return all_passed

    # =========================================================
    # STEP 6: Save
    # =========================================================

    def save_data(self, df):
        """
        Save feature matrix to local filesystem or GCS in Parquet format.

        Args:
            df (pyspark.sql.DataFrame): Feature matrix to save
        """
        path = self._get_path("processed/features/feature_matrix")
        logger.info(f"Saving feature matrix to: {path}")

        df = df.orderBy("start_station_id", "hour")
        df.write.mode("overwrite").parquet(path)

        logger.info("Successfully saved feature matrix")

    # =========================================================
    # MAIN EXECUTION
    # =========================================================

    def run(self):
        """Execute the complete feature engineering pipeline."""

        logger.info("="*80)
        logger.info("BLUEBIKES FEATURE ENGINEERING PIPELINE - STARTED")
        logger.info("="*80)

        start_time = datetime.now()

        self.create_spark_session()

        try:
            # Step 1: Load all data sources
            logger.info("STEP 1: Loading data sources")
            demand = self.load_demand()
            weather = self.load_weather()
            station_lookup = self.load_station_lookup()
            holidays = self.load_holidays()

            original_count = demand.count()

            # Step 2: Join weather
            logger.info("STEP 2: Joining weather data")
            df = self.join_weather(demand, weather)

            # Step 3: Join station capacity
            logger.info("STEP 3: Joining station metadata")
            df = self.join_stations(df, station_lookup)

            # Step 4: Join holidays
            logger.info("STEP 4: Joining holiday calendar")
            df = self.join_holidays(df, holidays)

            # Step 5: Create lag features
            logger.info("STEP 5: Creating lag features")
            df = self.create_lag_features(df)

            # Step 6: Create rolling averages
            logger.info("STEP 6: Creating rolling averages")
            df = self.create_rolling_averages(df)

            # Step 7: Add cyclical encoding
            logger.info("STEP 7: Adding cyclical time encoding")
            df = self.add_cyclical_encoding(df)

            # Step 8: Validate
            logger.info("STEP 8: Validating feature matrix")
            validation_passed = self.validate(df, original_count)

            if not validation_passed:
                logger.error("Validation failed! Review output before using for training.")

            # Step 9: Save
            logger.info("STEP 9: Saving feature matrix")
            self.save_data(df)

            # Summary
            end_time = datetime.now()
            runtime = (end_time - start_time).total_seconds()

            final_count = df.count()
            n_stations = df.select("start_station_id").distinct().count()
            n_features = len(df.columns)

            logger.info("="*80)
            logger.info("PIPELINE COMPLETED SUCCESSFULLY")
            logger.info(f"  Output: {final_count:,} rows × {n_features} columns")
            logger.info(f"  Stations: {n_stations}")
            logger.info(f"  ML features: {n_features - 3} (excluding identifiers)")
            logger.info(f"  Total runtime: {runtime:.2f} seconds ({runtime/60:.2f} minutes)")
            logger.info("="*80)

        except Exception as e:
            logger.error(f"Pipeline failed: {str(e)}")
            raise

        finally:
            if self.spark:
                self.spark.stop()
                logger.info("Spark session terminated")


def main():
    """Command-line interface for the feature engineering pipeline."""

    parser = argparse.ArgumentParser(
        description='Bluebikes Feature Engineering Pipeline',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  Local mode (development):
    python jobs/production_feature_engineering.py --local

  GCS mode (production):
    python jobs/production_feature_engineering.py

  Custom bucket:
    python jobs/production_feature_engineering.py --bucket my-custom-bucket
        """
    )

    parser.add_argument(
        '--local',
        action='store_true',
        help='Use local filesystem instead of GCS (for development)'
    )

    parser.add_argument(
        '--bucket',
        type=str,
        default='bluebikes-demand-predictor-data',
        help='GCS bucket name (default: bluebikes-demand-predictor-data)'
    )

    args = parser.parse_args()

    # Execute pipeline
    pipeline = FeatureEngineeringPipeline(
        gcs_bucket=args.bucket,
        local_mode=args.local
    )

    pipeline.run()


if __name__ == "__main__":
    main()
