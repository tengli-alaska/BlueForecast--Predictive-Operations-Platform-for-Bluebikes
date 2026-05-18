"""
BlueForecast Edge Inference Server
===================================
Lightweight FastAPI server that loads the ONNX model and serves predictions.
Runs fully offline — no GCS, no MLflow, no cloud dependency at runtime.

Usage:
    uvicorn inference_server:app --host 0.0.0.0 --port 8080

Endpoints:
    GET  /health              — Health check
    GET  /model-info          — Model metadata
    POST /predict             — Single station prediction
    POST /predict/batch       — Batch prediction (multiple stations)
"""

import json
import logging
import os
import time
from datetime import datetime
from math import cos, pi, sin
from typing import List, Optional

import numpy as np
import onnxruntime as ort
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# ── Configuration ────────────────────────────────────────────────────────────
MODEL_DIR = os.environ.get("MODEL_DIR", os.path.join(os.path.dirname(__file__), "model"))
ONNX_PATH = os.path.join(MODEL_DIR, "blueforecast.onnx")
METADATA_PATH = os.path.join(MODEL_DIR, "model_metadata.json")

# ── Feature schema (must match training pipeline) ────────────────────────────
FEATURE_COLUMNS = [
    "start_station_id",
    "capacity",
    "hour_of_day",
    "day_of_week",
    "month",
    "year",
    "is_weekend",
    "is_holiday",
    "temperature_c",
    "precipitation_mm",
    "wind_speed_kmh",
    "humidity_pct",
    "feels_like_c",
    "weather_code",
    "is_cold",
    "is_hot",
    "is_precipitation",
    "demand_lag_1h",
    "demand_lag_24h",
    "demand_lag_168h",
    "rolling_avg_3h",
    "rolling_avg_6h",
    "rolling_avg_24h",
    "hour_sin",
    "hour_cos",
    "dow_sin",
    "dow_cos",
    "month_sin",
    "month_cos",
]


# ── Request / Response schemas ───────────────────────────────────────────────
class PredictionRequest(BaseModel):
    """Input for a single station prediction."""
    start_station_id: int = Field(..., description="Bluebikes station ID")
    capacity: int = Field(..., ge=1, description="Station dock capacity")
    hour_of_day: int = Field(..., ge=0, le=23)
    day_of_week: int = Field(..., ge=0, le=6, description="0=Monday, 6=Sunday")
    month: int = Field(..., ge=1, le=12)
    year: int = Field(..., ge=2023)
    is_weekend: int = Field(..., ge=0, le=1)
    is_holiday: int = Field(..., ge=0, le=1)
    temperature_c: float = Field(..., description="Temperature in Celsius")
    precipitation_mm: float = Field(..., ge=0, description="Precipitation in mm")
    wind_speed_kmh: float = Field(..., ge=0)
    humidity_pct: float = Field(..., ge=0, le=100)
    feels_like_c: float
    weather_code: int = Field(..., ge=0, description="WMO weather code")
    is_cold: int = Field(..., ge=0, le=1)
    is_hot: int = Field(..., ge=0, le=1)
    is_precipitation: int = Field(..., ge=0, le=1)
    demand_lag_1h: float = Field(..., ge=0, description="Demand 1 hour ago")
    demand_lag_24h: float = Field(..., ge=0, description="Demand 24 hours ago")
    demand_lag_168h: float = Field(..., ge=0, description="Demand 168 hours (7 days) ago")
    rolling_avg_3h: float = Field(..., ge=0)
    rolling_avg_6h: float = Field(..., ge=0)
    rolling_avg_24h: float = Field(..., ge=0)
    hour_sin: Optional[float] = None
    hour_cos: Optional[float] = None
    dow_sin: Optional[float] = None
    dow_cos: Optional[float] = None
    month_sin: Optional[float] = None
    month_cos: Optional[float] = None


class PredictionResponse(BaseModel):
    """Output for a single prediction."""
    station_id: int
    predicted_demand: float
    prediction_timestamp: str
    inference_time_ms: float


class BatchPredictionRequest(BaseModel):
    """Input for batch predictions."""
    predictions: List[PredictionRequest]


class BatchPredictionResponse(BaseModel):
    """Output for batch predictions."""
    predictions: List[PredictionResponse]
    total_inference_time_ms: float
    count: int


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    model_format: str
    uptime_seconds: float


# ── Application ──────────────────────────────────────────────────────────────
app = FastAPI(
    title="BlueForecast Edge Inference",
    description="Lightweight edge inference server for Bluebikes demand prediction",
    version="1.0.0",
)

# Global state
_session: ort.InferenceSession = None
_metadata: dict = None
_start_time: float = None


@app.on_event("startup")
def load_model():
    """Load ONNX model at startup."""
    global _session, _metadata, _start_time
    _start_time = time.time()

    # Load ONNX model
    if not os.path.exists(ONNX_PATH):
        logger.error("ONNX model not found at %s", ONNX_PATH)
        raise RuntimeError(f"Model not found: {ONNX_PATH}. Run export_to_onnx.py first.")

    logger.info("Loading ONNX model from %s...", ONNX_PATH)
    _session = ort.InferenceSession(
        ONNX_PATH,
        providers=["CPUExecutionProvider"],  # Edge = CPU only
    )
    logger.info("Model loaded successfully.")

    # Load metadata
    if os.path.exists(METADATA_PATH):
        with open(METADATA_PATH, "r") as f:
            _metadata = json.load(f)
        logger.info("Metadata loaded: run_id=%s", _metadata.get("run_id", "unknown"))
    else:
        _metadata = {"run_id": "unknown", "metrics": {}}
        logger.warning("No metadata file found at %s", METADATA_PATH)


def _compute_cyclical_features(request: PredictionRequest) -> dict:
    """Compute cyclical encodings if not provided."""
    features = {}
    features["hour_sin"] = request.hour_sin if request.hour_sin is not None else sin(2 * pi * request.hour_of_day / 24)
    features["hour_cos"] = request.hour_cos if request.hour_cos is not None else cos(2 * pi * request.hour_of_day / 24)
    features["dow_sin"] = request.dow_sin if request.dow_sin is not None else sin(2 * pi * request.day_of_week / 7)
    features["dow_cos"] = request.dow_cos if request.dow_cos is not None else cos(2 * pi * request.day_of_week / 7)
    features["month_sin"] = request.month_sin if request.month_sin is not None else sin(2 * pi * request.month / 12)
    features["month_cos"] = request.month_cos if request.month_cos is not None else cos(2 * pi * request.month / 12)
    return features


def _request_to_array(request: PredictionRequest) -> np.ndarray:
    """Convert a PredictionRequest into a feature array matching FEATURE_COLUMNS order."""
    cyclical = _compute_cyclical_features(request)

    features = [
        request.start_station_id,
        request.capacity,
        request.hour_of_day,
        request.day_of_week,
        request.month,
        request.year,
        request.is_weekend,
        request.is_holiday,
        request.temperature_c,
        request.precipitation_mm,
        request.wind_speed_kmh,
        request.humidity_pct,
        request.feels_like_c,
        request.weather_code,
        request.is_cold,
        request.is_hot,
        request.is_precipitation,
        request.demand_lag_1h,
        request.demand_lag_24h,
        request.demand_lag_168h,
        request.rolling_avg_3h,
        request.rolling_avg_6h,
        request.rolling_avg_24h,
        cyclical["hour_sin"],
        cyclical["hour_cos"],
        cyclical["dow_sin"],
        cyclical["dow_cos"],
        cyclical["month_sin"],
        cyclical["month_cos"],
    ]

    return np.array([features], dtype=np.float32)


def _run_inference(input_array: np.ndarray) -> np.ndarray:
    """Run ONNX inference."""
    if _session is None:
        raise RuntimeError("Model not loaded.")
    input_name = _session.get_inputs()[0].name
    result = _session.run(None, {input_name: input_array})
    return result[0].flatten()


# ── Endpoints ────────────────────────────────────────────────────────────────
@app.get("/health", response_model=HealthResponse)
def health_check():
    """Health check endpoint for monitoring."""
    return HealthResponse(
        status="healthy" if _session is not None else "unhealthy",
        model_loaded=_session is not None,
        model_format="ONNX",
        uptime_seconds=round(time.time() - _start_time, 2) if _start_time else 0,
    )


@app.get("/model-info")
def model_info():
    """Return model metadata."""
    if _metadata is None:
        raise HTTPException(status_code=503, detail="Metadata not loaded.")
    return {
        "run_id": _metadata.get("run_id"),
        "model_type": _metadata.get("model_type"),
        "format": _metadata.get("format"),
        "num_features": _metadata.get("num_features"),
        "metrics": _metadata.get("metrics"),
        "onnx_size_bytes": _metadata.get("onnx_size_bytes"),
        "onnx_validation": _metadata.get("onnx_validation"),
    }


@app.post("/predict", response_model=PredictionResponse)
def predict(request: PredictionRequest):
    """Predict demand for a single station-hour."""
    start = time.time()

    input_array = _request_to_array(request)
    prediction = _run_inference(input_array)

    # Clamp to non-negative (demand can't be negative)
    predicted_demand = max(0.0, float(prediction[0]))

    elapsed_ms = (time.time() - start) * 1000

    return PredictionResponse(
        station_id=request.start_station_id,
        predicted_demand=round(predicted_demand, 4),
        prediction_timestamp=datetime.utcnow().isoformat(),
        inference_time_ms=round(elapsed_ms, 2),
    )


@app.post("/predict/batch", response_model=BatchPredictionResponse)
def predict_batch(request: BatchPredictionRequest):
    """Predict demand for multiple station-hours in one call."""
    start = time.time()

    # Stack all requests into a single batch array
    arrays = [_request_to_array(r) for r in request.predictions]
    batch_array = np.vstack(arrays)

    # Single inference call for the whole batch
    predictions = _run_inference(batch_array)

    results = []
    for i, req in enumerate(request.predictions):
        predicted_demand = max(0.0, float(predictions[i]))
        results.append(
            PredictionResponse(
                station_id=req.start_station_id,
                predicted_demand=round(predicted_demand, 4),
                prediction_timestamp=datetime.utcnow().isoformat(),
                inference_time_ms=0,  # individual times not tracked in batch
            )
        )

    elapsed_ms = (time.time() - start) * 1000

    return BatchPredictionResponse(
        predictions=results,
        total_inference_time_ms=round(elapsed_ms, 2),
        count=len(results),
    )
