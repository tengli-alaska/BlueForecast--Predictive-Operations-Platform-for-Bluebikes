#!/usr/bin/env python3
"""
ingest_weather.py
Reads raw weather CSV, enforces schema, writes Parquet to processed/weather/
Skips if output already exists unless --force is passed.
"""

import argparse
import subprocess
from pyspark.sql import SparkSession
from pyspark.sql.types import (
    StructType, StructField, StringType,
    DoubleType, IntegerType, TimestampType, DateType
)

BUCKET_DEFAULT = "bluebikes-demand-predictor-data"
INPUT_PATH     = "raw/contextual/weather/weather_hourly_2023_2024.csv"
OUTPUT_PATH    = "processed/weather/weather_hourly.parquet"

WEATHER_SCHEMA = StructType([
    StructField("datetime",         TimestampType(), True),
    StructField("temperature_c",    DoubleType(),    True),
    StructField("precipitation_mm", DoubleType(),    True),
    StructField("wind_speed_kmh",   DoubleType(),    True),
    StructField("humidity_pct",     DoubleType(),    True),
    StructField("weather_code",     IntegerType(),   True),
    StructField("date",             DateType(),      True),
    StructField("hour",             IntegerType(),   True),
    StructField("day_of_week",      IntegerType(),   True),
    StructField("month",            IntegerType(),   True),
    StructField("year",             IntegerType(),   True),
    StructField("is_precipitation", IntegerType(),   True),
    StructField("is_cold",          IntegerType(),   True),
    StructField("is_hot",           IntegerType(),   True),
    StructField("feels_like_c",     DoubleType(),    True),
])

def gcs_path_exists(path):
    result = subprocess.run(
        ["gsutil", "-q", "stat", path],
        capture_output=True
    )
    return result.returncode == 0

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bucket", default=BUCKET_DEFAULT)
    parser.add_argument("--force", action="store_true", help="Reprocess even if output exists")
    args = parser.parse_args()

    input_path   = f"gs://{args.bucket}/{INPUT_PATH}"
    output_path  = f"gs://{args.bucket}/{OUTPUT_PATH}"
    success_file = f"{output_path}/_SUCCESS"

    print(f"[START] ingest_weather | input={input_path}")

    # ── Skip check ───────────────────────────────────────────────────────────
    if not args.force and gcs_path_exists(success_file):
        print(f"[SKIP] ingest_weather | {output_path} already exists | use --force to reprocess | status=SKIPPED")
        return

    spark = SparkSession.builder.appName("ingest_weather").getOrCreate()
    spark.sparkContext.setLogLevel("WARN")

    df = (
        spark.read
        .option("header", "true")
        .schema(WEATHER_SCHEMA)
        .csv(input_path)
    )

    df = df.dropDuplicates(["datetime"])
    df = df.filter(df.datetime.isNotNull())

    df.write.mode("overwrite").parquet(output_path)

    count = df.count()
    print(f"[END] ingest_weather | output={output_path} | rows_written={count} | status=OK")

    spark.stop()

if __name__ == "__main__":
    main()