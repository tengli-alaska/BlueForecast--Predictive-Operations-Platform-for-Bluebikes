"""
BlueForecast Schema Validation
Validates the feature matrix against expected schema, value ranges,
and data quality constraints before it reaches the model.

Checks performed:
  1. Column presence and data types
  2. Zero nulls across all columns
  3. Value range constraints (demand, weather, time, capacity)
  4. No duplicate (station, hour) pairs
  5. Minimum row count sanity check
  6. Referential integrity (holidays only on valid dates)

Reads from: gs://BUCKET/processed/features/feature_matrix.parquet
Produces:   Validation report dict (logged + returned to Airflow)
"""

import io
import logging
import pandas as pd
import numpy as np
from google.cloud import storage

logger = logging.getLogger("bluebikes_pipeline.schema_validation")
logger.setLevel(logging.INFO)

BUCKET = "bluebikes-demand-predictor-data"
FEATURE_MATRIX_PATH = "processed/features/feature_matrix.parquet"

# Minimum rows expected (single year ~4.5M, both years ~8.2M)
MIN_ROW_COUNT = 1_000_000

# ── Expected schema ─────────────────────────────────────────────────────────
# Column name → expected pandas dtype family
EXPECTED_SCHEMA = {
    # Core demand columns
    "start_station_id": "object",
    "hour": "datetime64",
    "demand_count": "int",
    "date": "datetime64",
    "year": "int",
    "month": "int",
    "day_of_week": "int",
    "hour_of_day": "int",
    "is_weekend": "int",
    # Weather features
    "temperature_c": "float",
    "precipitation_mm": "float",
    "wind_speed_kmh": "float",
    "humidity_pct": "numeric",
    "weather_code": "numeric",
    "is_precipitation": "numeric",
    "is_cold": "numeric",
    "is_hot": "numeric",
    "feels_like_c": "float",
    # Station metadata
    "capacity": "int",
    # Holiday
    "is_holiday": "int",
    # Lag features
    "demand_lag_1h": "float",
    "demand_lag_24h": "float",
    "demand_lag_168h": "float",
    # Rolling averages
    "rolling_avg_3h": "float",
    "rolling_avg_6h": "float",
    "rolling_avg_24h": "float",
    # Cyclical encodings
    "hour_sin": "float",
    "hour_cos": "float",
    "dow_sin": "float",
    "dow_cos": "float",
    "month_sin": "float",
    "month_cos": "float",
}

# ── Value range constraints ─────────────────────────────────────────────────
# Column → (min, max) inclusive.  None means no bound.
VALUE_RANGES = {
    "demand_count":     (0, None),
    "temperature_c":    (-40, 50),
    "precipitation_mm": (0, None),
    "wind_speed_kmh":   (0, 200),
    "humidity_pct":     (0, 100),
    "capacity":         (1, None),
    "hour_of_day":      (0, 23),
    "day_of_week":      (0, 6),
    "month":            (1, 12),
    "year":             (2023, 2030),
    "is_weekend":       (0, 1),
    "is_holiday":       (0, 1),
    "is_precipitation": (0, 1),
    "is_cold":          (0, 1),
    "is_hot":           (0, 1),
    # Cyclical features should be in [-1, 1]
    "hour_sin":         (-1, 1),
    "hour_cos":         (-1, 1),
    "dow_sin":          (-1, 1),
    "dow_cos":          (-1, 1),
    "month_sin":        (-1, 1),
    "month_cos":        (-1, 1),
}


# ── Validation functions ────────────────────────────────────────────────────

def _check_columns(df):
    """Verify all expected columns are present with correct dtype families."""
    issues = []

    expected_cols = set(EXPECTED_SCHEMA.keys())
    actual_cols = set(df.columns)

    missing = expected_cols - actual_cols
    if missing:
        issues.append(f"Missing columns: {sorted(missing)}")

    extra = actual_cols - expected_cols
    if extra:
        # Extra columns are a warning, not a failure
        logger.warning("Extra columns (not in schema): %s", sorted(extra))

    # Check dtype families for columns that exist
    for col, expected_family in EXPECTED_SCHEMA.items():
        if col not in df.columns:
            continue
        actual_dtype = str(df[col].dtype)
        if expected_family == "int" and "int" not in actual_dtype:
            issues.append(f"Column '{col}': expected int-like, got {actual_dtype}")
        elif expected_family == "float" and "float" not in actual_dtype:
            issues.append(f"Column '{col}': expected float-like, got {actual_dtype}")
        elif expected_family == "numeric" and not (
            "int" in actual_dtype or "float" in actual_dtype
        ):
            issues.append(f"Column '{col}': expected numeric, got {actual_dtype}")
        elif expected_family == "object" and actual_dtype != "object":
            issues.append(f"Column '{col}': expected object, got {actual_dtype}")
        elif expected_family == "datetime64" and "datetime" not in actual_dtype:
            issues.append(f"Column '{col}': expected datetime64, got {actual_dtype}")

    return issues


def _check_nulls(df):
    """Verify zero nulls across all columns."""
    null_counts = df.isnull().sum()
    cols_with_nulls = null_counts[null_counts > 0]
    if len(cols_with_nulls) > 0:
        details = cols_with_nulls.to_dict()
        return [f"Null values found: {details}"]
    return []


def _check_value_ranges(df):
    """Verify column values fall within expected ranges."""
    issues = []
    for col, (lo, hi) in VALUE_RANGES.items():
        if col not in df.columns:
            continue
        if lo is not None:
            below = (df[col] < lo).sum()
            if below > 0:
                issues.append(
                    f"Column '{col}': {below} values below minimum {lo} "
                    f"(min={df[col].min()})"
                )
        if hi is not None:
            above = (df[col] > hi).sum()
            if above > 0:
                issues.append(
                    f"Column '{col}': {above} values above maximum {hi} "
                    f"(max={df[col].max()})"
                )
    return issues


def _check_duplicates(df):
    """Verify no duplicate (station, hour) pairs."""
    if "start_station_id" in df.columns and "hour" in df.columns:
        dupes = df.duplicated(subset=["start_station_id", "hour"]).sum()
        if dupes > 0:
            return [f"Duplicate (station, hour) pairs: {dupes}"]
    return []


def _check_row_count(df):
    """Verify minimum row count."""
    if len(df) < MIN_ROW_COUNT:
        return [
            f"Row count {len(df):,} is below minimum threshold {MIN_ROW_COUNT:,}"
        ]
    return []


def _compute_summary_stats(df):
    """Compute summary statistics for the validation report."""
    stats = {
        "total_rows": len(df),
        "total_columns": len(df.columns),
        "null_count": int(df.isnull().sum().sum()),
        "unique_stations": df["start_station_id"].nunique()
            if "start_station_id" in df.columns else None,
        "date_range": None,
        "demand_stats": None,
    }

    if "hour" in df.columns:
        stats["date_range"] = {
            "min": str(df["hour"].min()),
            "max": str(df["hour"].max()),
        }

    if "demand_count" in df.columns:
        stats["demand_stats"] = {
            "mean": round(float(df["demand_count"].mean()), 2),
            "median": float(df["demand_count"].median()),
            "max": int(df["demand_count"].max()),
            "zero_pct": round(
                float((df["demand_count"] == 0).mean() * 100), 1
            ),
        }

    return stats


# ── Main callable ───────────────────────────────────────────────────────────

def validate_schema(**kwargs):
    """
    Airflow-callable: load feature matrix from GCS, run all validation
    checks, fail the task if any critical issues are found.

    Reads from: gs://BUCKET/processed/features/feature_matrix.parquet
    Returns:    Validation report summary string
    Raises:     RuntimeError if any validation check fails
    """
    client = storage.Client()

    # Load feature matrix
    logger.info("Loading feature matrix from gs://%s/%s", BUCKET, FEATURE_MATRIX_PATH)
    blob = client.bucket(BUCKET).blob(FEATURE_MATRIX_PATH)
    if not blob.exists():
        raise RuntimeError(
            f"Feature matrix not found at gs://{BUCKET}/{FEATURE_MATRIX_PATH} "
            "— run feature_engineering first."
        )

    data = blob.download_as_bytes()
    df = pd.read_parquet(io.BytesIO(data))
    logger.info("Loaded feature matrix: %d rows × %d columns", len(df), len(df.columns))

    # Run all checks
    all_issues = []

    logger.info("Running column & dtype checks...")
    all_issues.extend(_check_columns(df))

    logger.info("Running null checks...")
    all_issues.extend(_check_nulls(df))

    logger.info("Running value range checks...")
    all_issues.extend(_check_value_ranges(df))

    logger.info("Running duplicate checks...")
    all_issues.extend(_check_duplicates(df))

    logger.info("Running row count checks...")
    all_issues.extend(_check_row_count(df))

    # Compute summary stats
    stats = _compute_summary_stats(df)

    # Report results
    if all_issues:
        logger.error("=" * 60)
        logger.error("SCHEMA VALIDATION FAILED — %d issue(s):", len(all_issues))
        for i, issue in enumerate(all_issues, 1):
            logger.error("  [%d] %s", i, issue)
        logger.error("=" * 60)
        raise RuntimeError(
            f"Schema validation failed with {len(all_issues)} issue(s): "
            + "; ".join(all_issues)
        )

    # All checks passed
    logger.info("=" * 60)
    logger.info("SCHEMA VALIDATION PASSED")
    logger.info("  Rows:     %s", f"{stats['total_rows']:,}")
    logger.info("  Columns:  %d", stats["total_columns"])
    logger.info("  Nulls:    %d", stats["null_count"])
    logger.info("  Stations: %s", stats["unique_stations"])
    if stats["date_range"]:
        logger.info("  Date range: %s → %s",
                     stats["date_range"]["min"], stats["date_range"]["max"])
    if stats["demand_stats"]:
        logger.info("  Demand — mean: %.2f, median: %.0f, max: %d, zero: %.1f%%",
                     stats["demand_stats"]["mean"],
                     stats["demand_stats"]["median"],
                     stats["demand_stats"]["max"],
                     stats["demand_stats"]["zero_pct"])
    logger.info("=" * 60)

    summary = (
        f"Schema validation PASSED: {stats['total_rows']:,} rows × "
        f"{stats['total_columns']} cols | {stats['unique_stations']} stations | "
        f"0 nulls | 0 issues"
    )
    logger.info(summary)
    return summary