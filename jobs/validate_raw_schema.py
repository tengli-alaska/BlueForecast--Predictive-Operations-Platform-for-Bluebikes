#!/usr/bin/env python3
"""
validate_raw_schema.py
Validates the Parquet output of raw_ingestion.
Fails the Dataproc job (exit code 1) if schema or row count is wrong.
Writes a JSON report to GCS.
"""

import json
import argparse
from datetime import datetime
from pyspark.sql import SparkSession
from pyspark.sql.types import (
    StructType, StructField, StringType, DoubleType,
    IntegerType, TimestampType
)

BUCKET_DEFAULT = "bluebikes-demand-predictor-data"

# Expected schema after raw_ingestion (includes derived columns)
EXPECTED_FIELDS = {
    "ride_id":           StringType(),
    "rideable_type":     StringType(),
    "started_at":        StringType(),
    "ended_at":          StringType(),
    "start_station_name": StringType(),
    "start_station_id":  StringType(),
    "end_station_name":  StringType(),
    "end_station_id":    StringType(),
    "start_lat":         DoubleType(),
    "start_lng":         DoubleType(),
    "end_lat":           DoubleType(),
    "end_lng":           DoubleType(),
    "member_casual":     StringType(),
    "started_at_ts":     TimestampType(),
    "ended_at_ts":       TimestampType(),
    "year":              IntegerType(),
    "month":             IntegerType(),
}

MIN_ROW_COUNT = 1000  # fail if fewer rows than this


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bucket",   default=BUCKET_DEFAULT)
    parser.add_argument("--run_date", required=True, help="YYYY-MM-DD from Airflow ds")
    args = parser.parse_args()

    input_path  = f"gs://{args.bucket}/raw_enforced/trips/"
    report_path = f"gs://{args.bucket}/logs/validate_raw_schema/{args.run_date}/report.json"

    print(f"[START] validate_raw_schema | input={input_path} | run_date={args.run_date}")

    spark = SparkSession.builder.appName("validate_raw_schema").getOrCreate()
    spark.sparkContext.setLogLevel("WARN")

    df = spark.read.parquet(input_path)

    # ── Schema check ─────────────────────────────────────────────────────────
    actual_fields  = {f.name: type(f.dataType) for f in df.schema.fields}
    expected_types = {k: type(v) for k, v in EXPECTED_FIELDS.items()}

    missing_cols  = [k for k in expected_types if k not in actual_fields]
    type_mismatches = [
        k for k in expected_types
        if k in actual_fields and actual_fields[k] != expected_types[k]
    ]
    schema_ok = len(missing_cols) == 0 and len(type_mismatches) == 0

    # ── Row count check ───────────────────────────────────────────────────────
    row_count  = df.count()
    count_ok   = row_count >= MIN_ROW_COUNT

    # ── Build report ──────────────────────────────────────────────────────────
    issues = []
    if missing_cols:
        issues.append(f"Missing columns: {missing_cols}")
    if type_mismatches:
        issues.append(f"Type mismatches on: {type_mismatches}")
    if not count_ok:
        issues.append(f"Row count {row_count} below minimum {MIN_ROW_COUNT}")

    status = "PASS" if (schema_ok and count_ok) else "FAIL"

    report = {
        "job":          "validate_raw_schema",
        "run_date":     args.run_date,
        "status":       status,
        "rows_checked": row_count,
        "schema_match": schema_ok,
        "issues":       issues,
    }

    # ── Write report to GCS ───────────────────────────────────────────────────
    report_json = json.dumps(report, indent=2)

    # Delete existing report path if it exists (saveAsTextFile won't overwrite)
    from subprocess import call
    call(["gsutil", "-m", "rm", "-rf", report_path])

    spark.sparkContext \
         .parallelize([report_json]) \
         .saveAsTextFile(report_path)

    print(f"[END] validate_raw_schema | status={status} | rows={row_count} | report={report_path}")

    spark.stop()

    # ── Fail the job if validation didn't pass ────────────────────────────────
    if status == "FAIL":
        raise SystemExit(f"Validation FAILED: {issues}")


if __name__ == "__main__":
    main()