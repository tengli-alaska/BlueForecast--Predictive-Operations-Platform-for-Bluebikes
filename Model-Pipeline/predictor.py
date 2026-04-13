"""
Prediction output generator for BlueForecast.

Generates 24-hour rolling station-level demand forecasts using the current
champion model from the MLflow Model Registry.

FORECASTING APPROACH:
  Recursive 1-step-ahead forecasting over a 24-hour horizon.
  - lag_1h    : previous step's prediction (actual for step 1)
  - lag_24h   : actual historical demand (200-row lookback window)
  - lag_168h  : actual historical demand (200-row lookback window)
  - rolling   : computed from lookback history + accumulated predictions
  - weather   : persistence forecast (last known values — no future weather data)
  - time feats: computed analytically from forecast timestamp
  - holidays  : US/MA calendar

KNOWN LIMITATION:
  Forecast accuracy degrades at the 18–24h horizon due to lag_1h error
  accumulation. Use predictions beyond 12h as directional guidance only.

OUTPUT SCHEMA:
  station_id | forecast_hour | predicted_demand | model_version | generated_at

WRITTEN TO:
  gs://.../processed/predictions/latest/predictions.parquet   (overwritten each run)
  gs://.../processed/predictions/{date}/predictions.parquet   (dated snapshot)
"""

import io
import logging
from datetime import datetime, timezone

import holidays
import mlflow
import mlflow.xgboost
import numpy as np
import pandas as pd
from google.cloud import storage
from mlflow.tracking import MlflowClient

from model_pipeline.data_loader import FEATURE_COLS, load_feature_matrix
from model_pipeline.trainer import _setup_mlflow

logger = logging.getLogger("model_pipeline.predictor")
logger.setLevel(logging.INFO)

BUCKET           = "bluebikes-demand-predictor-data"
REGISTRY_NAME    = "BlueForecast-Demand"
FORECAST_HORIZON = 24   # hours ahead
HISTORY_LOOKBACK = 200  # rows of history kept per station for lag computation


# ---------------------------------------------------------------------------
# Champion model loader
# ---------------------------------------------------------------------------

def load_champion_model() -> tuple:
    """
    Load the current champion model from the MLflow Model Registry.

    Returns
    -------
    model       : XGBoost model (loaded via mlflow.xgboost.load_model)
    version_num : int  — registry version number
    run_id      : str  — MLflow run ID (for metadata logging)
    """
    client  = MlflowClient()
    champion    = client.get_model_version_by_alias(REGISTRY_NAME, "champion")
    version_num = int(champion.version)
    run_id      = champion.run_id

    model = mlflow.xgboost.load_model(f"runs:/{run_id}/model")
    logger.info(
        "Champion model loaded: %s v%s (run %s)",
        REGISTRY_NAME, version_num, run_id[:8],
    )
    return model, version_num, run_id


# ---------------------------------------------------------------------------
# History extraction
# ---------------------------------------------------------------------------

def _build_station_histories(
    feature_matrix: pd.DataFrame,
) -> tuple[dict, dict, dict]:
    """
    Extract per-station demand histories, capacities, and last-known weather.

    Parameters
    ----------
    feature_matrix : full DataFrame from load_feature_matrix() (includes demand_count)

    Returns
    -------
    histories  : station_id -> list[float] — demand values, oldest first
    capacities : station_id -> float
    weather    : dict — last known weather features (city-wide, for persistence)
    """
    df   = feature_matrix.sort_values("hour")
    tail = df.groupby("start_station_id").tail(HISTORY_LOOKBACK)

    weather_cols = [
        "temperature_c", "precipitation_mm", "wind_speed_kmh",
        "humidity_pct", "feels_like_c", "is_cold", "is_hot",
        "is_precipitation", "weather_code",
    ]

    histories  = {}
    capacities = {}

    for sid, grp in tail.groupby("start_station_id"):
        grp = grp.sort_values("hour")
        histories[sid]  = list(grp["demand_count"].values.astype(float))
        capacities[sid] = float(grp["capacity"].iloc[-1])

    last_row = df.iloc[-1]
    weather  = {col: float(last_row[col]) for col in weather_cols}

    return histories, capacities, weather


# ---------------------------------------------------------------------------
# Feature construction
# ---------------------------------------------------------------------------

def _time_features(ts: pd.Timestamp, us_holidays_set: set) -> dict:
    """Compute all time and cyclical features for a single forecast timestamp."""
    h     = ts.hour
    dow   = ts.dayofweek
    month = ts.month
    return {
        "hour_of_day": h,
        "day_of_week": dow,
        "month":       month,
        "year":        ts.year,
        "is_weekend":  int(dow >= 5),
        "is_holiday":  int(ts.date() in us_holidays_set),
        "hour_sin":    float(np.sin(2 * np.pi * h       / 24)),
        "hour_cos":    float(np.cos(2 * np.pi * h       / 24)),
        "dow_sin":     float(np.sin(2 * np.pi * dow     / 7)),
        "dow_cos":     float(np.cos(2 * np.pi * dow     / 7)),
        "month_sin":   float(np.sin(2 * np.pi * (month - 1) / 12)),
        "month_cos":   float(np.cos(2 * np.pi * (month - 1) / 12)),
    }


# ---------------------------------------------------------------------------
# Core forecast loop
# ---------------------------------------------------------------------------

def generate_24h_forecasts(
    model,
    feature_matrix: pd.DataFrame,
    feature_cols:   list[str],
    model_version:  int,
) -> pd.DataFrame:
    """
    Generate FORECAST_HORIZON-hour rolling forecasts for every active station.

    Returns
    -------
    pd.DataFrame with columns:
        station_id (int) | forecast_hour (datetime) | predicted_demand (float)
        model_version (int) | generated_at (str ISO-8601)
    """
    df             = feature_matrix.sort_values("hour")
    last_ts        = df["hour"].max()
    forecast_start = last_ts + pd.Timedelta(hours=1)
    stations       = sorted(df["start_station_id"].unique())

    logger.info(
        "Generating forecasts | Window: %s → %s | Stations: %s",
        forecast_start.strftime("%Y-%m-%d %H:00"),
        (forecast_start + pd.Timedelta(hours=FORECAST_HORIZON - 1)).strftime("%Y-%m-%d %H:00"),
        len(stations),
    )

    histories, capacities, weather = _build_station_histories(df)
    us_holidays_set = set(holidays.country_holidays("US", state="MA", years=[
        forecast_start.year, forecast_start.year + 1
    ]).keys())

    generated_at = datetime.now(timezone.utc).isoformat()
    records      = []

    for step in range(1, FORECAST_HORIZON + 1):
        forecast_ts = forecast_start + pd.Timedelta(hours=step - 1)
        time_feats  = _time_features(forecast_ts, us_holidays_set)

        # Build one feature row per station for this hour
        rows = []
        for sid in stations:
            hist = histories[sid]
            n    = len(hist)

            # Lag features: actual history or accumulated predictions
            lag_1h   = hist[-1]   if n >= 1   else 0.0
            lag_24h  = hist[-24]  if n >= 24  else (np.mean(hist) if hist else 0.0)
            lag_168h = hist[-168] if n >= 168 else (np.mean(hist) if hist else 0.0)

            # Rolling averages
            def safe_mean(arr): return float(np.mean(arr)) if len(arr) > 0 else 0.0
            rolling_avg_3h  = safe_mean(hist[-3:])
            rolling_avg_6h  = safe_mean(hist[-6:])
            rolling_avg_24h = safe_mean(hist[-24:])

            rows.append({
                "start_station_id": sid,
                "capacity":          capacities[sid],
                **time_feats,
                "demand_lag_1h":     lag_1h,
                "demand_lag_24h":    lag_24h,
                "demand_lag_168h":   lag_168h,
                "rolling_avg_3h":    rolling_avg_3h,
                "rolling_avg_6h":    rolling_avg_6h,
                "rolling_avg_24h":   rolling_avg_24h,
                **weather,
            })

        X     = pd.DataFrame(rows)[feature_cols].values
        preds = np.maximum(model.predict(X), 0.0)   # no negative demand

        # Update rolling histories for next step's lag computation
        for sid, pred in zip(stations, preds):
            histories[sid].append(float(pred))
            if len(histories[sid]) > HISTORY_LOOKBACK:
                histories[sid].pop(0)

        # Collect output records
        for sid, pred in zip(stations, preds):
            records.append({
                "station_id":       int(sid),
                "forecast_hour":    forecast_ts,
                "predicted_demand": round(float(pred), 4),
                "model_version":    model_version,
                "generated_at":     generated_at,
            })

        logger.info(
            "  +%02dh | %s | avg_pred=%.2f",
            step,
            forecast_ts.strftime("%Y-%m-%d %H:00"),
            float(np.mean(preds)),
        )

    result = pd.DataFrame(records)
    logger.info(
        "Forecasts complete: %s rows | %s stations × %s hours",
        f"{len(result):,}", len(stations), FORECAST_HORIZON,
    )
    return result


# ---------------------------------------------------------------------------
# GCS writer
# ---------------------------------------------------------------------------

def write_predictions_to_gcs(predictions_df: pd.DataFrame) -> dict[str, str]:
    """
    Write prediction artifact to two GCS locations.

    Returns dict: {'latest': gcs_uri, 'dated': gcs_uri}
    """
    buf = io.BytesIO()
    predictions_df.to_parquet(buf, index=False, engine="pyarrow")
    parquet_bytes = buf.getvalue()

    date_str = predictions_df["forecast_hour"].min().strftime("%Y-%m-%d")
    paths = {
        "latest": "processed/predictions/latest/predictions.parquet",
        "dated":  f"processed/predictions/{date_str}/predictions.parquet",
    }

    gcs = storage.Client()
    uris = {}
    for label, path in paths.items():
        gcs.bucket(BUCKET).blob(path).upload_from_string(
            parquet_bytes, content_type="application/octet-stream"
        )
        uris[label] = f"gs://{BUCKET}/{path}"
        logger.info("Written → %s", uris[label])

    return uris


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def run_prediction_pipeline() -> pd.DataFrame:
    """
    End-to-end prediction pipeline.
    Loads champion model, generates forecasts, writes to GCS, logs to MLflow.
    """
    _setup_mlflow()

    model, version_num, run_id = load_champion_model()
    df, _                      = load_feature_matrix()

    predictions_df = generate_24h_forecasts(
        model=model,
        feature_matrix=df,
        feature_cols=FEATURE_COLS,
        model_version=version_num,
    )

    uris = write_predictions_to_gcs(predictions_df)

    client = MlflowClient()
    client.set_tag(run_id, "predictions_latest_gcs", uris["latest"])
    client.set_tag(run_id, "predictions_dated_gcs",  uris["dated"])
    logger.info("Prediction URIs logged to MLflow run %s", run_id[:8])

    return predictions_df
