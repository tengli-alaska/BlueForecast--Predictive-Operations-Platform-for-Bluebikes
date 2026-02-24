"""
BlueForecast Aggregate Demand
Converts 7.88M cleaned trips → hourly pickup counts per station.

Based on analysis from 05_aggregate_demand.ipynb:
- Reads cleaned parquet from GCS (processed/cleaned/year=*/cleaned.parquet)
- Converts UTC → Eastern Time (fixes morning/evening peaks)
- Creates complete grid: 534 stations × 15,384 hours (Apr 2023–Dec 2024)
- Fills zero-demand slots (68.6% sparsity)
- Output: 8,215,056 station-hour rows

Memory-optimized for Airflow Docker containers (4–6 GB).
"""

import gc
import io
import logging
import pandas as pd
import numpy as np
from google.cloud import storage

logger = logging.getLogger("bluebikes_pipeline.aggregate_demand")
logger.setLevel(logging.INFO)

BUCKET = "bluebikes-demand-predictor-data"
CLEANED_PREFIX = "processed/cleaned"
OUTPUT_PATH = "processed/features/hourly_demand_by_station.parquet"


def _load_cleaned_year(client, year):
    """Download cleaned parquet for a given year from GCS.
    Only loads columns needed for aggregation to save memory."""
    path = f"{CLEANED_PREFIX}/year={year}/cleaned.parquet"
    bucket = client.bucket(BUCKET)
    blob = bucket.blob(path)
    if not blob.exists():
        logger.warning("Cleaned file not found: %s — skipping", path)
        return None
    data = blob.download_as_bytes()
    # Only read columns needed for aggregation
    df = pd.read_parquet(
        io.BytesIO(data),
        columns=["started_at", "start_station_id"]
    )
    logger.info("Loaded year=%s: %d rows", year, len(df))
    return df


def aggregate_demand(**kwargs):
    """
    Airflow-callable: load cleaned trips, aggregate to hourly station demand,
    upload result parquet back to GCS.

    Reads from:  gs://BUCKET/processed/cleaned/year=*/cleaned.parquet
    Writes to:   gs://BUCKET/processed/features/hourly_demand_by_station.parquet
    """
    client = storage.Client()

    # --- 1. Load cleaned data for both years ---
    frames = []
    for year in [2023, 2024]:
        df = _load_cleaned_year(client, year)
        if df is not None:
            frames.append(df)

    if not frames:
        raise RuntimeError("No cleaned data found — run data_cleaning first.")

    trips = pd.concat(frames, ignore_index=True)
    del frames
    gc.collect()
    total_trips = len(trips)
    logger.info("Combined trips: %d rows", total_trips)

    # --- 2. Convert UTC → Eastern Time, floor to hour ---
    trips["started_at"] = pd.to_datetime(trips["started_at"])
    trips["hour"] = (
        trips["started_at"]
        .dt.tz_localize("UTC")
        .dt.tz_convert("US/Eastern")
        .dt.tz_localize(None)
        .dt.floor("h")
    )
    logger.info("Converted timestamps to Eastern Time")

    # --- 3. Count pickups per (station, hour) — then free trips ---
    actual_demand = (
        trips
        .groupby(["start_station_id", "hour"])
        .size()
        .reset_index(name="demand_count")
    )
    del trips
    gc.collect()

    n_stations = actual_demand["start_station_id"].nunique()
    logger.info(
        "Actual demand rows: %d | Unique stations: %d | Date range: %s → %s",
        len(actual_demand),
        n_stations,
        actual_demand["hour"].min(),
        actual_demand["hour"].max(),
    )

    # --- 4. Build complete station × hour grid ---
    all_stations = actual_demand["start_station_id"].unique()
    hour_min = actual_demand["hour"].min()
    hour_max = actual_demand["hour"].max()
    all_hours = pd.date_range(start=hour_min, end=hour_max, freq="h")

    complete_grid = (
        pd.DataFrame({"start_station_id": all_stations})
        .merge(pd.DataFrame({"hour": all_hours}), how="cross")
    )
    logger.info(
        "Complete grid: %d stations × %d hours = %d rows",
        len(all_stations), len(all_hours), len(complete_grid)
    )

    # --- 5. Left-join actual demand; fill zeros ---
    hourly_demand = complete_grid.merge(
        actual_demand,
        on=["start_station_id", "hour"],
        how="left"
    )
    del complete_grid, actual_demand
    gc.collect()

    # Use int32 instead of int64 to halve memory
    hourly_demand["demand_count"] = (
        hourly_demand["demand_count"].fillna(0).astype(np.int32)
    )

    zero_pct = (hourly_demand["demand_count"] == 0).mean() * 100
    logger.info(
        "Final table: %d rows | Zero-demand rows: %.1f%%",
        len(hourly_demand), zero_pct
    )

    # --- 6. Add time feature columns (use int16 where possible) ---
    hourly_demand["date"] = hourly_demand["hour"].dt.date
    hourly_demand["year"] = hourly_demand["hour"].dt.year.astype(np.int16)
    hourly_demand["month"] = hourly_demand["hour"].dt.month.astype(np.int8)
    hourly_demand["day_of_week"] = hourly_demand["hour"].dt.dayofweek.astype(np.int8)
    hourly_demand["hour_of_day"] = hourly_demand["hour"].dt.hour.astype(np.int8)
    hourly_demand["is_weekend"] = (
        hourly_demand["day_of_week"].isin([5, 6]).astype(np.int8)
    )

    # --- 7. Validate ---
    total_demand = int(hourly_demand["demand_count"].sum())
    dupes = hourly_demand.duplicated(subset=["start_station_id", "hour"]).sum()
    nulls = hourly_demand["demand_count"].isnull().sum()

    assert dupes == 0, f"Duplicate (station, hour) pairs: {dupes}"
    assert nulls == 0, f"Null demand counts: {nulls}"
    assert total_demand == total_trips, (
        f"Demand sum {total_demand} != trip count {total_trips}"
    )
    logger.info(
        "Validation passed: total_demand=%d, dupes=%d, nulls=%d",
        total_demand, dupes, nulls
    )

    # --- 8. Sort and upload to GCS ---
    hourly_demand = hourly_demand.sort_values(
        ["start_station_id", "hour"]
    ).reset_index(drop=True)
    gc.collect()

    out_buf = io.BytesIO()
    hourly_demand.to_parquet(out_buf, index=False)
    out_buf.seek(0)

    bucket = client.bucket(BUCKET)
    blob = bucket.blob(OUTPUT_PATH)
    blob.upload_from_file(out_buf, content_type="application/octet-stream")

    size_mb = out_buf.tell() / (1024 * 1024)
    logger.info(
        "Uploaded gs://%s/%s (%.1f MB, %d rows)",
        BUCKET, OUTPUT_PATH, size_mb, len(hourly_demand)
    )

    summary = (
        f"Aggregated {total_trips:,} trips → {len(hourly_demand):,} station-hour rows "
        f"({n_stations} stations, {len(all_hours):,} hours, {zero_pct:.1f}% zero-demand)"
    )
    logger.info(summary)
    return summary