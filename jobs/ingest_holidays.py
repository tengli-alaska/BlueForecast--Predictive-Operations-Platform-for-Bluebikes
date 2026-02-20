#!/usr/bin/env python3
"""
ingest_holidays.py
Reads raw holidays CSV, enforces schema, writes Parquet to processed/holidays/
Skips if output already exists unless --force is passed.
"""

import argparse
import subprocess
from pyspark.sql import SparkSession
from pyspark.sql.types import (
    StructType, StructField, StringType,
    IntegerType, DateType
)

BUCKET_DEFAULT = "bluebikes-demand-predictor-data"
INPUT_PATH     = "raw/contextual/holiday/us_holidays_2023_2024.csv"
OUTPUT_PATH    = "processed/holidays/holidays.parquet"

HOLIDAYS_SCHEMA = StructType([
    StructField("date",         DateType(),    True),
    StructField("holiday",      StringType(),  True),
    StructField("year",         IntegerType(), True),
    StructField("holiday_type", StringType(),  True),
    StructField("is_holiday",   IntegerType(), True),
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

    print(f"[START] ingest_holidays | input={input_path}")

    # ── Skip check ───────────────────────────────────────────────────────────
    if not args.force and gcs_path_exists(success_file):
        print(f"[SKIP] ingest_holidays | {output_path} already exists | use --force to reprocess | status=SKIPPED")
        return

    spark = SparkSession.builder.appName("ingest_holidays").getOrCreate()
    spark.sparkContext.setLogLevel("WARN")

    df = (
        spark.read
        .option("header", "true")
        .schema(HOLIDAYS_SCHEMA)
        .csv(input_path)
    )

    df = df.dropDuplicates(["date", "holiday"])
    df = df.filter(df.date.isNotNull())

    df.write.mode("overwrite").parquet(output_path)

    count = df.count()
    print(f"[END] ingest_holidays | output={output_path} | rows_written={count} | status=OK")

    spark.stop()

if __name__ == "__main__":
    main()