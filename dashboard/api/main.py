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


@app.get("/api/predictions")
async def get_predictions(station_id: Optional[str] = Query(None)):
    """Return demand predictions, optionally filtered by station_id."""
    df = gcs.read_parquet("processed/predictions/latest/predictions.parquet", ttl=300)
    if df is None:
        return JSONResponse(
            status_code=503,
            content={"detail": "Prediction data unavailable", "predictions": []},
        )
    if station_id:
        df = df[df["station_id"] == station_id]
    return df_to_records(df)


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

