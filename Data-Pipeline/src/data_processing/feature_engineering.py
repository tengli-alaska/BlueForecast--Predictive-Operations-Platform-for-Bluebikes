"""
BlueForecast Feature Engineering
Joins hourly demand with weather, station metadata, and holidays.
Adds lag features and cyclical time encodings.

Based on analysis from 06_feature_engineering.ipynb:
- Reads 4 data sources from GCS
- Station ID mismatch resolved: name match (497) + coordinate match (29)
- 8 unmatched stations filled with median capacity (17)
- Lag features: 1h, 24h, 168h (shifted to prevent leakage)
- Rolling averages: 3h, 6h, 24h
- Cyclical encoding for hour, day-of-week, month
- Output: 8,215,056 rows × 32 columns, zero nulls
"""

import gc
import io
import logging
import numpy as np
import pandas as pd
from scipy.spatial import cKDTree
from google.cloud import storage

logger = logging.getLogger("bluebikes_pipeline.feature_engineering")
logger.setLevel(logging.INFO)

BUCKET = "bluebikes-demand-predictor-data"

# GCS paths for all input sources — matched to actual bucket layout
DEMAND_PATH   = "processed/features/hourly_demand_by_station.parquet"
WEATHER_PATH  = "processed/weather/weather_hourly.parquet"          # FIXED
STATIONS_PATH = "processed/stations/stations.parquet"               # FIXED
HOLIDAYS_PATH = "data/contextual/us_holidays_2023_2024.parquet"
OUTPUT_PATH   = "processed/features/feature_matrix.parquet"

# Station coordinate match threshold (metres)
COORD_THRESHOLD_M = 500

# Median fallback capacity for unmatched stations
MEDIAN_CAPACITY_DEFAULT = 17


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_parquet(client, path):
    """Download a parquet file from GCS and return as DataFrame."""
    blob = client.bucket(BUCKET).blob(path)
    data = blob.download_as_bytes()
    df = pd.read_parquet(io.BytesIO(data))
    logger.info("Loaded gs://%s/%s: %d rows", BUCKET, path, len(df))
    return df


def _build_station_lookup(trips_sample, stations):
    """
    Build a station_id → capacity mapping using two strategies:
      1. Exact name match between trip data and station metadata
      2. Nearest-neighbour coordinate match (within COORD_THRESHOLD_M)

    Returns a DataFrame with columns [start_station_id, capacity].
    """
    trip_stations = (
        trips_sample
        .groupby("start_station_id")
        .agg(start_station_name=("start_station_name", "first"),
             start_lat=("start_lat", "median"),
             start_lng=("start_lng", "median"))
        .reset_index()
    )
    logger.info("Unique stations in trip data: %d", len(trip_stations))

    # --- Strategy 1: exact name match ---
    name_matched = trip_stations.merge(
        stations[["station_name", "capacity"]],
        left_on="start_station_name",
        right_on="station_name",
        how="left"
    )[["start_station_id", "capacity"]]

    matched_mask = name_matched["capacity"].notna()
    logger.info("Name-matched stations: %d", matched_mask.sum())

    # --- Strategy 2: coordinate match for remaining stations ---
    unmatched = trip_stations[~matched_mask.values].copy()

    meta_coords = stations[["lat", "lon"]].values
    tree = cKDTree(meta_coords)

    coord_rows = []
    for _, row in unmatched.iterrows():
        dist_deg, idx = tree.query([row["start_lat"], row["start_lng"]])
        dist_m = dist_deg * 111_000
        if dist_m <= COORD_THRESHOLD_M:
            coord_rows.append({
                "start_station_id": row["start_station_id"],
                "capacity": stations.iloc[idx]["capacity"]
            })
            logger.debug("Coord match: %s → %s (%.0fm)",
                         row["start_station_name"],
                         stations.iloc[idx]["station_name"],
                         dist_m)
        else:
            logger.debug("No match (%.0fm > threshold): %s",
                         dist_m, row["start_station_name"])

    coord_matched = pd.DataFrame(coord_rows) if coord_rows else pd.DataFrame(
        columns=["start_station_id", "capacity"]
    )
    logger.info("Coordinate-matched stations: %d", len(coord_matched))

    lookup = pd.concat(
        [name_matched[matched_mask], coord_matched],
        ignore_index=True
    )
    logger.info("Total stations with metadata: %d / %d",
                len(lookup), len(trip_stations))
    return lookup


# ---------------------------------------------------------------------------
# Main callable
# ---------------------------------------------------------------------------

def feature_engineering(**kwargs):
    """
    Airflow-callable: join all data sources, build lag/rolling/cyclical
    features, upload feature matrix to GCS.

    Reads from:
      gs://BUCKET/processed/features/hourly_demand_by_station.parquet
      gs://BUCKET/processed/weather/weather_hourly.parquet
      gs://BUCKET/processed/stations/stations.parquet
      gs://BUCKET/data/contextual/us_holidays_2023_2024.parquet

    Writes to:
      gs://BUCKET/processed/features/feature_matrix.parquet
    """
    client = storage.Client()

    # -----------------------------------------------------------------------
    # 1. Load all data sources
    # -----------------------------------------------------------------------
    demand   = _load_parquet(client, DEMAND_PATH)
    weather  = _load_parquet(client, WEATHER_PATH)
    stations = _load_parquet(client, STATIONS_PATH)
    holidays = _load_parquet(client, HOLIDAYS_PATH)

    # -----------------------------------------------------------------------
    # 2. Join weather (left join on hourly timestamp)
    # -----------------------------------------------------------------------
    weather_features = weather[[
        "datetime", "temperature_c", "precipitation_mm", "wind_speed_kmh",
        "humidity_pct", "weather_code", "is_precipitation", "is_cold",
        "is_hot", "feels_like_c"
    ]].copy()
    del weather
    gc.collect()

    df = demand.merge(
        weather_features,
        left_on="hour",
        right_on="datetime",
        how="left"
    ).drop(columns=["datetime"])
    del weather_features, demand
    gc.collect()
    
    weather_nulls = df["temperature_c"].isnull().sum()
    logger.info(
        "After weather join: %d rows | missing weather: %d (%.2f%%)",
        len(df), weather_nulls, weather_nulls / len(df) * 100
    )

    # Forward-fill missing weather (small gaps at edges of date range)
    weather_cols = ["temperature_c", "precipitation_mm", "wind_speed_kmh",
                    "humidity_pct", "weather_code", "is_precipitation",
                    "is_cold", "is_hot", "feels_like_c"]
    df[weather_cols] = df[weather_cols].ffill().bfill()
    logger.info("Weather nulls after fill: %d", df[weather_cols].isnull().sum().sum())

    # -----------------------------------------------------------------------
    # 3. Join station capacity
    #    Station IDs in trips (e.g. 'A32000') differ from metadata UUIDs,
    #    so we resolve via name + coordinate matching using the cleaned trips.
    # -----------------------------------------------------------------------
    trips_sample = pd.concat([
        _load_parquet(client, f"processed/cleaned/year={y}/cleaned.parquet")
        for y in [2023, 2024]
        if client.bucket(BUCKET).blob(
            f"processed/cleaned/year={y}/cleaned.parquet"
        ).exists()
    ], ignore_index=True)[["start_station_id", "start_station_name",
                            "start_lat", "start_lng"]]

    station_lookup = _build_station_lookup(trips_sample, stations)
    del trips_sample, stations
    gc.collect()

    df = df.merge(station_lookup, on="start_station_id", how="left")

    # Fill unmatched stations with median capacity
    median_cap = int(
        station_lookup["capacity"].median()
        if not station_lookup.empty
        else MEDIAN_CAPACITY_DEFAULT
    )
    missing_cap = df["capacity"].isnull().sum()
    df["capacity"] = df["capacity"].fillna(median_cap).astype(int)
    logger.info(
        "Station capacity: %d missing → filled with median (%d)",
        missing_cap, median_cap
    )

    # -----------------------------------------------------------------------
    # 4. Join holidays (on date)
    # -----------------------------------------------------------------------
    df["date"] = pd.to_datetime(df["date"])

    df = df.merge(
        holidays[["date", "is_holiday"]],
        on="date",
        how="left"
    )
    df["is_holiday"] = df["is_holiday"].fillna(0).astype(int)

    holiday_rows = (df["is_holiday"] == 1).sum()
    logger.info("Holiday rows: %d / %d", holiday_rows, len(df))

    # -----------------------------------------------------------------------
    # 5. Lag features (shift per station to prevent data leakage)
    # -----------------------------------------------------------------------
    df = df.sort_values(["start_station_id", "hour"]).reset_index(drop=True)

    logger.info("Computing lag features...")
    grp = df.groupby("start_station_id")["demand_count"]
    df["demand_lag_1h"]   = grp.shift(1)
    df["demand_lag_24h"]  = grp.shift(24)
    df["demand_lag_168h"] = grp.shift(168)

    # -----------------------------------------------------------------------
    # 6. Rolling average features (shift(1) ensures no leakage)
    # -----------------------------------------------------------------------
    logger.info("Computing rolling average features...")
    for window, col in [(3, "rolling_avg_3h"),
                        (6, "rolling_avg_6h"),
                        (24, "rolling_avg_24h")]:
        df[col] = (
            df.groupby("start_station_id")["demand_count"]
            .transform(lambda x, w=window: x.shift(1).rolling(w, min_periods=1).mean())
        )

    # Fill lag/rolling nulls (first rows of each station — no history)
    lag_cols = ["demand_lag_1h", "demand_lag_24h", "demand_lag_168h",
                "rolling_avg_3h", "rolling_avg_6h", "rolling_avg_24h"]
    df[lag_cols] = df[lag_cols].fillna(0)
    logger.info("Lag/rolling nulls after fill: %d", df[lag_cols].isnull().sum().sum())

    # -----------------------------------------------------------------------
    # 7. Cyclical time encodings
    #    Preserves circular relationships (e.g. hour 23 ≈ hour 0)
    # -----------------------------------------------------------------------
    df["hour_sin"]   = np.sin(2 * np.pi * df["hour_of_day"] / 24)
    df["hour_cos"]   = np.cos(2 * np.pi * df["hour_of_day"] / 24)
    df["dow_sin"]    = np.sin(2 * np.pi * df["day_of_week"] / 7)
    df["dow_cos"]    = np.cos(2 * np.pi * df["day_of_week"] / 7)
    df["month_sin"]  = np.sin(2 * np.pi * df["month"] / 12)
    df["month_cos"]  = np.cos(2 * np.pi * df["month"] / 12)

    # -----------------------------------------------------------------------
    # 8. Validate
    # -----------------------------------------------------------------------
    total_nulls = df.isnull().sum().sum()
    assert total_nulls == 0, f"Unexpected nulls in feature matrix: {total_nulls}"
    logger.info(
        "Validation passed: %d rows × %d columns, zero nulls",
        len(df), len(df.columns)
    )

    # -----------------------------------------------------------------------
    # 9. Upload to GCS
    # -----------------------------------------------------------------------
    df = df.sort_values(["start_station_id", "hour"]).reset_index(drop=True)

    out_buf = io.BytesIO()
    df.to_parquet(out_buf, index=False)
    out_buf.seek(0)

    blob = client.bucket(BUCKET).blob(OUTPUT_PATH)
    blob.upload_from_file(out_buf, content_type="application/octet-stream")

    size_mb = out_buf.tell() / (1024 * 1024)
    logger.info(
        "Uploaded gs://%s/%s (%.1f MB, %d rows × %d cols)",
        BUCKET, OUTPUT_PATH, size_mb, len(df), len(df.columns)
    )

    summary = (
        f"Feature matrix: {len(df):,} rows × {len(df.columns)} cols | "
        f"27 ML features | 0 nulls | "
        f"Station match: name({(~station_lookup['capacity'].isna()).sum()}) "
        f"+ coord({len(station_lookup) - (~station_lookup['capacity'].isna()).sum()}) "
        f"+ median_fill({missing_cap})"
    )
    logger.info(summary)
    return summary