#!/usr/bin/env python3
"""
ingest_stations.py
Reads raw stations CSV, enforces schema, writes Parquet to processed/stations/
Skips if output already exists unless --force is passed.
"""

import argparse
import subprocess
from pyspark.sql import SparkSession
from pyspark.sql.types import (
    StructType, StructField, StringType,
    DoubleType, IntegerType, BooleanType, TimestampType
)

BUCKET_DEFAULT = "bluebikes-demand-predictor-data"
INPUT_PATH     = "raw/metadata/stations/stations.csv"
OUTPUT_PATH    = "processed/stations/stations.parquet"

STATIONS_SCHEMA = StructType([
    StructField("station_id",     StringType(),    True),
    StructField("station_name",   StringType(),    True),
    StructField("lat",            DoubleType(),    True),
    StructField("lon",            DoubleType(),    True),
    StructField("capacity",       IntegerType(),   True),
    StructField("region_id",      IntegerType(),   True),
    StructField("rental_methods", StringType(),    True),
    StructField("has_kiosk",      BooleanType(),   True),
    StructField("fetched_at",     TimestampType(), True),
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

    print(f"[START] ingest_stations | input={input_path}")

    # ── Skip check ───────────────────────────────────────────────────────────
    if not args.force and gcs_path_exists(success_file):
        print(f"[SKIP] ingest_stations | {output_path} already exists | use --force to reprocess | status=SKIPPED")
        return

    spark = SparkSession.builder.appName("ingest_stations").getOrCreate()
    spark.sparkContext.setLogLevel("WARN")

    df = (
        spark.read
        .option("header", "true")
        .schema(STATIONS_SCHEMA)
        .csv(input_path)
    )

    df = df.dropDuplicates(["station_id"])
    df = df.filter(
        df.station_id.isNotNull() &
        df.lat.isNotNull() &
        df.lon.isNotNull()
    )

    df.write.mode("overwrite").parquet(output_path)

    count = df.count()
    print(f"[END] ingest_stations | output={output_path} | rows_written={count} | status=OK")

    spark.stop()

if __name__ == "__main__":
    main()