#!/usr/bin/env python3
"""
Bluebikes Data Cleaning Pipeline - Production Version
This script provides automated data cleaning for Bluebikes trip data.
It reads raw CSV files from local filesystem or Google Cloud Storage,
applies cleaning transformations, and saves the processed data as Parquet format.
The pipeline supports both local development mode and production GCS mode.
It can be triggered manually or scheduled via Cloud Scheduler for automated
processing of new data.
Usage:
    Local mode (development):
        python jobs/production_cleaning_pipeline.py --year 2024 --local
        python jobs/production_cleaning_pipeline.py --all --local
    GCS mode (production - requires Dataproc or GCS connector):
        python jobs/production_cleaning_pipeline.py --year 2024
        python jobs/production_cleaning_pipeline.py --all
Author: Data Engineering Team
Project: Bluebikes Demand Prediction
"""

import argparse
import sys
import os
import logging
from pyspark.sql import SparkSession
from pyspark.sql.functions import (
    col, unix_timestamp, lower, trim,
    hour, dayofweek, month, year
)
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class BluebikesCleaningPipeline:
    """
    Production data cleaning pipeline for Bluebikes trip data.
    This class implements the complete ETL process for cleaning
    historical trip data and preparing it for machine learning models.
    Supports both local filesystem and Google Cloud Storage backends.
    """

    def __init__(self, gcs_bucket="bluebikes-demand-predictor-data", local_mode=False):
        """
        Initialize the cleaning pipeline.
        Args:
            gcs_bucket (str): Name of the GCS bucket containing data
            local_mode (bool): If True, use local filesystem; if False, use GCS
        """
        self.gcs_bucket = gcs_bucket
        self.local_mode = local_mode
        self.spark = None

        if local_mode:
            logger.info("Pipeline initialized in LOCAL mode (development)")
        else:
            logger.info(f"Pipeline initialized in GCS mode with bucket: {gcs_bucket}")

    def create_spark_session(self):
        """Initialize Apache Spark session with appropriate configuration."""
        logger.info("Initializing Spark session")

        builder = SparkSession.builder \
            .appName("Bluebikes Production Cleaning Pipeline") \
            .config("spark.driver.memory", "4g") \
            .config("spark.sql.shuffle.partitions", "8")

        # Add GCS connector configuration if not in local mode
        if not self.local_mode:
            builder = builder \
                .config("spark.hadoop.fs.gs.impl", "com.google.cloud.hadoop.fs.gcs.GoogleHadoopFileSystem") \
                .config("spark.hadoop.fs.AbstractFileSystem.gs.impl", "com.google.cloud.hadoop.fs.gcs.GoogleHadoopFS")

        self.spark = builder.getOrCreate()

        self.spark.sparkContext.setLogLevel("WARN")
        logger.info(f"Spark {self.spark.version} initialized successfully")

    def read_data(self, year, month=None):
        """
        Read raw trip data from local filesystem or Google Cloud Storage.
        Args:
            year (int): Year to process
            month (str, optional): Specific month to process (format: "04")
        Returns:
            pyspark.sql.DataFrame: Raw trip data
        """
        if self.local_mode:
            # Local file paths
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

            if month:
                path = os.path.join(base_dir, f"data/raw/{year}/{year}{month}-bluebikes-tripdata.csv")
                logger.info(f"Reading {year}-{month} from local filesystem")
            else:
                path = os.path.join(base_dir, f"data/raw/{year}/*.csv")
                logger.info(f"Reading all {year} data from local filesystem")
        else:
            # GCS paths
            if month:
                path = f"gs://{self.gcs_bucket}/raw/historical/{year}/csv/{year}{month}-bluebikes-tripdata.csv"
                logger.info(f"Reading {year}-{month} from GCS")
            else:
                path = f"gs://{self.gcs_bucket}/raw/historical/{year}/csv/*.csv"
                logger.info(f"Reading all {year} data from GCS")

        df = self.spark.read.csv(path, header=True, inferSchema=True)

        record_count = df.count()
        logger.info(f"Loaded {record_count:,} records")

        return df

    def clean_data(self, df, label="Data"):
        """
        Apply data cleaning transformations.
        Cleaning operations:
        1. Remove duplicate records by ride_id
        2. Calculate trip duration in seconds and minutes
        3. Remove records with missing critical fields
        4. Filter duration outliers (less than 1 minute or greater than 24 hours)
        5. Standardize text fields (lowercase, trim whitespace)
        6. Extract time-based features (hour, day of week, month, year)
        Args:
            df (pyspark.sql.DataFrame): Raw input data
            label (str): Identifier for logging purposes
        Returns:
            pyspark.sql.DataFrame: Cleaned data
        """

        logger.info(f"Starting data cleaning for {label}")

        initial_count = df.count()
        logger.info(f"Initial record count: {initial_count:,}")

        # Step 1: Remove duplicates
        logger.info("Step 1: Removing duplicate records")
        before_dedup = df.count()
        df = df.dropDuplicates(['ride_id'])
        duplicates_removed = before_dedup - df.count()
        logger.info(f"Removed {duplicates_removed:,} duplicate records")

        # Step 2: Calculate trip duration
        logger.info("Step 2: Calculating trip duration")
        df = df.withColumn(
            'trip_duration_seconds',
            unix_timestamp('ended_at') - unix_timestamp('started_at')
        )
        df = df.withColumn(
            'trip_duration_minutes',
            col('trip_duration_seconds') / 60
        )
        logger.info("Trip duration calculated")

        # Step 3: Remove rows with missing critical fields
        logger.info("Step 3: Filtering records with missing critical fields")
        before_null_filter = df.count()
        df = df.filter(
            col('ride_id').isNotNull() &
            col('started_at').isNotNull() &
            col('ended_at').isNotNull() &
            col('start_station_id').isNotNull() &
            col('end_station_id').isNotNull()
        )
        null_removed = before_null_filter - df.count()
        logger.info(f"Removed {null_removed:,} records with missing data")

        # Step 4: Filter duration outliers
        logger.info("Step 4: Filtering duration outliers")
        before_outlier_filter = df.count()
        df = df.filter(
            (col('trip_duration_seconds') >= 60) &
            (col('trip_duration_seconds') <= 86400)
        )
        outliers_removed = before_outlier_filter - df.count()
        logger.info(f"Removed {outliers_removed:,} outlier records (duration < 1min or > 24h)")

        # Step 5: Standardize text fields
        logger.info("Step 5: Standardizing text fields")
        df = df.withColumn('rideable_type', lower(trim(col('rideable_type'))))
        df = df.withColumn('member_casual', lower(trim(col('member_casual'))))
        logger.info("Text fields standardized")

        # Step 6: Add time-based features
        logger.info("Step 6: Extracting time-based features")
        df = df.withColumn('start_hour', hour(col('started_at')))
        df = df.withColumn('start_day_of_week', dayofweek(col('started_at')))
        df = df.withColumn('start_month', month(col('started_at')))
        df = df.withColumn('start_year', year(col('started_at')))
        df = df.withColumn('start_date', col('started_at').cast('date'))
        logger.info("Time features extracted")

        # Final summary
        final_count = df.count()
        total_removed = initial_count - final_count
        retention_rate = (final_count / initial_count) * 100

        logger.info("="*60)
        logger.info(f"Cleaning complete for {label}")
        logger.info(f"Initial records: {initial_count:,}")
        logger.info(f"Final records: {final_count:,}")
        logger.info(f"Total removed: {total_removed:,} ({100-retention_rate:.2f}%)")
        logger.info(f"Retention rate: {retention_rate:.2f}%")
        logger.info("="*60)

        return df

    def save_data(self, df, year, month=None):
        """
        Save cleaned data to local filesystem or GCS in Parquet format.
        Args:
            df (pyspark.sql.DataFrame): Cleaned data to save
            year (int): Year identifier
            month (str, optional): Month identifier
        """
        if self.local_mode:
            # Local paths
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

            if month:
                output_path = os.path.join(base_dir, f"data/processed/cleaned/year={year}/month={month}")
                label = f"{year}-{month}"
            else:
                output_path = os.path.join(base_dir, f"data/processed/cleaned/year={year}")
                label = str(year)

            logger.info(f"Saving {label} to local filesystem: {output_path}")
        else:
            # GCS paths
            if month:
                output_path = f"gs://{self.gcs_bucket}/processed/cleaned/year={year}/month={month}"
                label = f"{year}-{month}"
            else:
                output_path = f"gs://{self.gcs_bucket}/processed/cleaned/year={year}"
                label = str(year)

            logger.info(f"Saving {label} to GCS: {output_path}")

        df.write.mode("overwrite").parquet(output_path)

        logger.info(f"Successfully saved {label}")

    def run(self, year=None, month=None, process_all=False):
        """
        Execute the complete cleaning pipeline.
        Args:
            year (int, optional): Year to process
            month (str, optional): Specific month to process
            process_all (bool): If True, process all available years
        """

        logger.info("="*80)
        logger.info("BLUEBIKES DATA CLEANING PIPELINE - STARTED")
        logger.info("="*80)

        start_time = datetime.now()

        self.create_spark_session()

        try:
            if process_all:
                # Process multiple years
                years_to_process = [2023, 2024]
                logger.info(f"Processing all years: {years_to_process}")

                for yr in years_to_process:
                    try:
                        df_raw = self.read_data(yr)
                        df_clean = self.clean_data(df_raw, label=str(yr))
                        self.save_data(df_clean, yr)

                    except Exception as e:
                        logger.error(f"Error processing year {yr}: {str(e)}")
                        continue

            else:
                # Process single year or month
                label = f"{year}-{month}" if month else str(year)
                logger.info(f"Processing: {label}")

                df_raw = self.read_data(year, month)
                df_clean = self.clean_data(df_raw, label=label)
                self.save_data(df_clean, year, month)

            # Calculate total runtime
            end_time = datetime.now()
            runtime = (end_time - start_time).total_seconds()

            logger.info("="*80)
            logger.info("PIPELINE COMPLETED SUCCESSFULLY")
            logger.info(f"Total runtime: {runtime:.2f} seconds ({runtime/60:.2f} minutes)")
            logger.info("="*80)

        except Exception as e:
            logger.error(f"Pipeline failed: {str(e)}")
            raise

        finally:
            if self.spark:
                self.spark.stop()
                logger.info("Spark session terminated")


def main():
    """Command-line interface for the cleaning pipeline."""

    parser = argparse.ArgumentParser(
        description='Bluebikes Production Data Cleaning Pipeline',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  Local mode (development):
    python jobs/production_cleaning_pipeline.py --year 2024 --local
    python jobs/production_cleaning_pipeline.py --all --local
  GCS mode (production):
    python jobs/production_cleaning_pipeline.py --year 2024
    python jobs/production_cleaning_pipeline.py --all
  Process specific month:
    python jobs/production_cleaning_pipeline.py --year 2024 --month 04 --local
        """
    )

    parser.add_argument(
        '--year',
        type=int,
        help='Year to process (e.g., 2024)'
    )

    parser.add_argument(
        '--month',
        type=str,
        help='Specific month to process (e.g., "04" for April)'
    )

    parser.add_argument(
        '--all',
        action='store_true',
        help='Process all available years (2023, 2024)'
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
    pipeline = BluebikesCleaningPipeline(
        gcs_bucket=args.bucket,
        local_mode=args.local
    )

    pipeline.run(
        year=args.year,
        month=args.month,
        process_all=args.all
    )


if __name__ == "__main__":
    main()