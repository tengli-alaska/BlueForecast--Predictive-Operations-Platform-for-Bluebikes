"""
End-to-end retraining runner for BlueForecast.

This script reuses the existing model pipeline modules to:
1. train a new model
2. validate it on the held-out test set
3. run bias and drift checks
4. promote the candidate if registry gates pass
5. regenerate production predictions for the dashboard
"""

import json
import logging
import os
import sys
from pathlib import Path

import mlflow
import numpy as np
from google.cloud import storage

REPO_ROOT = Path(__file__).resolve().parents[2]
MODEL_PIPELINE_DIR = REPO_ROOT / "Model-Pipeline"
sys.path.insert(0, str(MODEL_PIPELINE_DIR / "src"))

from model_pipeline.bias_detection import detect_model_bias
from model_pipeline.data_loader import FEATURE_COLS, get_X_y, load_feature_matrix
from model_pipeline.drift_detector import run_drift_detection_pipeline
from model_pipeline.evaluator import evaluate_on_test
from model_pipeline.predictor import BUCKET, run_prediction_pipeline
from model_pipeline.registry import register_model
from model_pipeline.sensitivity import run_sensitivity_analysis
from model_pipeline.splitter import temporal_split
from model_pipeline.trainer import DEFAULT_PARAMS, _setup_mlflow, run_training_pipeline


logging.basicConfig(level=logging.INFO, format="%(name)s - %(message)s")
logger = logging.getLogger("blueforecast.retrain")

QUICK_CHECK = os.getenv("QUICK_CHECK", "false").lower() in {"true", "1", "yes"}
RUN_OPTUNA = os.getenv("RUN_OPTUNA", "false").lower() in {"true", "1", "yes"}
SKIP_SWEEP = os.getenv("SKIP_SWEEP", "true").lower() in {"true", "1", "yes"}
FORCE_PROMOTE = os.getenv("FORCE_PROMOTE", "false").lower() in {"true", "1", "yes"}
BIAS_OVERRIDE_REASON = os.getenv("BIAS_OVERRIDE_REASON", "").strip() or None
SAMPLE_FRAC = 0.05


def save_drift_report(run_id: str, drift_report: dict) -> str:
    path = f"processed/models/{run_id}/drift_report.json"
    storage.Client().bucket(BUCKET).blob(path).upload_from_string(
        json.dumps(drift_report, indent=2, default=str),
        content_type="application/json",
    )
    return f"gs://{BUCKET}/{path}"


def main() -> None:
    os.chdir(MODEL_PIPELINE_DIR)
    _setup_mlflow()

    logger.info("Loading feature matrix")
    df, dataset_version_hash, _label_encoder = load_feature_matrix()
    train_df, val_df, test_df = temporal_split(df)

    if QUICK_CHECK:
        train_df = train_df.sample(frac=SAMPLE_FRAC, random_state=42)
        val_df = val_df.sample(frac=SAMPLE_FRAC, random_state=42)
        test_df = test_df.sample(frac=SAMPLE_FRAC, random_state=42)
        logger.info(
            "Quick check mode enabled: sampled %.0f%% of each split",
            SAMPLE_FRAC * 100,
        )

    X_train, y_train = get_X_y(train_df)
    X_val, y_val = get_X_y(val_df)
    X_test, y_test = get_X_y(test_df)

    params = dict(DEFAULT_PARAMS)
    if QUICK_CHECK:
        params["n_estimators"] = 50
        params["early_stopping_rounds"] = 10

    logger.info("Training candidate model")
    forecaster, run_id = run_training_pipeline(
        X_train,
        y_train,
        X_val,
        y_val,
        feature_cols=FEATURE_COLS,
        dataset_version_hash=dataset_version_hash,
        params=params,
        run_optuna=RUN_OPTUNA,
        optuna_n_trials=10 if QUICK_CHECK else 30,
        optuna_sample_frac=0.50 if QUICK_CHECK else 0.20,
    )
    logger.info("Training complete for run %s", run_id)

    logger.info("Running validation gate")
    validation_summary = evaluate_on_test(
        forecaster=forecaster,
        X_test=X_test,
        y_test=y_test,
        run_id=run_id,
        dataset_version_hash=dataset_version_hash,
    )

    logger.info("Running bias detection")
    bias_report = detect_model_bias(
        forecaster=forecaster,
        X_test=X_test,
        y_test=y_test,
        run_id=run_id,
        dataset_version_hash=dataset_version_hash,
        override_reason=BIAS_OVERRIDE_REASON,
    )

    logger.info("Running sensitivity analysis")
    run_sensitivity_analysis(
        forecaster=forecaster,
        X_train=X_train,
        y_train=y_train,
        X_val=X_val,
        y_val=y_val,
        X_test=X_test,
        feature_cols=FEATURE_COLS,
        run_id=run_id,
        dataset_version_hash=dataset_version_hash,
        base_params=params,
        skip_hyperparam_sweep=SKIP_SWEEP,
    )

    logger.info("Running drift detection")
    sample_size = min(10_000, len(X_train), len(X_val), len(X_test))
    rng = np.random.default_rng(42)
    ref_idx = rng.choice(len(X_train), size=sample_size, replace=False)
    cur_idx = rng.choice(len(X_test), size=sample_size, replace=False)

    reference_errors = np.abs(
        y_val.values[:sample_size] - forecaster.predict(X_val.values[:sample_size])
    )
    current_errors = np.abs(
        y_test.iloc[cur_idx].values - forecaster.predict(X_test.iloc[cur_idx].values)
    )

    drift_report = run_drift_detection_pipeline(
        reference_features=X_train.iloc[ref_idx],
        reference_target=y_train.iloc[ref_idx].values,
        reference_errors=reference_errors,
        current_features=X_test.iloc[cur_idx],
        current_target=y_test.iloc[cur_idx].values,
        current_errors=current_errors,
    )
    drift_report_uri = save_drift_report(run_id, drift_report)

    client = mlflow.tracking.MlflowClient()
    candidate_run = client.get_run(run_id)
    val_rmse = candidate_run.data.metrics["val_rmse"]
    client.set_tag(run_id, "drift_report_gcs", drift_report_uri)
    client.set_tag(
        run_id,
        "drift_status",
        "ALERT" if drift_report["overall_drift_detected"] else "STABLE",
    )

    logger.info("Promoting candidate through registry gates")
    registry_metadata = register_model(
        run_id=run_id,
        val_rmse=val_rmse,
        dataset_version_hash=dataset_version_hash,
        validation_summary=validation_summary,
        bias_report=bias_report,
        force_promote=FORCE_PROMOTE,
    )

    logger.info("Generating production predictions from champion model")
    predictions_df = run_prediction_pipeline()

    logger.info(
        "Retraining pipeline complete | run_id=%s | registry_version=%s | rows=%s",
        run_id,
        registry_metadata["registry_version"],
        len(predictions_df),
    )


if __name__ == "__main__":
    main()
