"""
Hold-out test set evaluation and validation gate for BlueForecast.

This module implements the formal validation stage that runs AFTER training.
It evaluates the trained model on the held-out test set (Oct–Dec 2024),
enforces minimum performance thresholds, and blocks promotion if gates fail.

THRESHOLD POLICY:
  VALIDATION_THRESHOLDS contains the current acceptance criteria.
  Thresholds are set by the project lead. Do not change them without
  explicit lead sign-off. They will tighten as the model improves.
  Current values are conservative — calibrated to the first baseline run
  (val RMSE 1.613, val R² 0.705).

OUTPUTS:
  - Validation summary JSON → GCS: processed/models/{run_id}/validation_summary.json
  - Test metrics appended to existing MLflow run via MlflowClient
"""

import json
import logging
from datetime import datetime, timezone

import mlflow.tracking
import numpy as np
import pandas as pd
from google.cloud import storage
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

logger = logging.getLogger("model_pipeline.evaluator")
logger.setLevel(logging.INFO)

BUCKET = "bluebikes-demand-predictor-data"

# ---------------------------------------------------------------------------
# Acceptance thresholds — project lead approved.
# RMSE / MAE upper bounds; R² lower bound. MAPE is informational only.
# ---------------------------------------------------------------------------
VALIDATION_THRESHOLDS: dict = {
    "max_test_rmse": 2.5,   # allows ~55% degradation from baseline val RMSE 1.613
    "min_test_r2":   0.50,  # hard floor — model must explain ≥50% of variance
    "max_test_mae":  1.5,   # allows ~75% degradation from baseline val MAE 0.857
    # MAPE intentionally excluded: noisy on zero-demand hours, not a reliable gate
}


class ModelValidationError(Exception):
    """
    Raised when the model fails one or more validation thresholds.
    Callers must catch this to block pipeline progression to registry push.
    """


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _compute_metrics(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    prefix: str,
) -> dict[str, float]:
    """
    Compute RMSE, MAE, MAPE, R² for a prediction array.
    MAPE is masked to y_true > 0 to avoid division-by-zero on zero-demand hours.
    """
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    mae  = float(mean_absolute_error(y_true, y_pred))
    r2   = float(r2_score(y_true, y_pred))

    nonzero = y_true > 0
    mape = (
        float(np.mean(np.abs(
            (y_true[nonzero] - y_pred[nonzero]) / y_true[nonzero]
        )) * 100)
        if nonzero.sum() > 0 else float("nan")
    )

    return {
        f"{prefix}_rmse": rmse,
        f"{prefix}_mae":  mae,
        f"{prefix}_mape": mape,
        f"{prefix}_r2":   r2,
    }


def _check_thresholds(
    metrics:    dict[str, float],
    thresholds: dict,
) -> dict[str, bool]:
    """
    Evaluate each metric against its threshold.
    Returns individual check results plus a combined 'all_passed' key.
    """
    return {
        "rmse_passed": metrics["test_rmse"] <= thresholds["max_test_rmse"],
        "r2_passed":   metrics["test_r2"]   >= thresholds["min_test_r2"],
        "mae_passed":  metrics["test_mae"]  <= thresholds["max_test_mae"],
        "all_passed":  (
            metrics["test_rmse"] <= thresholds["max_test_rmse"]
            and metrics["test_r2"] >= thresholds["min_test_r2"]
            and metrics["test_mae"] <= thresholds["max_test_mae"]
        ),
    }


def _save_summary_to_gcs(run_id: str, summary: dict) -> str:
    """Write validation_summary.json to GCS. Returns the GCS URI."""
    gcs_path = f"processed/models/{run_id}/validation_summary.json"
    blob = storage.Client().bucket(BUCKET).blob(gcs_path)
    blob.upload_from_string(
        json.dumps(summary, indent=2, default=str),
        content_type="application/json",
    )
    uri = f"gs://{BUCKET}/{gcs_path}"
    logger.info("Validation summary saved → %s", uri)
    return uri


def _append_to_mlflow_run(run_id: str, metrics: dict, gcs_uri: str) -> None:
    """
    Append test metrics to an already-completed MLflow run.
    Uses MlflowClient so the run does not need to be re-opened.
    NaN values (e.g. MAPE when all demand is zero) are skipped silently.
    """
    client = mlflow.tracking.MlflowClient()
    for key, value in metrics.items():
        if not (isinstance(value, float) and np.isnan(value)):
            client.log_metric(run_id, key, value)
    client.set_tag(run_id, "validation_summary_gcs", gcs_uri)
    client.set_tag(run_id, "test_evaluation_status",
                   "complete")
    logger.info("Test metrics appended to MLflow run %s", run_id)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def evaluate_on_test(
    forecaster,                          # BaseForecaster (avoid circular import)
    X_test:               pd.DataFrame,
    y_test:               pd.Series,
    run_id:               str,
    dataset_version_hash: str,
    thresholds:           dict | None = None,
) -> dict:
    """
    Evaluate the trained model on the held-out test set and enforce thresholds.

    Raises ModelValidationError if any threshold is not met — the pipeline
    must catch this and block registry push.

    Parameters
    ----------
    forecaster           : fitted BaseForecaster returned by run_training_pipeline()
    X_test, y_test       : held-out test features and target (Oct–Dec 2024)
    run_id               : MLflow run ID from training (for metric append + GCS path)
    dataset_version_hash : MD5 hash from data_loader (provenance, stored in summary)
    thresholds           : override VALIDATION_THRESHOLDS (lead use only)

    Returns
    -------
    summary : dict — the full validation summary written to GCS
    """
    if thresholds is None:
        thresholds = VALIDATION_THRESHOLDS

    X_arr = X_test.values if hasattr(X_test, "values") else X_test
    y_arr = y_test.values if hasattr(y_test, "values") else y_test

    logger.info("Running test-set evaluation: %s rows", f"{len(X_arr):,}")
    y_pred = forecaster.predict(X_arr)
    metrics = _compute_metrics(y_arr, y_pred, prefix="test")

    for name, val in metrics.items():
        logger.info("  %-20s %.4f", name, val)

    checks = _check_thresholds(metrics, thresholds)

    summary = {
        "run_id":               run_id,
        "dataset_version_hash": dataset_version_hash,
        "model_type":           forecaster.model_type,
        "test_rows":            int(len(X_arr)),
        "test_date_range":      "2024-10-01 → 2024-12-31",
        "metrics":              {k: round(v, 6) for k, v in metrics.items()},
        "thresholds":           thresholds,
        "threshold_checks":     checks,
        "validation_status":    "PASSED" if checks["all_passed"] else "FAILED",
        "timestamp":            datetime.now(timezone.utc).isoformat(),
    }

    gcs_uri = _save_summary_to_gcs(run_id, summary)
    _append_to_mlflow_run(run_id, metrics, gcs_uri)

    if not checks["all_passed"]:
        # Build a clear per-metric failure report
        failed_lines = []
        if not checks["rmse_passed"]:
            failed_lines.append(
                f"  RMSE  {metrics['test_rmse']:.4f}  >  max allowed {thresholds['max_test_rmse']}"
            )
        if not checks["r2_passed"]:
            failed_lines.append(
                f"  R²    {metrics['test_r2']:.4f}  <  min required {thresholds['min_test_r2']}"
            )
        if not checks["mae_passed"]:
            failed_lines.append(
                f"  MAE   {metrics['test_mae']:.4f}  >  max allowed {thresholds['max_test_mae']}"
            )
        raise ModelValidationError(
            "Model failed validation gate — do not promote.\n"
            "Failed thresholds:\n" + "\n".join(failed_lines) + f"\n"
            f"Full report: {gcs_uri}"
        )

    logger.info("Validation gate PASSED ✓ — all thresholds met.")
    return summary
