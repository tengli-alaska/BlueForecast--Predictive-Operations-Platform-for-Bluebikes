"""
Bluebikes Production Demand Aggregation Pipeline

Converts cleaned trip records into hourly demand (pickup counts) per station,
creating a complete station × hour grid with zero-fill for ML training.

Key steps:
1. Read cleaned Parquet trip data
2. Convert timestamps from UTC to Eastern Time
3. Aggregate trips to hourly pickups per station
4. Build complete (station × hour) grid with zero-fill
5. Add basic time features
6. Validate and save output

Usage:
  Local mode (development):
    python jobs/production_demand_aggregation.py --all --local
    python jobs/production_demand_aggregation.py --year 2024 --local

  GCS mode (production):
    python jobs/production_demand_aggregation.py --all
    python jobs/production_demand_aggregation.py --year 2024
"""

import os
import sys
import logging
import argparse
from datetime import datetime

from pyspark.sql import SparkSession
from pyspark.sql.functions import (
    col, count, lit, hour, dayofweek, month, year,
    date_format, floor as spark_floor, from_utc_timestamp,
    min as spark_min, max as spark_max, explode, sequence,
    to_timestamp, expr, when
)
from pyspark.sql.types import (
    StructType, StructField, StringType, TimestampType, IntegerType
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class DemandAggregationPipeline:
    """
    Production pipeline for aggregating trip data into hourly demand per station.

    Reads cleaned trip Parquet files, converts UTC timestamps to Eastern Time,
    counts hourly pickups per station, and creates a complete grid including
    zero-demand station-hours for ML model training.

    Supports both local filesystem and Google Cloud Storage backends.
    """

    def __init__(self, gcs_bucket="bluebikes-demand-predictor-data", local_mode=False):
        """
        Initialize the aggregation pipeline.

        Args:
            gcs_bucket (str): Name of the GCS bucket containing data
            local_mode (bool): If True, use local filesystem; if False, use GCS
        """
        self.gcs_bucket = gcs_bucket
        self.local_mode = local_mode
        self.spark = None
        self.timezone = "US/Eastern"

        if local_mode:
            logger.info("Pipeline initialized in LOCAL mode (development)")
        else:
            logger.info(f"Pipeline initialized in GCS mode with bucket: {gcs_bucket}")

    def create_spark_session(self):
        """Initialize Apache Spark session with appropriate configuration."""
        logger.info("Initializing Spark session")

        builder = SparkSession.builder \
            .appName("Bluebikes Demand Aggregation Pipeline") \
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

    def read_cleaned_data(self, year=None):
        """
        Read cleaned trip data from local filesystem or GCS.

        Args:
            year (int, optional): Specific year to read. If None, reads all years.

        Returns:
            pyspark.sql.DataFrame: Cleaned trip data
        """
        if self.local_mode:
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            if year:
                path = os.path.join(base_dir, f"data/processed/cleaned/year={year}")
                logger.info(f"Reading cleaned {year} data from local filesystem")
            else:
                path = os.path.join(base_dir, "data/processed/cleaned/")
                logger.info("Reading all cleaned data from local filesystem")
        else:
            if year:
                path = f"gs://{self.gcs_bucket}/processed/cleaned/year={year}"
                logger.info(f"Reading cleaned {year} data from GCS")
            else:
                path = f"gs://{self.gcs_bucket}/processed/cleaned/"
                logger.info("Reading all cleaned data from GCS")

        df = self.spark.read.parquet(path)
        record_count = df.count()
        logger.info(f"Loaded {record_count:,} cleaned trip records")

        return df

    def convert_timezone(self, df):
        """
        Convert UTC timestamps to Eastern Time.

        Bluebikes timestamps are stored in UTC. For demand forecasting in Boston,
        we need Eastern Time so that hour-of-day features reflect local patterns
        (e.g., morning commute at 8 AM ET, not 1 PM UTC).

        Args:
            df (pyspark.sql.DataFrame): Trip data with UTC timestamps

        Returns:
            pyspark.sql.DataFrame: Trip data with Eastern Time timestamps
        """
        logger.info(f"Converting timestamps from UTC to {self.timezone}")

        # Convert started_at from UTC to Eastern Time
        df = df.withColumn(
            "started_at_et",
            from_utc_timestamp(col("started_at"), self.timezone)
        )

        # Floor to the hour in Eastern Time
        # e.g., 2023-04-15 14:37:22 ET → 2023-04-15 14:00:00 ET
        df = df.withColumn(
            "hour",
            date_format(col("started_at_et"), "yyyy-MM-dd HH:00:00").cast("timestamp")
        )

        # Verify conversion
        sample = df.select("started_at", "started_at_et", "hour").first()
        logger.info(f"Timezone conversion sample:")
        logger.info(f"  UTC:      {sample['started_at']}")
        logger.info(f"  Eastern:  {sample['started_at_et']}")
        logger.info(f"  Floored:  {sample['hour']}")

        return df

    def aggregate_demand(self, df):
        """
        Count hourly pickups per station.

        Groups trips by (start_station_id, hour) and counts records.
        This gives us only station-hours with at least one pickup.

        Args:
            df (pyspark.sql.DataFrame): Trip data with floored hour column

        Returns:
            pyspark.sql.DataFrame: Actual demand counts (no zeros yet)
        """
        logger.info("Aggregating trips to hourly demand per station")

        actual_demand = df.groupBy("start_station_id", "hour") \
            .agg(count("*").alias("demand_count"))

        row_count = actual_demand.count()
        station_count = actual_demand.select("start_station_id").distinct().count()

        # Get date range
        date_range = actual_demand.agg(
            spark_min("hour").alias("min_hour"),
            spark_max("hour").alias("max_hour")
        ).first()

        logger.info(f"Aggregated demand:")
        logger.info(f"  Station-hours with pickups: {row_count:,}")
        logger.info(f"  Unique stations: {station_count}")
        logger.info(f"  Date range: {date_range['min_hour']} to {date_range['max_hour']}")

        # Demand statistics
        demand_stats = actual_demand.describe("demand_count")
        logger.info("  Demand statistics:")
        for row in demand_stats.collect():
            logger.info(f"    {row['summary']}: {row['demand_count']}")

        return actual_demand

    def build_complete_grid(self, actual_demand):
        """
        Create a complete (station × hour) grid and fill zeros.

        Many station-hours had zero pickups. The ML model needs to see these
        zeros to learn when demand is low. This method creates every possible
        (station, hour) combination and left-joins actual counts, filling
        missing values with 0.

        Args:
            actual_demand (pyspark.sql.DataFrame): Actual demand counts

        Returns:
            pyspark.sql.DataFrame: Complete demand grid with zero-fill
        """
        logger.info("Building complete station × hour grid")

        # Get all unique stations
        all_stations = actual_demand.select("start_station_id").distinct()
        station_count = all_stations.count()

        # Get hour range
        date_range = actual_demand.agg(
            spark_min("hour").alias("min_hour"),
            spark_max("hour").alias("max_hour")
        ).first()

        min_hour = date_range["min_hour"]
        max_hour = date_range["max_hour"]

        # Generate all hours using Spark sequence function
        all_hours = self.spark.sql(f"""
            SELECT explode(
                sequence(
                    timestamp('{min_hour}'),
                    timestamp('{max_hour}'),
                    interval 1 hour
                )
            ) as hour
        """)

        hour_count = all_hours.count()
        expected_rows = station_count * hour_count

        logger.info(f"  Stations: {station_count}")
        logger.info(f"  Hours: {hour_count:,} ({min_hour} to {max_hour})")
        logger.info(f"  Expected grid size: {expected_rows:,} rows")

        # Cross join: every station paired with every hour
        complete_grid = all_stations.crossJoin(all_hours)

        # Left join actual demand onto the grid
        hourly_demand = complete_grid.join(
            actual_demand,
            on=["start_station_id", "hour"],
            how="left"
        )

        # Fill missing demand with 0
        hourly_demand = hourly_demand.withColumn(
            "demand_count",
            when(col("demand_count").isNull(), lit(0))
            .otherwise(col("demand_count"))
            .cast(IntegerType())
        )

        actual_rows = hourly_demand.count()
        zero_rows = hourly_demand.filter(col("demand_count") == 0).count()
        nonzero_rows = actual_rows - zero_rows
        sparsity = (zero_rows / actual_rows) * 100

        logger.info(f"  Grid created: {actual_rows:,} rows")
        logger.info(f"  Zero-demand rows: {zero_rows:,}")
        logger.info(f"  Non-zero rows: {nonzero_rows:,}")
        logger.info(f"  Sparsity: {sparsity:.1f}%")

        return hourly_demand

    def add_time_features(self, df):
        """
        Extract time components for feature engineering.

        Adds: date, year, month, day_of_week, hour_of_day, is_weekend.
        These are basic temporal features needed for demand forecasting.

        Args:
            df (pyspark.sql.DataFrame): Hourly demand data

        Returns:
            pyspark.sql.DataFrame: Data with time features added
        """
        logger.info("Adding time features")

        df = df.withColumn("date", col("hour").cast("date"))
        df = df.withColumn("year", year(col("hour")))
        df = df.withColumn("month", month(col("hour")))
        df = df.withColumn("day_of_week", dayofweek(col("hour")))  # 1=Sunday, 7=Saturday in Spark
        df = df.withColumn("hour_of_day", hour(col("hour")))
        df = df.withColumn(
            "is_weekend",
            when(col("day_of_week").isin(1, 7), lit(1)).otherwise(lit(0))
        )

        logger.info("Time features added: date, year, month, day_of_week, hour_of_day, is_weekend")

        return df

    def validate(self, hourly_demand, original_trip_count):
        """
        Run validation checks on the output data.

        Checks:
        1. No duplicate (station, hour) pairs
        2. No null demand counts
        3. No negative demand counts
        4. Total pickups match original trip count
        5. Grid is complete (stations × hours)

        Args:
            hourly_demand (pyspark.sql.DataFrame): Final demand table
            original_trip_count (int): Number of trips in the input data

        Returns:
            bool: True if all checks pass
        """
        logger.info("="*60)
        logger.info("RUNNING VALIDATION CHECKS")
        logger.info("="*60)

        all_passed = True

        # 1. No duplicate (station, hour) pairs
        total_rows = hourly_demand.count()
        distinct_rows = hourly_demand.select("start_station_id", "hour").distinct().count()
        dupes = total_rows - distinct_rows
        status = "PASS" if dupes == 0 else "FAIL"
        logger.info(f"  [{status}] Duplicate (station, hour) pairs: {dupes}")
        if dupes > 0:
            all_passed = False

        # 2. No null demand counts
        nulls = hourly_demand.filter(col("demand_count").isNull()).count()
        status = "PASS" if nulls == 0 else "FAIL"
        logger.info(f"  [{status}] Null demand counts: {nulls}")
        if nulls > 0:
            all_passed = False

        # 3. No negative demand
        negatives = hourly_demand.filter(col("demand_count") < 0).count()
        status = "PASS" if negatives == 0 else "FAIL"
        logger.info(f"  [{status}] Negative demand counts: {negatives}")
        if negatives > 0:
            all_passed = False

        # 4. Total pickups match
        total_demand = hourly_demand.agg({"demand_count": "sum"}).first()[0]
        match = int(total_demand) == original_trip_count
        status = "PASS" if match else "FAIL"
        logger.info(f"  [{status}] Total pickups: {int(total_demand):,} vs {original_trip_count:,} trips (match: {match})")
        if not match:
            all_passed = False

        # 5. Grid completeness
        n_stations = hourly_demand.select("start_station_id").distinct().count()
        n_hours = hourly_demand.select("hour").distinct().count()
        expected = n_stations * n_hours
        complete = total_rows == expected
        status = "PASS" if complete else "FAIL"
        logger.info(f"  [{status}] Grid: {n_stations} stations × {n_hours:,} hours = {expected:,} expected, {total_rows:,} actual")
        if not complete:
            all_passed = False

        logger.info("="*60)
        if all_passed:
            logger.info("ALL VALIDATION CHECKS PASSED")
        else:
            logger.warning("SOME VALIDATION CHECKS FAILED")
        logger.info("="*60)

        return all_passed

    def save_data(self, df):
        """
        Save hourly demand data to local filesystem or GCS in Parquet format.

        Args:
            df (pyspark.sql.DataFrame): Hourly demand data to save
        """
        if self.local_mode:
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            output_path = os.path.join(base_dir, "data/features/hourly_demand_by_station")
            logger.info(f"Saving to local filesystem: {output_path}")
        else:
            output_path = f"gs://{self.gcs_bucket}/processed/features/hourly_demand_by_station"
            logger.info(f"Saving to GCS: {output_path}")

        # Sort by station and hour for clean output
        df = df.orderBy("start_station_id", "hour")

        df.write.mode("overwrite").parquet(output_path)

        logger.info(f"Successfully saved hourly demand data")

    def run(self, year=None, process_all=False):
        """
        Execute the complete demand aggregation pipeline.

        Args:
            year (int, optional): Specific year to process
            process_all (bool): If True, process all available years together
        """
        logger.info("="*80)
        logger.info("BLUEBIKES DEMAND AGGREGATION PIPELINE - STARTED")
        logger.info("="*80)

        start_time = datetime.now()

        self.create_spark_session()

        try:
            # Step 1: Read cleaned trip data
            if process_all:
                df = self.read_cleaned_data()
            else:
                df = self.read_cleaned_data(year)

            original_trip_count = df.count()
            logger.info(f"Total trips to aggregate: {original_trip_count:,}")

            # Step 2: Convert UTC to Eastern Time
            df = self.convert_timezone(df)

            # Step 3: Aggregate to hourly demand per station
            actual_demand = self.aggregate_demand(df)

            # Step 4: Build complete grid with zero-fill
            hourly_demand = self.build_complete_grid(actual_demand)

            # Step 5: Add time features
            hourly_demand = self.add_time_features(hourly_demand)

            # Step 6: Validate
            validation_passed = self.validate(hourly_demand, original_trip_count)

            if not validation_passed:
                logger.error("Validation failed! Review output before using for training.")

            # Step 7: Save
            self.save_data(hourly_demand)

            # Summary
            end_time = datetime.now()
            runtime = (end_time - start_time).total_seconds()

            final_count = hourly_demand.count()
            n_stations = hourly_demand.select("start_station_id").distinct().count()

            logger.info("="*80)
            logger.info("PIPELINE COMPLETED SUCCESSFULLY")
            logger.info(f"  Input: {original_trip_count:,} trips")
            logger.info(f"  Output: {final_count:,} station-hour rows")
            logger.info(f"  Stations: {n_stations}")
            logger.info(f"  Timezone: {self.timezone}")
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
    """Command-line interface for the demand aggregation pipeline."""

    parser = argparse.ArgumentParser(
        description='Bluebikes Production Demand Aggregation Pipeline',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  Local mode (development):
    python jobs/production_demand_aggregation.py --year 2024 --local
    python jobs/production_demand_aggregation.py --all --local

  GCS mode (production):
    python jobs/production_demand_aggregation.py --year 2024
    python jobs/production_demand_aggregation.py --all
        """
    )

    parser.add_argument(
        '--year',
        type=int,
        help='Year to process (e.g., 2024)'
    )

    parser.add_argument(
        '--all',
        action='store_true',
        help='Process all available years together (2023 + 2024)'
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

    # Validate arguments
    if not args.all and not args.year:
        parser.error("Must specify either --year or --all")

    # Execute pipeline
    pipeline = DemandAggregationPipeline(
        gcs_bucket=args.bucket,
        local_mode=args.local
    )

    pipeline.run(
        year=args.year,
        process_all=args.all
    )


if __name__ == "__main__":
    main()
