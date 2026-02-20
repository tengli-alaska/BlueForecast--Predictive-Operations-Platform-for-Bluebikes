#!/usr/bin/env python3
"""
validate_feature_matrix.py
Validates the feature matrix for all requested training years.
Checks schema consistency, data completeness, and feature quality.
Writes a JSON handoff report for the ML team.
Fails the job if critical issues are found.
"""

import argparse
import json
import logging
import subprocess
from datetime import datetime

from pyspark.sql import SparkSession
from pyspark.sql.functions import col, count, isnan, when, min as spark_min, max as spark_max, avg, stddev, sum as spark_sum

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

GCS_BUCKET     = "bluebikes-demand-predictor-data"
FEATURES_BASE  = "features/feature_matrix"
REPORT_BASE    = "logs/feature_validation"

EXPECTED_COLUMNS = [
    "start_station_id", "hour_et", "demand_count", "date",
    "year", "month", "day_of_week", "hour_of_day", "is_weekend",
    "temperature_c", "precipitation_mm", "wind_speed_kmh",
    "humidity_pct", "weather_code", "is_precipitation", "is_cold", "is_hot", "feels_like_c",
    "capacity", "is_holiday",
    "demand_lag_1h", "demand_lag_24h", "demand_lag_168h",
    "rolling_avg_3h", "rolling_avg_6h", "rolling_avg_24h",
    "hour_sin", "hour_cos", "dow_sin", "dow_cos", "month_sin", "month_cos",
]

ZERO_NULL_FEATURES = [
    "demand_count", "capacity", "is_holiday",
    "demand_lag_1h", "demand_lag_24h", "demand_lag_168h",
    "rolling_avg_3h", "rolling_avg_6h", "rolling_avg_24h",
    "hour_sin", "hour_cos", "dow_sin", "dow_cos", "month_sin", "month_cos",
]


def gcs_path_exists(path):
    result = subprocess.run(["gsutil", "-q", "stat", path], capture_output=True)
    return result.returncode == 0


def validate_year(spark, bucket, year):
    path = f"gs://{bucket}/{FEATURES_BASE}/year={year}/"
    logger.info(f"Validating year={year} from {path}")

    issues   = []
    warnings = []
    stats    = {}

    # ── Check path exists ─────────────────────────────────────────────────
    if not gcs_path_exists(path):
        issues.append(f"Feature matrix for year={year} does not exist at {path}")
        return {"year": year, "status": "FAIL", "issues": issues, "warnings": warnings, "stats": stats}

    df = spark.read.parquet(path)

    # ── Row count ─────────────────────────────────────────────────────────
    row_count = df.count()
    stats["row_count"] = row_count
    if row_count == 0:
        issues.append(f"year={year} has 0 rows")

    # ── Schema check ──────────────────────────────────────────────────────
    actual_cols   = set(df.columns)
    expected_cols = set(EXPECTED_COLUMNS)
    missing_cols  = expected_cols - actual_cols
    extra_cols    = actual_cols - expected_cols
    if missing_cols:
        issues.append(f"Missing columns: {sorted(missing_cols)}")
    if extra_cols:
        warnings.append(f"Extra columns (OK): {sorted(extra_cols)}")
    stats["columns"]      = sorted(df.columns)
    stats["column_count"] = len(df.columns)

    # ── Null checks ───────────────────────────────────────────────────────
    null_counts = {}
    for feat in ZERO_NULL_FEATURES:
        if feat in actual_cols:
            nulls = df.filter(col(feat).isNull()).count()
            null_counts[feat] = nulls
            if nulls > 0:
                issues.append(f"{feat} has {nulls:,} nulls")

    # Weather nulls — allow up to 0.1%
    if "temperature_c" in actual_cols:
        weather_nulls = df.filter(col("temperature_c").isNull()).count()
        null_counts["temperature_c"] = weather_nulls
        if weather_nulls > 0:
            null_pct = weather_nulls / row_count * 100
            if null_pct > 0.1:
                issues.append(f"temperature_c has {weather_nulls:,} nulls ({null_pct:.2f}%)")
            else:
                warnings.append(f"temperature_c has {weather_nulls:,} nulls ({null_pct:.4f}%) — within threshold")
    stats["null_counts"] = null_counts

    # ── Coverage stats ────────────────────────────────────────────────────
    date_range    = df.agg(spark_min("date").alias("min"), spark_max("date").alias("max")).first()
    station_count = df.select("start_station_id").distinct().count()
    hour_count    = df.select("hour_et").distinct().count()
    total_demand  = df.agg(spark_sum("demand_count")).first()[0]
    zero_pct      = df.filter(col("demand_count") == 0).count() / row_count * 100

    stats["date_range"]     = {"min": str(date_range["min"]), "max": str(date_range["max"])}
    stats["station_count"]  = station_count
    stats["hour_count"]     = hour_count
    stats["total_demand"]   = int(total_demand)
    stats["zero_demand_pct"] = round(zero_pct, 2)

    # ── Demand statistics ─────────────────────────────────────────────────
    demand_stats = df.select(
        avg("demand_count").alias("mean"),
        stddev("demand_count").alias("std"),
        spark_min("demand_count").alias("min"),
        spark_max("demand_count").alias("max"),
    ).first()
    stats["demand_stats"] = {
        "mean": round(float(demand_stats["mean"]), 4),
        "std":  round(float(demand_stats["std"]),  4),
        "min":  int(demand_stats["min"]),
        "max":  int(demand_stats["max"]),
    }

    status = "FAIL" if issues else "PASS"
    logger.info(f"year={year} | status={status} | rows={row_count:,} | stations={station_count} | issues={len(issues)}")
    return {"year": year, "status": status, "issues": issues, "warnings": warnings, "stats": stats}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--train_years", required=True, help="Comma-separated years e.g. 2023,2024")
    parser.add_argument("--bucket",      default=GCS_BUCKET)
    parser.add_argument("--run_id",      default=datetime.utcnow().strftime("%Y%m%dT%H%M%S"))
    args = parser.parse_args()

    years = [y.strip() for y in args.train_years.split(",")]

    print(f"[START] validate_feature_matrix | years={years} | run_id={args.run_id}")

    spark = SparkSession.builder \
        .appName(f"BluebikesValidateFeatures-{args.run_id}") \
        .config("spark.driver.memory", "4g") \
        .getOrCreate()
    spark.sparkContext.setLogLevel("WARN")

    results      = []
    all_passed   = True
    schemas_match = True

    for year in years:
        result = validate_year(spark, args.bucket, year)
        results.append(result)
        if result["status"] == "FAIL":
            all_passed = False

    # ── Cross-year schema consistency check ───────────────────────────────
    if len(results) > 1:
        col_sets = [set(r["stats"].get("columns", [])) for r in results if r["status"] == "PASS"]
        if col_sets:
            reference = col_sets[0]
            for i, col_set in enumerate(col_sets[1:], 1):
                diff = reference.symmetric_difference(col_set)
                if diff:
                    schemas_match = False
                    all_passed    = False
                    logger.error(f"Schema mismatch between years: {diff}")

    # ── Build report ──────────────────────────────────────────────────────
    report = {
        "run_id":        args.run_id,
        "validated_at":  datetime.utcnow().isoformat(),
        "years":         years,
        "overall_status": "PASS" if all_passed else "FAIL",
        "schemas_match":  schemas_match,
        "year_results":   results,
        "ml_ready":       all_passed and schemas_match,
        "recommended_features": [
            "demand_lag_1h", "demand_lag_24h", "demand_lag_168h",
            "rolling_avg_3h", "rolling_avg_6h", "rolling_avg_24h",
            "temperature_c", "precipitation_mm", "feels_like_c",
            "is_cold", "is_hot", "is_precipitation",
            "hour_sin", "hour_cos", "dow_sin", "dow_cos", "month_sin", "month_cos",
            "is_weekend", "is_holiday", "capacity",
        ],
        "target_column": "demand_count",
        "id_columns":    ["start_station_id", "hour_et", "date"],
    }

    # ── Save report ───────────────────────────────────────────────────────
    report_path = f"gs://{args.bucket}/{REPORT_BASE}/{args.run_id}/report.json"
    report_json = json.dumps(report, indent=2)

    subprocess.run(["gsutil", "-m", "rm", "-rf", f"gs://{args.bucket}/{REPORT_BASE}/{args.run_id}/"], capture_output=True)

    spark.sparkContext \
        .parallelize([report_json]) \
        .saveAsTextFile(f"gs://{args.bucket}/{REPORT_BASE}/{args.run_id}/")

    spark.stop()

    # Print summary
    print(f"\n{'='*60}")
    print(f"FEATURE MATRIX VALIDATION REPORT")
    print(f"{'='*60}")
    for r in results:
        print(f"  year={r['year']} | {r['status']} | rows={r['stats'].get('row_count', 0):,} | stations={r['stats'].get('station_count', 0)}")
        if r["issues"]:
            for issue in r["issues"]:
                print(f"    ❌ {issue}")
        if r["warnings"]:
            for w in r["warnings"]:
                print(f"    ⚠️  {w}")
    print(f"{'='*60}")
    print(f"  Schemas match: {schemas_match}")
    print(f"  ML Ready:      {report['ml_ready']}")
    print(f"  Report saved:  {report_path}")
    print(f"{'='*60}\n")

    print(f"[END] validate_feature_matrix | status={'PASS' if all_passed else 'FAIL'} | ml_ready={report['ml_ready']}")

    if not all_passed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()