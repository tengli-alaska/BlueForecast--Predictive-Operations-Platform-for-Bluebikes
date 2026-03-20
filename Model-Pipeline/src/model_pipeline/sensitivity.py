"""
Sensitivity analysis for the BlueForecast baseline model.

Three analyses:
  1. XGBoost built-in feature importance (gain) — fast, built-in
  2. SHAP TreeExplainer importance — theoretically sound, sampled for speed
  3. Hyperparameter sensitivity — one-at-a-time variation on 20% subsample

All outputs are saved to GCS and artifact paths are logged to the MLflow run.

RUNTIME ESTIMATES (CPU):
  Feature importance : <1 second
  SHAP (10k sample)  : ~1–3 minutes
  Hyperparam sweep   : ~15–25 minutes (6–8 mini training runs on 20% data)
"""

import json
import logging
from datetime import datetime, timezone

import mlflow.tracking
import numpy as np
import pandas as pd
import shap
from google.cloud import storage

logger = logging.getLogger("model_pipeline.sensitivity")
logger.setLevel(logging.INFO)

BUCKET = "bluebikes-demand-predictor-data"

# Hyperparameter variations to test (one parameter changes, rest stay at base)
HYPERPARAM_SWEEP = {
    "n_estimators":  [100, 200, 300, 500, 700],
    "max_depth":     [3, 4, 6, 8, 10],
    "learning_rate": [0.01, 0.03, 0.05, 0.1, 0.2],
}

# Use this fraction of training data for the hyperparam sweep
# (directional analysis — full precision not required)
SWEEP_SAMPLE_FRAC = 0.20


# ---------------------------------------------------------------------------
# 1. XGBoost built-in feature importance
# ---------------------------------------------------------------------------

def compute_feature_importance(
    forecaster,
    feature_cols: list[str],
) -> dict[str, float]:
    """
    Extract XGBoost gain-based feature importance.
    Returns feature → importance score (normalized to sum to 1.0).
    """
    raw_scores = forecaster._model.feature_importances_
    total = raw_scores.sum()
    normalized = {col: round(float(score / total), 6)
                  for col, score in zip(feature_cols, raw_scores)}
    # Sort descending for readability
    return dict(sorted(normalized.items(), key=lambda x: x[1], reverse=True))


# ---------------------------------------------------------------------------
# 2. SHAP importance
# ---------------------------------------------------------------------------

def compute_shap_importance(
    forecaster,
    X_test:       pd.DataFrame,
    feature_cols: list[str],
    n_sample:     int = 10_000,
    random_state: int = 42,
) -> dict[str, float]:
    """
    Compute SHAP mean absolute values using TreeExplainer on a random sample.

    TreeExplainer is exact for tree-based models (not approximate).
    We sample for speed — 10k rows gives stable mean |SHAP| estimates.

    Returns feature → mean |SHAP| value (unnormalized).
    """
    sample = X_test.sample(
        n=min(n_sample, len(X_test)),
        random_state=random_state,
    )
    logger.info("Computing SHAP values on %s-row sample...", f"{len(sample):,}")

    explainer   = shap.TreeExplainer(forecaster._model)
    shap_values = explainer.shap_values(sample.values)   # shape: (n_sample, n_features)

    mean_abs_shap = np.abs(shap_values).mean(axis=0)
    result = {
        col: round(float(val), 6)
        for col, val in zip(feature_cols, mean_abs_shap)
    }
    return dict(sorted(result.items(), key=lambda x: x[1], reverse=True))


# ---------------------------------------------------------------------------
# 3. Hyperparameter sensitivity sweep
# ---------------------------------------------------------------------------

def run_hyperparam_sensitivity(
    X_train:      pd.DataFrame,
    y_train:      pd.Series,
    X_val:        pd.DataFrame,
    y_val:        pd.Series,
    feature_cols: list[str],
    base_params:  dict,
) -> dict:
    """
    One-at-a-time hyperparameter sensitivity analysis on a training subsample.

    For each parameter in HYPERPARAM_SWEEP, retrain with each candidate value
    (all other params held at base_params) and record val RMSE.

    Returns a dict of {param_name: {values: [...], val_rmse: [...], delta: [...]}}.
    """
    import xgboost as xgb
    from sklearn.metrics import mean_squared_error

    # Subsample training data for speed
    n_sample = int(len(X_train) * SWEEP_SAMPLE_FRAC)
    idx      = np.random.default_rng(42).choice(len(X_train), size=n_sample, replace=False)
    X_sub    = X_train.iloc[idx].values
    y_sub    = y_train.iloc[idx].values
    X_v      = X_val.values
    y_v      = y_val.values

    # Base params without early_stopping_rounds (fixed during sweep for fair comparison)
    sweep_base = {k: v for k, v in base_params.items()
                  if k != "early_stopping_rounds"}
    sweep_base["n_jobs"] = -1

    results = {}

    for param_name, candidate_values in HYPERPARAM_SWEEP.items():
        logger.info("Sweeping %s: %s", param_name, candidate_values)
        rmse_list   = []
        delta_list  = []

        for value in candidate_values:
            run_params = {**sweep_base, param_name: value}
            model = xgb.XGBRegressor(**run_params)
            model.fit(X_sub, y_sub, verbose=False)
            y_pred = model.predict(X_v)
            rmse   = float(np.sqrt(mean_squared_error(y_v, y_pred)))
            rmse_list.append(round(rmse, 4))

        base_idx   = candidate_values.index(base_params.get(param_name, candidate_values[0]))
        base_rmse  = rmse_list[base_idx] if base_idx < len(rmse_list) else rmse_list[0]
        delta_list = [round(r - base_rmse, 4) for r in rmse_list]

        results[param_name] = {
            "values":   candidate_values,
            "val_rmse": rmse_list,
            "delta_from_base": delta_list,
            "base_value": base_params.get(param_name),
            "base_rmse":  round(base_rmse, 4),
            "most_sensitive": bool(max(abs(d) for d in delta_list) > 0.05),
        }

        logger.info(
            "  %s: min RMSE=%.4f at value=%s",
            param_name,
            min(rmse_list),
            candidate_values[rmse_list.index(min(rmse_list))],
        )

    return results


# ---------------------------------------------------------------------------
# GCS + MLflow helpers
# ---------------------------------------------------------------------------

def _save_to_gcs(run_id: str, filename: str, data: dict) -> str:
    gcs_path = f"processed/models/{run_id}/{filename}"
    blob     = storage.Client().bucket(BUCKET).blob(gcs_path)
    blob.upload_from_string(
        json.dumps(data, indent=2, default=str),
        content_type="application/json",
    )
    uri = f"gs://{BUCKET}/{gcs_path}"
    logger.info("Saved %s → %s", filename, uri)
    return uri


def _log_to_mlflow(run_id: str, artifact_uris: dict, top_shap: list[str]) -> None:
    client = mlflow.tracking.MlflowClient()
    for tag_key, uri in artifact_uris.items():
        client.set_tag(run_id, tag_key, uri)
    # Log top-3 SHAP features as tags for quick comparison in MLflow UI
    for i, feature in enumerate(top_shap[:3], start=1):
        client.set_tag(run_id, f"shap_top_{i}", feature)
    logger.info("Sensitivity artifact paths logged to MLflow run %s", run_id)


# ---------------------------------------------------------------------------
# Main public API
# ---------------------------------------------------------------------------

def run_sensitivity_analysis(
    forecaster,
    X_train:              pd.DataFrame,
    y_train:              pd.Series,
    X_val:                pd.DataFrame,
    y_val:                pd.Series,
    X_test:               pd.DataFrame,
    feature_cols:         list[str],
    run_id:               str,
    dataset_version_hash: str,
    base_params:          dict,
    skip_hyperparam_sweep: bool = False,
) -> dict:
    """
    Run all three sensitivity analyses and save outputs to GCS.

    Parameters
    ----------
    forecaster        : fitted BaseForecaster
    X_train, y_train  : training data (for hyperparam sweep subsample)
    X_val, y_val      : validation data (for hyperparam sweep evaluation)
    X_test            : test data (for SHAP sample)
    feature_cols      : ordered feature column names
    run_id            : MLflow run ID for artifact logging
    dataset_version_hash : MD5 hash from data_loader
    base_params       : DEFAULT_PARAMS from trainer.py
    skip_hyperparam_sweep : set True for quick runs (skips the slow sweep)

    Returns
    -------
    sensitivity_report : dict with all analysis results and GCS URIs
    """
    logger.info("=== Sensitivity Analysis ===")
    artifact_uris = {}

    # --- 1. XGBoost built-in feature importance ---
    logger.info("[1/3] Computing XGBoost gain importance...")
    xgb_importance = compute_feature_importance(forecaster, feature_cols)
    top5_gain = list(xgb_importance.keys())[:5]
    logger.info("  Top-5 by gain: %s", top5_gain)

    # --- 2. SHAP importance ---
    logger.info("[2/3] Computing SHAP importance (10k sample)...")
    shap_importance = compute_shap_importance(forecaster, X_test, feature_cols)
    top5_shap = list(shap_importance.keys())[:5]
    logger.info("  Top-5 by SHAP: %s", top5_shap)

    # Combined importance artifact
    feature_importance_data = {
        "run_id":              run_id,
        "dataset_version_hash": dataset_version_hash,
        "xgboost_gain":        xgb_importance,
        "shap_mean_abs":       shap_importance,
        "top_5_by_gain":       top5_gain,
        "top_5_by_shap":       top5_shap,
        "gain_shap_agreement": top5_gain[:3] == top5_shap[:3],
        "timestamp":           datetime.now(timezone.utc).isoformat(),
    }
    artifact_uris["feature_importance_gcs"] = _save_to_gcs(
        run_id, "feature_importance.json", feature_importance_data
    )

    # --- 3. Hyperparameter sensitivity ---
    if skip_hyperparam_sweep:
        logger.info("[3/3] Hyperparameter sweep skipped (skip_hyperparam_sweep=True).")
        hyperparam_data = {"skipped": True, "reason": "skip_hyperparam_sweep=True"}
    else:
        logger.info("[3/3] Running hyperparameter sensitivity sweep (~15–25 min on CPU)...")
        hyperparam_results = run_hyperparam_sensitivity(
            X_train, y_train, X_val, y_val, feature_cols, base_params
        )
        # Find the most impactful parameter
        most_sensitive = max(
            hyperparam_results.items(),
            key=lambda kv: max(abs(d) for d in kv[1]["delta_from_base"]),
        )
        hyperparam_data = {
            "run_id":             run_id,
            "sweep_sample_frac":  SWEEP_SAMPLE_FRAC,
            "parameters":         hyperparam_results,
            "most_sensitive_param": most_sensitive[0],
            "timestamp":          datetime.now(timezone.utc).isoformat(),
        }
        logger.info("  Most sensitive parameter: %s", most_sensitive[0])

    artifact_uris["hyperparam_sensitivity_gcs"] = _save_to_gcs(
        run_id, "hyperparam_sensitivity.json", hyperparam_data
    )

    # Build final report
    sensitivity_report = {
        "run_id":              run_id,
        "feature_importance":  feature_importance_data,
        "hyperparam_analysis": hyperparam_data,
        "artifact_uris":       artifact_uris,
    }

    _log_to_mlflow(run_id, artifact_uris, top5_shap)
    logger.info("Sensitivity analysis complete.")
    return sensitivity_report
