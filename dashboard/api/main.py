import logging
import math
import os
from typing import Any, Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from gcs_client import gcs, BUCKET_NAME
from schemas import HealthResponse

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(name)-28s  %(levelname)-7s  %(message)s",
)
logger = logging.getLogger("blueforecast.api")

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="BlueForecast API",
    description="Backend API for the BlueForecast Predictive Operations Dashboard",
    version="0.1.0",
)

_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    os.getenv("DASHBOARD_URL", ""),  # Cloud Run frontend URL injected at deploy time
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in _ALLOWED_ORIGINS if o],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _sanitize_value(v: Any) -> Any:
    """Convert a single value to a JSON-safe Python type."""
    if v is None:
        return None
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return None
        return round(v, 6)
    if isinstance(v, (np.floating,)):
        val = float(v)
        if math.isnan(val) or math.isinf(val):
            return None
        return round(val, 6)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (pd.Timestamp, np.datetime64)):
        return pd.Timestamp(v).isoformat()
    return v


def df_to_records(df: pd.DataFrame) -> list[dict]:
    """Convert a DataFrame to a list of dicts with JSON-safe values."""
    records: list[dict] = []
    for row in df.to_dict(orient="records"):
        records.append({k: _sanitize_value(v) for k, v in row.items()})
    return records


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def startup():
    logger.info("BlueForecast API starting up")
    logger.info(f"GCS bucket : {BUCKET_NAME}")
    logger.info(f"GCS status : {'connected' if gcs.available else 'unavailable'}")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/health", response_model=HealthResponse)
async def health():
    """Health check with GCS connectivity status."""
    return HealthResponse(
        status="ok" if gcs.available else "degraded",
        gcs_connected=gcs.available,
        bucket=BUCKET_NAME,
    )


@app.get("/api/stations")
async def get_stations():
    """Return all stations from stations.parquet."""
    df = gcs.read_parquet("processed/stations/stations.parquet", ttl=3600)
    if df is None:
        return JSONResponse(
            status_code=503,
            content={"detail": "Station data unavailable", "stations": []},
        )
    return df_to_records(df)


def _get_a32_to_gbfs_map() -> dict:
    """Return A32xxx → GBFS UUID lookup, trying station_id_mapping then feature_matrix."""
    mapping_df = gcs.read_parquet("processed/stations/station_id_mapping.parquet", ttl=3600)
    if mapping_df is not None and "gbfs_station_id" in mapping_df.columns:
        return dict(zip(mapping_df["start_station_id"], mapping_df["gbfs_station_id"].fillna("")))
    fm = gcs.read_parquet("processed/features/feature_matrix.parquet", ttl=3600)
    if fm is not None and "gbfs_station_id" in fm.columns and "start_station_id" in fm.columns:
        sub = fm[["start_station_id", "gbfs_station_id"]].drop_duplicates("start_station_id")
        return dict(zip(sub["start_station_id"], sub["gbfs_station_id"].fillna("")))
    return {}


def _translate_station_ids(df: pd.DataFrame) -> pd.DataFrame:
    """Replace A32xxx station_id values with GBFS UUIDs where mapping is available."""
    a32_to_gbfs = _get_a32_to_gbfs_map()
    if not a32_to_gbfs:
        return df
    df = df.copy()
    df["station_id"] = df["station_id"].map(lambda sid: a32_to_gbfs.get(sid) or sid)
    return df


def _resolve_station_id(requested_id: str, df: pd.DataFrame) -> pd.DataFrame:
    """Filter predictions by station_id, trying GBFS UUID → A32xxx translation if needed."""
    filtered = df[df["station_id"] == requested_id]
    if not filtered.empty:
        return filtered
    # No direct match — try translating via station mapping (GBFS UUID → A32xxx)
    mapping_df = gcs.read_parquet("processed/stations/station_id_mapping.parquet", ttl=3600)
    if mapping_df is not None and "gbfs_station_id" in mapping_df.columns:
        row = mapping_df[mapping_df["gbfs_station_id"] == requested_id]
        if not row.empty:
            a32_id = row.iloc[0]["start_station_id"]
            filtered = df[df["station_id"] == a32_id]
            if not filtered.empty:
                return filtered
    # Also try feature_matrix fallback
    fm = gcs.read_parquet("processed/features/feature_matrix.parquet", ttl=3600)
    if fm is not None and "gbfs_station_id" in fm.columns and "start_station_id" in fm.columns:
        row = fm[fm["gbfs_station_id"] == requested_id]
        if not row.empty:
            a32_id = row.iloc[0]["start_station_id"]
            filtered = df[df["station_id"] == a32_id]
    return filtered


@app.get("/api/predictions")
async def get_predictions(
    station_id: Optional[str] = Query(None),
    mode: str = Query("full", pattern="^(full|summary|network)$"),
):
    """Return demand predictions.

    - station_id: filter to one station, returns all 24 hourly rows.
      Accepts both GBFS UUIDs and A32xxx trip IDs — translated automatically.
    - mode=full (default): all 24h rows for ALL stations — use only when needed
    - mode=summary: one row per station (peak hour + avg demand) — ~30KB vs 2MB
      Used by Overview and Rebalancing for network-wide views.
    """
    df = gcs.read_parquet("processed/predictions/latest/predictions.parquet", ttl=300)
    if df is None:
        return JSONResponse(
            status_code=503,
            content={"detail": "Prediction data unavailable", "predictions": []},
        )
    if station_id:
        filtered = _resolve_station_id(station_id, df)
        return df_to_records(filtered)

    if mode == "summary":
        # One row per station: avg + peak demand across 24h
        agg = (
            df.groupby("station_id")
            .agg(
                predicted_demand=("predicted_demand", "mean"),
                peak_demand=("predicted_demand", "max"),
                total_demand=("predicted_demand", "sum"),
                forecast_hour=("forecast_hour", "min"),
                model_version=("model_version", "first"),
                generated_at=("generated_at", "first"),
            )
            .reset_index()
        )
        return df_to_records(_translate_station_ids(agg))

    if mode == "network":
        # 24 rows — one per hour — total demand across ALL stations
        # Used by Overview 24h bar chart. Tiny payload (~24 rows).
        df["hour"] = pd.to_datetime(df["forecast_hour"]).dt.hour
        hourly = (
            df.groupby("hour")
            .agg(
                total_demand=("predicted_demand", "sum"),
                forecast_hour=("forecast_hour", "first"),
            )
            .reset_index()
            .sort_values("hour")
        )
        return df_to_records(hourly)  # network mode has no station_id column

    return df_to_records(_translate_station_ids(df))


@app.get("/api/metrics/latest")
async def get_latest_metrics():
    """Return approved model metadata / metrics."""
    data = gcs.get_approved_metadata(ttl=300)
    if data is None:
        return JSONResponse(
            status_code=503,
            content={"detail": "Metrics data unavailable"},
        )
    return data


@app.get("/api/validation")
async def get_validation():
    """Return validation summary for the current approved run."""
    run_id = gcs.get_run_id()
    if not run_id:
        return JSONResponse(
            status_code=503,
            content={"detail": "No approved run found"},
        )
    data = gcs.read_json(
        f"processed/models/{run_id}/validation_summary.json", ttl=600
    )
    if data is None:
        return JSONResponse(
            status_code=503,
            content={"detail": "Validation data unavailable"},
        )
    return data


@app.get("/api/bias-report")
async def get_bias_report():
    """Return bias report for the current approved run."""
    run_id = gcs.get_run_id()
    if not run_id:
        return JSONResponse(
            status_code=503,
            content={"detail": "No approved run found"},
        )
    data = gcs.read_json(
        f"processed/models/{run_id}/bias_report.json", ttl=600
    )
    if data is None:
        return JSONResponse(
            status_code=503,
            content={"detail": "Bias report unavailable"},
        )
    return data


@app.get("/api/drift-report")
async def get_drift_report():
    """Return drift report for the current approved run."""
    run_id = gcs.get_run_id()
    if not run_id:
        return JSONResponse(
            status_code=503,
            content={"detail": "No approved run found"},
        )
    data = gcs.read_json(
        f"processed/models/{run_id}/drift_report.json", ttl=600
    )
    if data is None:
        return JSONResponse(
            status_code=503,
            content={"detail": "Drift report unavailable"},
        )
    return data


@app.get("/api/station-mapping")
async def get_station_mapping():
    """Return the station ID mapping (A32xxx trip IDs → GBFS UUIDs).

    Generated by the feature engineering pipeline. Falls back to deriving
    the mapping from the feature matrix if the dedicated file isn't present.
    """
    df = gcs.read_parquet("processed/stations/station_id_mapping.parquet", ttl=3600)
    if df is not None:
        return df_to_records(df)

    # Fallback: derive mapping from feature matrix (has start_station_id + gbfs_station_id)
    fm = gcs.read_parquet("processed/features/feature_matrix.parquet", ttl=3600)
    if fm is not None and "start_station_id" in fm.columns:
        cols = ["start_station_id"]
        if "gbfs_station_id" in fm.columns:
            cols.append("gbfs_station_id")
        if "station_name" in fm.columns:
            cols.append("station_name")
        mapping = fm[cols].drop_duplicates("start_station_id").reset_index(drop=True)
        if "gbfs_station_id" not in mapping.columns:
            mapping["gbfs_station_id"] = None
        return df_to_records(mapping)

    return JSONResponse(
        status_code=503,
        content={"detail": "Station mapping unavailable — run feature engineering pipeline first"},
    )


@app.get("/api/feature-importance")
async def get_feature_importance():
    """Return feature importance (XGBoost gain + SHAP) for the current approved run."""
    run_id = gcs.get_run_id()
    if not run_id:
        return JSONResponse(
            status_code=503,
            content={"detail": "No approved run found"},
        )
    data = gcs.read_json(
        f"processed/models/{run_id}/feature_importance.json", ttl=600
    )
    if data is None:
        return JSONResponse(
            status_code=503,
            content={"detail": "Feature importance data unavailable"},
        )
    return data


@app.get("/api/pipeline-status")
async def get_pipeline_status():
    """Return current pipeline execution status."""
    data = gcs.read_json("processed/pipeline-status/current.json", ttl=30)
    if data is None:
        return JSONResponse(
            status_code=503,
            content={"detail": "Pipeline status unavailable"},
        )
    return data

