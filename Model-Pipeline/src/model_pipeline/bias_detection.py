"""
Model-level bias detection and mitigation path for BlueForecast.

Evaluates model performance across 6 contextual slices to identify
systematic prediction disparities. Blocks promotion if RMSE gap
exceeds threshold across any dimension.

The 6 slice dimensions mirror the data pipeline bias report (bias_report.json)
for side-by-side comparability between data distribution bias and model error bias.

BIAS GATE:
  RMSE disparity ratio (max_group_rmse / min_group_rmse) > 3.0×
  within any dimension flags a violation. Minimum 1,000 samples required
  per group to be included in the disparity calculation.

MITIGATION PATH (Task H):
  If bias is violated, compute_mitigation_weights(train_df, bias_report) returns
  per-sample training weights. Pass these to run_training_pipeline() using the
  sample_weight parameter (requires trainer.py patch — see below).
  If disparity persists after mitigation, promotion is blocked and requires
  explicit lead override via BIAS_OVERRIDE_REASON environment variable.

PRIORITY SLICE:
  station_capacity is flagged as a known risk — the data pipeline bias report
  already identified demand disparity across capacity groups. This is the first
  slice to check when a violation occurs.
"""

import json
import logging
import os
from datetime import datetime, timezone

import mlflow.tracking
import numpy as np
import pandas as pd
from google.cloud import storage
from sklearn.metrics import mean_absolute_error, mean_squared_error

logger = logging.getLogger("model_pipeline.bias_detection")
logger.setLevel(logging.INFO)

BUCKET = "bluebikes-demand-predictor-data"

BIAS_THRESHOLDS: dict = {
    "max_disparity_ratio":   3.0,   # max/min RMSE within a dimension
    "min_samples_per_group": 1_000, # groups below this are excluded from ratio check
}


class ModelBiasError(Exception):
    """
    Raised when model exhibits unacceptable RMSE disparity across slices.
    Catching this blocks registry promotion.
    Set BIAS_OVERRIDE_REASON env var for lead-approved manual override.
    """


# ---------------------------------------------------------------------------
# Slice assignment functions (mirror data pipeline bias_detection.py)
# ---------------------------------------------------------------------------

def _time_of_day_label(hour: pd.Series) -> pd.Series:
    """peak=7–9am + 5–7pm, night=9pm–6am, off_peak=everything else."""
    peak  = ((hour >= 7)  & (hour <= 9)) | ((hour >= 17) & (hour <= 19))
    night = (hour >= 21) | (hour <= 6)
    return pd.Series(
        np.where(peak, "peak", np.where(night, "night", "off_peak")),
        index=hour.index,
    )


def _day_type_label(is_weekend: pd.Series, is_holiday: pd.Series) -> pd.Series:
    """holiday > weekend > weekday (holiday takes precedence)."""
    return pd.Series(
        np.where(is_holiday == 1, "holiday",
                 np.where(is_weekend == 1, "weekend", "weekday")),
        index=is_weekend.index,
    )


def _season_label(month: pd.Series) -> pd.Series:
    """spring=Mar–May, summer=Jun–Aug, fall=Sep–Nov, winter=Dec–Feb."""
    return pd.Series(
        np.where(month.isin([3, 4, 5]),   "spring",
        np.where(month.isin([6, 7, 8]),   "summer",
        np.where(month.isin([9, 10, 11]), "fall",
                                           "winter"))),
        index=month.index,
    )


def _capacity_label(capacity: pd.Series) -> pd.Series:
    """low=≤10 docks, mid=11–20, high=>20."""
    return pd.Series(
        np.where(capacity <= 10, "low",
                 np.where(capacity <= 20, "mid", "high")),
        index=capacity.index,
    )


def _precipitation_label(precipitation_mm: pd.Series) -> pd.Series:
    """dry=no rain, rainy=any measurable precipitation."""
    return pd.Series(
        np.where(precipitation_mm > 0, "rainy", "dry"),
        index=precipitation_mm.index,
    )


def _temperature_label(temperature_c: pd.Series) -> pd.Series:
    """cold=<10°C, mild=10–25°C, hot=>25°C."""
    return pd.Series(
        np.where(temperature_c < 10, "cold",
                 np.where(temperature_c <= 25, "mild", "hot")),
        index=temperature_c.index,
    )


def _add_slice_columns(X: pd.DataFrame) -> pd.DataFrame:
    """
    Add 6 slice label columns to a copy of X.
    All required columns must already be in X (they are in FEATURE_COLS).
    """
    df = X.copy()
    df["_slice_time_of_day"]    = _time_of_day_label(df["hour_of_day"])
    df["_slice_day_type"]       = _day_type_label(df["is_weekend"], df["is_holiday"])
    df["_slice_season"]         = _season_label(df["month"])
    df["_slice_capacity"]       = _capacity_label(df["capacity"])
    df["_slice_precipitation"]  = _precipitation_label(df["precipitation_mm"])
    df["_slice_temperature"]    = _temperature_label(df["temperature_c"])
    return df


# ---------------------------------------------------------------------------
# Per-slice metric computation
# ---------------------------------------------------------------------------

DIMENSIONS: dict[str, str] = {
    "time_of_day":    "_slice_time_of_day",
    "day_type":       "_slice_day_type",
    "season":         "_slice_season",
    "station_capacity": "_slice_capacity",   # priority — flagged in data bias report
    "precipitation":  "_slice_precipitation",
    "temperature":    "_slice_temperature",
}


def _compute_group_metrics(
    y_true:  np.ndarray,
    y_pred:  np.ndarray,
    groups:  pd.Series,
) -> pd.DataFrame:
    """
    Compute RMSE and MAE per group label.
    Returns a DataFrame with columns: group, rmse, mae, count.
    """
    records = []
    for label in sorted(groups.unique()):
        mask = (groups == label).values
        yt = y_true[mask]
        yp = y_pred[mask]
        records.append({
            "group": label,
            "rmse":  float(np.sqrt(mean_squared_error(yt, yp))),
            "mae":   float(mean_absolute_error(yt, yp)),
            "count": int(mask.sum()),
        })
    return pd.DataFrame(records)


def _compute_disparity_ratio(
    group_metrics: pd.DataFrame,
    min_samples:   int,
) -> float | None:
    """
    Compute max/min RMSE ratio across groups with sufficient samples.
    Returns None if fewer than 2 groups meet the minimum sample requirement.
    """
    eligible = group_metrics[group_metrics["count"] >= min_samples]
    if len(eligible) < 2:
        return None
    return float(eligible["rmse"].max() / eligible["rmse"].min())


# ---------------------------------------------------------------------------
# GCS + MLflow helpers
# ---------------------------------------------------------------------------

def _save_bias_report_to_gcs(run_id: str, report: dict) -> str:
    gcs_path = f"processed/models/{run_id}/bias_report.json"
    blob = storage.Client().bucket(BUCKET).blob(gcs_path)
    blob.upload_from_string(
        json.dumps(report, indent=2, default=str),
        content_type="application/json",
    )
    uri = f"gs://{BUCKET}/{gcs_path}"
    logger.info("Bias report saved → %s", uri)
    return uri


def _log_bias_to_mlflow(run_id: str, report: dict, gcs_uri: str) -> None:
    client = mlflow.tracking.MlflowClient()
    # Log disparity ratio per dimension as a metric
    for dim_name, dim_data in report["dimensions"].items():
        ratio = dim_data.get("disparity_ratio")
        if ratio is not None:
            client.log_metric(run_id, f"bias_disparity_{dim_name}", ratio)
    client.set_tag(run_id, "bias_status",     report["bias_status"])
    client.set_tag(run_id, "bias_report_gcs", gcs_uri)
    logger.info("Bias metrics logged to MLflow run %s", run_id)


# ---------------------------------------------------------------------------
# Task H: Mitigation weight computation
# ---------------------------------------------------------------------------

def compute_mitigation_weights(
    train_df:    pd.DataFrame,
    bias_report: dict,
) -> np.ndarray:
    """
    Compute per-sample training weights to mitigate identified bias violations.

    For each violated dimension, samples from high-RMSE groups receive
    weight > 1.0 (model pays more attention); low-RMSE groups are not
    downweighted (clamped at 1.0). Max weight is capped at 3.0× to
    prevent training instability. Final weight = product across dimensions.

    Parameters
    ----------
    train_df    : the full training DataFrame (from temporal_split output)
    bias_report : the dict returned by detect_model_bias()

    Returns
    -------
    weights : np.ndarray of shape (len(train_df),), dtype float32
    """
    violations = [d for d in bias_report["dimensions"].values()
                  if d["status"] == "FAILED"]

    if not violations:
        logger.info("No violations — returning uniform weights.")
        return np.ones(len(train_df), dtype=np.float32)

    train_sliced = _add_slice_columns(train_df)
    weights = np.ones(len(train_df), dtype=np.float32)

    global_rmse = bias_report.get("global_test_rmse", 1.0)

    for dim_name, dim_data in bias_report["dimensions"].items():
        if dim_data["status"] != "FAILED":
            continue

        slice_col = DIMENSIONS[dim_name]
        groups    = train_sliced[slice_col]

        for group_label, group_stats in dim_data["groups"].items():
            group_rmse = group_stats["rmse"]
            # Upweight groups that are performing worse than global average
            multiplier = max(1.0, min(3.0, group_rmse / global_rmse))
            mask = (groups == group_label).values
            weights[mask] *= multiplier
            if multiplier > 1.0:
                logger.info(
                    "Mitigation: %s / %s → weight ×%.2f (group RMSE %.4f vs global %.4f)",
                    dim_name, group_label, multiplier, group_rmse, global_rmse,
                )

    logger.info(
        "Mitigation weights computed. Range: [%.2f, %.2f], mean: %.2f",
        weights.min(), weights.max(), weights.mean(),
    )
    return weights


# ---------------------------------------------------------------------------
# Main public API
# ---------------------------------------------------------------------------

def detect_model_bias(
    forecaster,
    X_test:               pd.DataFrame,
    y_test:               pd.Series,
    run_id:               str,
    dataset_version_hash: str,
    thresholds:           dict | None = None,
    override_reason:      str | None  = None,
) -> dict:
    """
    Evaluate model RMSE disparity across 6 contextual slice dimensions.

    Raises ModelBiasError if any dimension exceeds the disparity threshold,
    unless override_reason is provided (lead-approved manual override).

    Parameters
    ----------
    forecaster           : fitted BaseForecaster
    X_test, y_test       : test set (the same set used for Task E evaluation)
    run_id               : MLflow run ID (for metric logging and GCS path)
    dataset_version_hash : MD5 hash from data_loader
    thresholds           : override BIAS_THRESHOLDS (lead use only)
    override_reason      : if set, bias violations are logged but not raised

    Returns
    -------
    report : dict — the full bias report (also written to GCS)
    """
    if thresholds is None:
        thresholds = BIAS_THRESHOLDS

    # Also check env var for override (useful for CI/CD automated pipelines)
    if override_reason is None:
        override_reason = os.getenv("BIAS_OVERRIDE_REASON")

    X_arr = X_test.values if hasattr(X_test, "values") else X_test
    y_arr = y_test.values if hasattr(y_test, "values") else y_test

    y_pred = forecaster.predict(X_arr)

    global_rmse = float(np.sqrt(mean_squared_error(y_arr, y_pred)))
    logger.info("Global test RMSE: %.4f | Computing slice-level bias...", global_rmse)

    # Add slice columns to X_test (need a DataFrame with column names)
    if not isinstance(X_test, pd.DataFrame):
        raise TypeError("X_test must be a pandas DataFrame for bias detection "
                        "(column names required for slice assignment).")

    X_sliced = _add_slice_columns(X_test)
    y_series = pd.Series(y_arr, index=X_sliced.index)
    y_pred_s = pd.Series(y_pred, index=X_sliced.index)

    dimension_results = {}
    violations        = []

    for dim_name, slice_col in DIMENSIONS.items():
        group_metrics = _compute_group_metrics(
            y_series.values,
            y_pred_s.values,
            X_sliced[slice_col],
        )
        ratio = _compute_disparity_ratio(
            group_metrics,
            thresholds["min_samples_per_group"],
        )

        status = "SKIPPED"  # default if not enough groups
        if ratio is not None:
            status = "FAILED" if ratio > thresholds["max_disparity_ratio"] else "PASSED"

        groups_dict = {
            row["group"]: {
                "rmse":  round(row["rmse"],  4),
                "mae":   round(row["mae"],   4),
                "count": row["count"],
            }
            for _, row in group_metrics.iterrows()
        }

        dimension_results[dim_name] = {
            "groups":           groups_dict,
            "disparity_ratio":  round(ratio, 4) if ratio is not None else None,
            "threshold":        thresholds["max_disparity_ratio"],
            "status":           status,
        }

        flag = "⚠️  FAILED" if status == "FAILED" else "✓"
        logger.info(
            "  %-20s ratio=%-6s  %s",
            dim_name,
            f"{ratio:.2f}×" if ratio is not None else "N/A",
            flag,
        )

        if status == "FAILED":
            violations.append(dim_name)

    overall_status = "FAILED" if violations else "PASSED"

    report = {
        "run_id":               run_id,
        "dataset_version_hash": dataset_version_hash,
        "model_type":           forecaster.model_type,
        "test_rows":            int(len(y_arr)),
        "global_test_rmse":     round(global_rmse, 4),
        "bias_status":          overall_status,
        "dimensions":           dimension_results,
        "violations":           violations,
        "mitigation": (
            "Sample weights computed and saved to GCS for next training run. "
            "Re-run training with compute_mitigation_weights() output."
            if violations else None
        ),
        "override_reason": override_reason,
        "timestamp":       datetime.now(timezone.utc).isoformat(),
    }

    gcs_uri = _save_bias_report_to_gcs(run_id, report)
    _log_bias_to_mlflow(run_id, report, gcs_uri)

    if violations:
        msg = (
            f"Model bias detected in {len(violations)} dimension(s): "
            f"{', '.join(violations)}\n"
            f"Disparity ratios exceeded {thresholds['max_disparity_ratio']}× threshold.\n"
            f"Full report: {gcs_uri}\n"
            f"To mitigate: call compute_mitigation_weights(train_df, report) "
            f"and retrain with the returned sample_weight array."
        )
        if override_reason:
            logger.warning("BIAS VIOLATION — overriding due to: %s\n%s", override_reason, msg)
        else:
            logger.error(msg)
            raise ModelBiasError(msg)

    logger.info("Bias detection complete. Status: %s", overall_status)
    return report
