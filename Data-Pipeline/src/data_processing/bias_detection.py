"""
BlueForecast Bias Detection
Analyzes the feature matrix for systematic disparities across data slices
that could lead to unfair or inaccurate demand predictions.

Slicing dimensions:
  1. Temporal  — weekday vs weekend, peak vs off-peak hours, season
  2. Station   — high-capacity vs low-capacity stations
  3. Weather   — precipitation vs dry, cold vs mild vs hot
  4. Demand    — zero-demand prevalence across slices

For each slice, computes:
  - Mean demand, median demand, zero-demand percentage
  - Sample size (ensures sufficient representation)
  - Disparity ratio (max_group_mean / min_group_mean)

Flags slices where disparity ratio exceeds threshold or where a group
has < 5% of total samples (underrepresentation risk).

Reads from: gs://BUCKET/processed/features/feature_matrix.parquet
Produces:   Bias report dict (logged + returned to Airflow)
"""

import io
import json
import logging
import pandas as pd
import numpy as np
from google.cloud import storage

logger = logging.getLogger("bluebikes_pipeline.bias_detection")
logger.setLevel(logging.INFO)

BUCKET = "bluebikes-demand-predictor-data"
FEATURE_MATRIX_PATH = "processed/features/feature_matrix.parquet"
REPORT_OUTPUT_PATH = "processed/reports/bias_report.json"

# Disparity ratio threshold — flag if max_mean / min_mean exceeds this
DISPARITY_THRESHOLD = 5.0

# Minimum representation — flag if any slice has < this % of total rows
MIN_REPRESENTATION_PCT = 2.0


# ── Slicing functions ───────────────────────────────────────────────────────

def _slice_by_time_of_day(df):
    """Peak (7-9, 16-19) vs Off-peak vs Night (22-6)."""
    conditions = [
        df["hour_of_day"].isin([7, 8, 9, 16, 17, 18, 19]),
        df["hour_of_day"].isin(list(range(22, 24)) + list(range(0, 7))),
    ]
    choices = ["peak", "night"]
    df = df.copy()
    df["time_slice"] = np.select(conditions, choices, default="off_peak")
    return df.groupby("time_slice")


def _slice_by_day_type(df):
    """Weekday vs Weekend vs Holiday."""
    df = df.copy()
    df["day_slice"] = np.where(
        df["is_holiday"] == 1, "holiday",
        np.where(df["is_weekend"] == 1, "weekend", "weekday")
    )
    return df.groupby("day_slice")


def _slice_by_season(df):
    """Spring (3-5), Summer (6-8), Fall (9-11), Winter (12,1,2)."""
    df = df.copy()
    conditions = [
        df["month"].isin([3, 4, 5]),
        df["month"].isin([6, 7, 8]),
        df["month"].isin([9, 10, 11]),
        df["month"].isin([12, 1, 2]),
    ]
    choices = ["spring", "summer", "fall", "winter"]
    df["season_slice"] = np.select(conditions, choices, default="unknown")
    return df.groupby("season_slice")


def _slice_by_station_capacity(df):
    """Low (≤10), Medium (11-20), High (>20) capacity stations."""
    df = df.copy()
    df["capacity_slice"] = pd.cut(
        df["capacity"],
        bins=[0, 10, 20, 999],
        labels=["low_cap", "mid_cap", "high_cap"]
    )
    return df.groupby("capacity_slice", observed=True)


def _slice_by_weather(df):
    """Dry vs Rainy, and Cold vs Mild vs Hot."""
    df = df.copy()
    df["precip_slice"] = np.where(
        df["is_precipitation"] == 1, "rainy", "dry"
    )
    conditions = [
        df["is_cold"] == 1,
        df["is_hot"] == 1,
    ]
    choices = ["cold", "hot"]
    df["temp_slice"] = np.select(conditions, choices, default="mild")
    return df.groupby("precip_slice"), df.groupby("temp_slice")


# ── Analysis helpers ────────────────────────────────────────────────────────

def _analyze_slice(grouped, slice_name, total_rows):
    """Compute bias metrics for a single slicing dimension."""
    stats = []
    for name, group in grouped:
        n = len(group)
        mean_demand = float(group["demand_count"].mean())
        median_demand = float(group["demand_count"].median())
        zero_pct = float((group["demand_count"] == 0).mean() * 100)
        representation_pct = round(n / total_rows * 100, 2)

        stats.append({
            "group": str(name),
            "count": n,
            "representation_pct": representation_pct,
            "mean_demand": round(mean_demand, 3),
            "median_demand": round(median_demand, 1),
            "zero_demand_pct": round(zero_pct, 1),
        })

    if not stats:
        return None

    means = [s["mean_demand"] for s in stats if s["mean_demand"] > 0]
    disparity_ratio = round(max(means) / min(means), 2) if len(means) >= 2 else 1.0

    # Detect flags
    flags = []
    if disparity_ratio > DISPARITY_THRESHOLD:
        flags.append(
            f"High disparity ratio ({disparity_ratio}x) exceeds "
            f"threshold ({DISPARITY_THRESHOLD}x)"
        )
    for s in stats:
        if s["representation_pct"] < MIN_REPRESENTATION_PCT:
            flags.append(
                f"Group '{s['group']}' underrepresented: "
                f"{s['representation_pct']}% < {MIN_REPRESENTATION_PCT}%"
            )

    return {
        "slice_name": slice_name,
        "groups": stats,
        "disparity_ratio": disparity_ratio,
        "flags": flags,
    }


# ── Main callable ───────────────────────────────────────────────────────────

def detect_bias(**kwargs):
    """
    Airflow-callable: load feature matrix, analyze across multiple slicing
    dimensions, produce bias report, upload to GCS.

    Reads from: gs://BUCKET/processed/features/feature_matrix.parquet
    Writes to:  gs://BUCKET/processed/reports/bias_report.json
    Returns:    Summary string
    Raises:     RuntimeError if feature matrix not found
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
    total_rows = len(df)
    logger.info("Loaded feature matrix: %d rows × %d columns", total_rows, len(df.columns))

    # ── Run all slicing analyses ────────────────────────────────────────────
    report = {"total_rows": total_rows, "slices": [], "total_flags": 0}

    # 1. Time of day
    logger.info("Analyzing slice: time_of_day...")
    result = _analyze_slice(_slice_by_time_of_day(df), "time_of_day", total_rows)
    if result:
        report["slices"].append(result)

    # 2. Day type
    logger.info("Analyzing slice: day_type...")
    result = _analyze_slice(_slice_by_day_type(df), "day_type", total_rows)
    if result:
        report["slices"].append(result)

    # 3. Season
    logger.info("Analyzing slice: season...")
    result = _analyze_slice(_slice_by_season(df), "season", total_rows)
    if result:
        report["slices"].append(result)

    # 4. Station capacity
    logger.info("Analyzing slice: station_capacity...")
    result = _analyze_slice(
        _slice_by_station_capacity(df), "station_capacity", total_rows
    )
    if result:
        report["slices"].append(result)

    # 5. Weather (two sub-slices)
    logger.info("Analyzing slice: precipitation & temperature...")
    precip_grp, temp_grp = _slice_by_weather(df)
    result = _analyze_slice(precip_grp, "precipitation", total_rows)
    if result:
        report["slices"].append(result)
    result = _analyze_slice(temp_grp, "temperature", total_rows)
    if result:
        report["slices"].append(result)

    # ── Summarize flags ─────────────────────────────────────────────────────
    all_flags = []
    for s in report["slices"]:
        all_flags.extend(s["flags"])
    report["total_flags"] = len(all_flags)

    # ── Log report ──────────────────────────────────────────────────────────
    logger.info("=" * 60)
    logger.info("BIAS DETECTION REPORT")
    logger.info("=" * 60)

    for s in report["slices"]:
        logger.info("")
        logger.info("Slice: %s (disparity ratio: %.2fx)", s["slice_name"], s["disparity_ratio"])
        for g in s["groups"]:
            logger.info(
                "  %-12s | n=%8s (%5.1f%%) | mean=%.3f | median=%.1f | zero=%.1f%%",
                g["group"],
                f"{g['count']:,}",
                g["representation_pct"],
                g["mean_demand"],
                g["median_demand"],
                g["zero_demand_pct"],
            )
        if s["flags"]:
            for flag in s["flags"]:
                logger.warning("  ⚠ FLAG: %s", flag)

    logger.info("")
    logger.info("Total flags: %d", report["total_flags"])
    logger.info("=" * 60)

    # ── Upload report to GCS ────────────────────────────────────────────────
    report_json = json.dumps(report, indent=2, default=str)
    blob = client.bucket(BUCKET).blob(REPORT_OUTPUT_PATH)
    blob.upload_from_string(report_json, content_type="application/json")
    logger.info("Uploaded bias report to gs://%s/%s", BUCKET, REPORT_OUTPUT_PATH)

    summary = (
        f"Bias detection complete: {len(report['slices'])} slices analyzed, "
        f"{report['total_flags']} flag(s) raised"
    )
    logger.info(summary)
    return summary