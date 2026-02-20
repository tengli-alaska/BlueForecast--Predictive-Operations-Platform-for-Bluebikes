from pyspark.sql import SparkSession
from pyspark.sql.functions import col, to_timestamp, year, month
from pyspark.sql.types import *
import argparse
import subprocess

BUCKET = "gs://bluebikes-demand-predictor-data"
OUTPUT_PATH = f"{BUCKET}/raw_enforced/trips/"

def gcs_path_exists(path):
    result = subprocess.run(
        ["gsutil", "-q", "stat", path],
        capture_output=True
    )
    return result.returncode == 0

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", required=True, help="e.g. 2023 or 2024")
    parser.add_argument("--force", action="store_true", help="Force reprocessing even if output exists")
    args = parser.parse_args()

    input_path   = f"{BUCKET}/raw/trips/{args.year}/csv/*.csv"
    success_file = f"{OUTPUT_PATH}year={args.year}/_SUCCESS"

    print(f"[START] raw_ingestion | input={input_path} | year={args.year}")

    # ── Skip check ───────────────────────────────────────────────────────────
    if not args.force and gcs_path_exists(success_file):
        print(f"[SKIP] raw_ingestion | year={args.year} already exists in {OUTPUT_PATH} | use --force to reprocess | status=SKIPPED")
        return

    spark = (
        SparkSession.builder
        .appName("bluebikes_raw_ingestion")
        .getOrCreate()
    )

    trip_schema = StructType([
        StructField("ride_id",             StringType(), True),
        StructField("rideable_type",       StringType(), True),
        StructField("started_at",          StringType(), True),
        StructField("ended_at",            StringType(), True),
        StructField("start_station_name",  StringType(), True),
        StructField("start_station_id",    StringType(), True),
        StructField("end_station_name",    StringType(), True),
        StructField("end_station_id",      StringType(), True),
        StructField("start_lat",           DoubleType(), True),
        StructField("start_lng",           DoubleType(), True),
        StructField("end_lat",             DoubleType(), True),
        StructField("end_lng",             DoubleType(), True),
        StructField("member_casual",       StringType(), True),
    ])

    df = (
        spark.read
        .option("header", "true")
        .schema(trip_schema)
        .csv(input_path)
    )

    df = (
        df.withColumn("started_at_ts", to_timestamp(col("started_at")))
          .withColumn("ended_at_ts",   to_timestamp(col("ended_at")))
          .withColumn("year",          year(col("started_at_ts")))
          .withColumn("month",         month(col("started_at_ts")))
    )

    (
        df
        .repartition("year", "month")
        .write
        .mode("overwrite")
        .partitionBy("year", "month")
        .parquet(OUTPUT_PATH)
    )

    count = df.count()
    print(f"[END] raw_ingestion | output={OUTPUT_PATH} | rows_written={count} | status=OK")

    spark.stop()

if __name__ == "__main__":
    main()