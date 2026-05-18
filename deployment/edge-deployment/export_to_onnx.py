"""
BlueForecast Edge Deployment — Model Export Script
===================================================
Loads the XGBoost model from .ubj binary and converts it to ONNX format
for lightweight edge inference (no MLflow, no GCS dependency at runtime).

Usage:
    cd edge-deployment
    python export_to_onnx.py

    # Or specify a custom model path:
    python export_to_onnx.py --model-path model/model.ubj

Output:
    model/blueforecast.onnx         — Optimized ONNX model
    model/model_metadata.json       — Feature names, metrics, run info
"""

import argparse
import json
import logging
import os
import sys

import numpy as np
import onnxruntime as ort
import xgboost as xgb
from onnxmltools import convert_xgboost
from onnxmltools.convert.common.data_types import FloatTensorType

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

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

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "model")


def load_xgboost_model(model_path: str) -> xgb.XGBRegressor:
    """Load the XGBoost model from .ubj binary file."""
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Model file not found: {model_path}")

    logger.info("Loading XGBoost model from %s...", model_path)

    # Load as XGBRegressor (matches training: xgboost.sklearn.XGBRegressor)
    model = xgb.XGBRegressor()
    model.load_model(model_path)

    logger.info("Model loaded successfully. Trees: %d", model.n_estimators if hasattr(model, 'n_estimators') else -1)
    return model


def convert_to_onnx(model: xgb.XGBRegressor, num_features: int):
    """Convert XGBoost model to ONNX format."""
    logger.info("Converting to ONNX (num_features=%d)...", num_features)

    # Define input shape: batch_size x num_features
    initial_type = [("features", FloatTensorType([None, num_features]))]

    # Convert XGBoost → ONNX
    onnx_model = convert_xgboost(
        model,
        initial_types=initial_type,
        target_opset=13,
    )

    logger.info("ONNX conversion complete.")
    return onnx_model


def validate_onnx(onnx_path: str, xgb_model: xgb.XGBRegressor, num_features: int) -> dict:
    """Validate ONNX model outputs match XGBoost predictions."""
    logger.info("Validating ONNX model...")

    # Create sample input
    np.random.seed(42)
    sample_input = np.random.rand(10, num_features).astype(np.float32)

    # XGBoost predictions
    xgb_preds = xgb_model.predict(sample_input)

    # ONNX predictions
    session = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    onnx_preds = session.run(None, {input_name: sample_input})[0].flatten()

    # Compare
    max_diff = float(np.max(np.abs(xgb_preds - onnx_preds)))
    mean_diff = float(np.mean(np.abs(xgb_preds - onnx_preds)))

    logger.info("Validation — Max diff: %.6f | Mean diff: %.6f", max_diff, mean_diff)

    if max_diff > 0.01:
        logger.warning("ONNX validation WARNING — max diff exceeds 0.01 threshold")
        return {"status": "WARNING", "max_diff": max_diff, "mean_diff": mean_diff}

    logger.info("ONNX validation PASSED.")
    return {"status": "PASSED", "max_diff": max_diff, "mean_diff": mean_diff}


def export(model_path: str):
    """Main export pipeline."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    num_features = len(FEATURE_COLUMNS)

    # ── Step 1: Load model from .ubj file ────────────────────────────────────
    model = load_xgboost_model(model_path)

    # ── Step 2: Convert to ONNX ──────────────────────────────────────────────
    onnx_model = convert_to_onnx(model, num_features)

    onnx_path = os.path.join(OUTPUT_DIR, "blueforecast.onnx")
    with open(onnx_path, "wb") as f:
        f.write(onnx_model.SerializeToString())
    logger.info("ONNX model saved: %s", onnx_path)

    # ── Step 3: Validate ─────────────────────────────────────────────────────
    validation = validate_onnx(onnx_path, model, num_features)

    # ── Step 4: Save metadata ────────────────────────────────────────────────
    metadata = {
        "source_model": os.path.basename(model_path),
        "model_type": "XGBoostRegressor",
        "format": "ONNX",
        "feature_columns": FEATURE_COLUMNS,
        "num_features": num_features,
        "metrics": {
            "test_rmse": 1.28654,
            "test_mae": 0.650969,
            "test_r2": 0.702187,
            "validation_status": "PASSED",
            "bias_status": "PASSED",
        },
        "onnx_validation": validation,
        "onnx_file": "blueforecast.onnx",
        "onnx_size_bytes": os.path.getsize(onnx_path),
        "source_size_bytes": os.path.getsize(model_path),
    }

    metadata_path = os.path.join(OUTPUT_DIR, "model_metadata.json")
    with open(metadata_path, "w") as f:
        json.dump(metadata, f, indent=2)
    logger.info("Metadata saved: %s", metadata_path)

    # ── Summary ──────────────────────────────────────────────────────────────
    size_mb = os.path.getsize(onnx_path) / (1024 * 1024)
    source_mb = os.path.getsize(model_path) / (1024 * 1024)
    logger.info("=" * 60)
    logger.info("EXPORT COMPLETE")
    logger.info("  Source:     %s (%.2f MB)", model_path, source_mb)
    logger.info("  ONNX:       %s (%.2f MB)", onnx_path, size_mb)
    logger.info("  Metadata:   %s", metadata_path)
    logger.info("  Validation: %s", validation["status"])
    logger.info("=" * 60)

    return metadata


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Export BlueForecast model to ONNX")
    parser.add_argument(
        "--model-path",
        type=str,
        default=os.path.join(OUTPUT_DIR, "model.ubj"),
        help="Path to XGBoost .ubj model file (default: model/model.ubj)",
    )
    args = parser.parse_args()
    export(model_path=args.model_path)