"""
BlueForecast Edge Deployment — Model Export Script
===================================================
Downloads the champion XGBoost model from MLflow and converts it to ONNX format
for lightweight edge inference (no MLflow, no GCS dependency at runtime).

Usage:
    # Option A: Export from local MLflow (mlruns/ directory)
    python export_to_onnx.py

    # Option B: Export from Docker MLflow server
    set MLFLOW_TRACKING_URI=http://localhost:5000
    python export_to_onnx.py

    # Option C: Export from a specific run ID
    python export_to_onnx.py --run-id 7a8b836caadb47b29215eeeb1c440734

Output:
    model/blueforecast.onnx         — Optimized ONNX model
    model/model_metadata.json       — Feature names, metrics, run info
"""

import argparse
import json
import logging
import os
import sys

import mlflow
import mlflow.xgboost
import numpy as np
import onnxruntime as ort
import xgboost as xgb
from onnxmltools import convert_xgboost
from onnxmltools.convert.common.data_types import FloatTensorType

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# ── Feature schema (must match training pipeline) ────────────────────────────
# These are the 30 features the model was trained on (32 columns - target - station_id index)
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

MLFLOW_EXPERIMENT = "BlueForecast-Demand"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "model")


def find_champion_run_id(client: mlflow.tracking.MlflowClient) -> str:
    """Find the approved/champion run from MLflow experiment."""
    experiment = client.get_experiment_by_name(MLFLOW_EXPERIMENT)
    if experiment is None:
        raise RuntimeError(f"MLflow experiment '{MLFLOW_EXPERIMENT}' not found.")

    runs = client.search_runs(
        experiment_ids=[experiment.experiment_id],
        filter_string="tags.status = 'approved'",
        order_by=["metrics.val_rmse ASC"],
        max_results=1,
    )
    if not runs:
        raise RuntimeError("No approved runs found. Specify --run-id manually.")

    run_id = runs[0].info.run_id
    logger.info("Found champion run: %s (val_rmse=%.4f)", run_id, runs[0].data.metrics.get("val_rmse", -1))
    return run_id


def load_xgboost_model(run_id: str) -> xgb.XGBRegressor:
    """Load the XGBoost model from MLflow artifacts."""
    model_uri = f"runs:/{run_id}/model"
    logger.info("Loading model from MLflow: %s", model_uri)
    model = mlflow.xgboost.load_model(model_uri)
    logger.info("Model loaded successfully. Type: %s", type(model).__name__)
    return model


def convert_to_onnx(model: xgb.XGBRegressor, num_features: int) -> bytes:
    """Convert XGBoost model to ONNX format."""
    logger.info("Converting to ONNX (num_features=%d)...", num_features)

    # Define input shape: batch_size x num_features
    initial_type = [("features", FloatTensorType([None, num_features]))]

    # Handle both Booster and XGBRegressor
    if isinstance(model, xgb.Booster):
        onnx_model = convert_xgboost(model, initial_types=initial_type)
    else:
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
    if isinstance(xgb_model, xgb.Booster):
        dmatrix = xgb.DMatrix(sample_input, feature_names=FEATURE_COLUMNS)
        xgb_preds = xgb_model.predict(dmatrix)
    else:
        xgb_preds = xgb_model.predict(sample_input)

    # ONNX predictions
    session = ort.InferenceSession(onnx_path)
    input_name = session.get_inputs()[0].name
    onnx_preds = session.run(None, {input_name: sample_input})[0].flatten()

    # Compare
    max_diff = float(np.max(np.abs(xgb_preds - onnx_preds)))
    mean_diff = float(np.mean(np.abs(xgb_preds - onnx_preds)))

    logger.info("Validation — Max diff: %.6f | Mean diff: %.6f", max_diff, mean_diff)

    if max_diff > 0.01:
        logger.warning("ONNX validation FAILED — max diff exceeds threshold (0.01)")
        return {"status": "FAILED", "max_diff": max_diff, "mean_diff": mean_diff}

    logger.info("ONNX validation PASSED.")
    return {"status": "PASSED", "max_diff": max_diff, "mean_diff": mean_diff}


def export(run_id: str = None):
    """Main export pipeline."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # ── Step 1: Resolve run ID ───────────────────────────────────────────────
    client = mlflow.tracking.MlflowClient()
    if run_id is None:
        run_id = find_champion_run_id(client)

    # ── Step 2: Load model from MLflow ───────────────────────────────────────
    model = load_xgboost_model(run_id)
    num_features = len(FEATURE_COLUMNS)

    # ── Step 3: Convert to ONNX ──────────────────────────────────────────────
    onnx_model = convert_to_onnx(model, num_features)

    onnx_path = os.path.join(OUTPUT_DIR, "blueforecast.onnx")
    with open(onnx_path, "wb") as f:
        f.write(onnx_model.SerializeToString())
    logger.info("ONNX model saved: %s", onnx_path)

    # ── Step 4: Validate ─────────────────────────────────────────────────────
    validation = validate_onnx(onnx_path, model, num_features)

    # ── Step 5: Save metadata ────────────────────────────────────────────────
    run = client.get_run(run_id)
    metadata = {
        "run_id": run_id,
        "model_type": "XGBoostRegressor",
        "format": "ONNX",
        "feature_columns": FEATURE_COLUMNS,
        "num_features": num_features,
        "metrics": {
            "val_rmse": run.data.metrics.get("val_rmse"),
            "val_mae": run.data.metrics.get("val_mae"),
            "val_r2": run.data.metrics.get("val_r2"),
            "test_rmse": run.data.metrics.get("test_rmse"),
            "test_mae": run.data.metrics.get("test_mae"),
            "test_r2": run.data.metrics.get("test_r2"),
        },
        "onnx_validation": validation,
        "onnx_file": "blueforecast.onnx",
        "onnx_size_bytes": os.path.getsize(onnx_path),
    }

    metadata_path = os.path.join(OUTPUT_DIR, "model_metadata.json")
    with open(metadata_path, "w") as f:
        json.dump(metadata, f, indent=2)
    logger.info("Metadata saved: %s", metadata_path)

    # ── Summary ──────────────────────────────────────────────────────────────
    size_mb = os.path.getsize(onnx_path) / (1024 * 1024)
    logger.info("=" * 60)
    logger.info("EXPORT COMPLETE")
    logger.info("  ONNX model: %s (%.2f MB)", onnx_path, size_mb)
    logger.info("  Metadata:   %s", metadata_path)
    logger.info("  Validation: %s", validation["status"])
    logger.info("=" * 60)

    return metadata


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Export BlueForecast model to ONNX")
    parser.add_argument(
        "--run-id",
        type=str,
        default=None,
        help="MLflow run ID to export. If not set, exports the champion model.",
    )
    args = parser.parse_args()
    export(run_id=args.run_id)
