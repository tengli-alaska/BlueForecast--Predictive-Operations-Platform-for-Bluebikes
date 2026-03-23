"""
Data loader and training contract for the BlueForecast model pipeline.

Reads:  gs://bluebikes-demand-predictor-data/processed/features/feature_matrix.parquet
Output: (df, dataset_version_hash)

The dataset_version_hash is the MD5 of the raw parquet bytes.
Log it with every MLflow run for full data provenance.
"""

import hashlib
import io
import logging
import pickle

import pandas as pd
from sklearn.preprocessing import LabelEncoder
from google.cloud import storage

logger = logging.getLogger("model_pipeline.data_loader")
logger.setLevel(logging.INFO)

BUCKET = "bluebikes-demand-predictor-data"
FEATURE_MATRIX_PATH = "processed/features/feature_matrix.parquet"

TARGET = "demand_count"

# Explicit feature contract — every column named here must exist.
# These 30 columns are the only inputs the model will ever see.
# If this list changes, it is an architectural decision requiring lead approval.
FEATURE_COLS = [
    # Station identifier (categorical — XGBoost will treat as numeric ID)
    "start_station_id",
    "capacity",
    # Time features
    "hour_of_day",
    "day_of_week",
    "month",
    "year",
    "is_weekend",
    "is_holiday",
    # Cyclical encodings (preserve circular distance for hour/day/month)
    "hour_sin",
    "hour_cos",
    "dow_sin",
    "dow_cos",
    "month_sin",
    "month_cos",
    # Lag features (historical demand — most predictive signals)
    "demand_lag_1h",
    "demand_lag_24h",
    "demand_lag_168h",
    # Rolling averages (smoothed recent demand)
    "rolling_avg_3h",
    "rolling_avg_6h",
    "rolling_avg_24h",
    # Weather features
    "temperature_c",
    "precipitation_mm",
    "wind_speed_kmh",
    "humidity_pct",
    "feels_like_c",
    "is_cold",
    "is_hot",
    "is_precipitation",
    # Raw weather code kept for future model extensions
    "weather_code",
]

# Columns required in the raw parquet (superset of features + target + split key)
REQUIRED_COLUMNS = FEATURE_COLS + [TARGET, "hour"]


def load_feature_matrix() -> tuple[pd.DataFrame, str]:
    """
    Load the feature matrix from GCS and validate the training contract.

    Returns
    -------
    df : pd.DataFrame
        Full feature matrix with all REQUIRED_COLUMNS present.
    dataset_version_hash : str
        MD5 hex digest of the raw parquet bytes. Log this with every MLflow run.
    """
    logger.info("Loading feature matrix from gs://%s/%s", BUCKET, FEATURE_MATRIX_PATH)

    client = storage.Client()
    blob = client.bucket(BUCKET).blob(FEATURE_MATRIX_PATH)

    if not blob.exists():
        raise RuntimeError(
            f"Feature matrix not found at gs://{BUCKET}/{FEATURE_MATRIX_PATH}. "
            "Run the data pipeline first."
        )

    raw_bytes = blob.download_as_bytes()
    dataset_version_hash = hashlib.md5(raw_bytes).hexdigest()
    logger.info("Dataset version hash (MD5): %s", dataset_version_hash)

    df = pd.read_parquet(io.BytesIO(raw_bytes))
    logger.info("Loaded: %s rows × %s columns", f"{len(df):,}", df.shape[1])

    # Encode station ID as integer — raw values are strings like 'A32000'
    # XGBoost requires all features to be numeric
    if "start_station_id" in df.columns:
        le = LabelEncoder()
        df["start_station_id"] = le.fit_transform(df["start_station_id"].astype(str))
        logger.info("Encoded start_station_id: %s unique stations", df["start_station_id"].nunique())
        
        # Save encoder to GCS
        le_bytes = pickle.dumps(le)
        enc_blob = client.bucket(BUCKET).blob("processed/features/station_label_encoder.pkl")
        enc_blob.upload_from_string(le_bytes)
        logger.info("LabelEncoder saved to GCS")

    _validate_schema(df)

    if df.shape[0] < 1_000_000:
        raise RuntimeError(
            f"Dataset too small: {df.shape[0]:,} rows (minimum 1,000,000). "
            "Run the data pipeline first."
        )

    return df, dataset_version_hash, le


def _validate_schema(df: pd.DataFrame) -> None:
    """Enforce the training contract. Raises RuntimeError on any violation."""
    errors = []

    missing = [col for col in REQUIRED_COLUMNS if col not in df.columns]
    if missing:
        errors.append(f"Missing required columns: {missing}")

    # Only check nulls for columns that are actually present (avoid KeyError)
    present_required = [c for c in REQUIRED_COLUMNS if c in df.columns]
    null_counts = df[present_required].isnull().sum()
    null_cols = null_counts[null_counts > 0]
    if not null_cols.empty:
        errors.append(f"Null values found:\n{null_cols.to_string()}")

    if errors:
        for err in errors:
            logger.error("Schema violation: %s", err)
        raise RuntimeError(
            f"Training contract violated ({len(errors)} error(s)):\n"
            + "\n".join(errors)
        )

    logger.info(
        "Schema contract validated. Stations: %s | Date range: %s → %s",
        df["start_station_id"].nunique(),
        df["hour"].min(),
        df["hour"].max(),
    )


def get_X_y(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    """
    Split the dataframe into feature matrix X and target vector y.
    Call this after load_feature_matrix().
    """
    X = df[FEATURE_COLS].copy()
    y = df[TARGET].copy()
    logger.info("Feature matrix: %s rows × %s features | Target: %s", f"{len(X):,}", len(FEATURE_COLS), TARGET)
    return X, y
