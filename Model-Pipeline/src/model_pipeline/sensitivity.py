"""
Sensitivity analysis for the BlueForecast baseline model.

Four analyses:
  1. XGBoost built-in feature importance (gain) — fast, built-in
  2. SHAP TreeExplainer importance — theoretically sound, sampled for speed
  3. Hyperparameter sensitivity — one-at-a-time variation on 20% subsample
  4. Bayesian hyperparameter optimization (Optuna TPE) — optional, joint search

All outputs are saved to GCS and artifact paths are logged to the MLflow run.
Charts are logged as MLflow artifacts (visible in the run's Artifacts tab).

RUNTIME ESTIMATES (CPU):
  Feature importance      : <1 second
  SHAP (10k sample)       : ~1–3 minutes
  Hyperparam sweep (OAT)  : ~15–25 minutes (6–8 mini training runs on 20% data)
  Bayesian search (50 tr) : ~20–40 minutes (50 mini training runs on 20% data)
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

# Bayesian optimization search space (Optuna TPE, joint search)
BAYESIAN_SEARCH_SPACE = {
    "n_estimators":     (200, 1500),   # int
    "max_depth":        (4, 10),       # int
    "learning_rate":    (0.01, 0.2),   # float, log scale
    "subsample":        (0.6, 1.0),    # float
    "colsample_bytree": (0.6, 1.0),    # float
}

# Use this fraction of training data for the hyperparam sweep/search
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
# 4. Bayesian hyperparameter optimization (Optuna TPE)
# ---------------------------------------------------------------------------

def run_bayesian_optimization(
    X_train:     pd.DataFrame,
    y_train:     pd.Series,
    X_val:       pd.DataFrame,
    y_val:       pd.Series,
    base_params: dict,
    n_trials:    int = 50,
    run_id:      str = "",
) -> dict:
    """
    Joint Bayesian hyperparameter search using Optuna (TPE sampler).

    Unlike the OAT sweep which varies one parameter at a time, Bayesian search
    explores parameter interactions and converges to the joint optimum.

    Runs on 20% training subsample (same as OAT — speed/accuracy trade-off).
    Logs best params and improvement delta to MLflow run tags.

    Parameters
    ----------
    X_train, y_train : training data
    X_val, y_val     : validation data (objective = val RMSE)
    base_params      : DEFAULT_PARAMS dict (used to compute improvement delta)
    n_trials         : number of Optuna trials (default 50; ~20-40 min on CPU)
    run_id           : MLflow run ID for tagging results

    Returns
    -------
    dict with best_params, best_val_rmse, improvement_delta, top-10 trials
    """
    try:
        import optuna
        optuna.logging.set_verbosity(optuna.logging.WARNING)
    except ImportError:
        logger.error("optuna not installed — run: pip install optuna>=3.0.0")
        return {"skipped": True, "reason": "optuna not installed"}

    import xgboost as xgb
    from sklearn.metrics import mean_squared_error

    # Subsample training data for speed (same fraction as OAT sweep)
    n_sample = int(len(X_train) * SWEEP_SAMPLE_FRAC)
    idx      = np.random.default_rng(42).choice(len(X_train), size=n_sample, replace=False)
    X_sub    = X_train.iloc[idx].values
    y_sub    = y_train.iloc[idx].values
    X_v      = X_val.values
    y_v      = y_val.values

    # Fixed params not in the search space
    fixed = {
        k: v for k, v in base_params.items()
        if k not in BAYESIAN_SEARCH_SPACE and k != "early_stopping_rounds"
    }
    fixed["n_jobs"] = -1

    def objective(trial):
        params = {
            **fixed,
            "n_estimators":    trial.suggest_int(
                "n_estimators", *BAYESIAN_SEARCH_SPACE["n_estimators"],
            ),
            "max_depth":       trial.suggest_int(
                "max_depth", *BAYESIAN_SEARCH_SPACE["max_depth"],
            ),
            "learning_rate":   trial.suggest_float(
                "learning_rate", *BAYESIAN_SEARCH_SPACE["learning_rate"], log=True,
            ),
            "subsample":       trial.suggest_float(
                "subsample", *BAYESIAN_SEARCH_SPACE["subsample"],
            ),
            "colsample_bytree": trial.suggest_float(
                "colsample_bytree", *BAYESIAN_SEARCH_SPACE["colsample_bytree"],
            ),
        }
        model = xgb.XGBRegressor(**params)
        model.fit(X_sub, y_sub, verbose=False)
        return float(np.sqrt(mean_squared_error(y_v, model.predict(X_v))))

    logger.info(
        "Starting Optuna Bayesian search (%d trials on %.0f%% subsample)...",
        n_trials, SWEEP_SAMPLE_FRAC * 100,
    )
    study = optuna.create_study(
        direction="minimize",
        sampler=optuna.samplers.TPESampler(seed=42),
    )
    study.optimize(objective, n_trials=n_trials, show_progress_bar=False)

    best_val_rmse = round(study.best_value, 4)
    best_params   = {**fixed, **study.best_params}

    # Compute base RMSE for delta comparison
    base_search_params = {
        k: base_params[k]
        for k in BAYESIAN_SEARCH_SPACE
        if k in base_params
    }
    base_model = xgb.XGBRegressor(**{**fixed, **base_search_params})
    base_model.fit(X_sub, y_sub, verbose=False)
    base_val_rmse      = round(float(np.sqrt(mean_squared_error(y_v, base_model.predict(X_v)))), 4)
    improvement_delta  = round(base_val_rmse - best_val_rmse, 4)

    logger.info(
        "Bayesian search done. Best RMSE=%.4f | Base RMSE=%.4f | Improvement=%.4f",
        best_val_rmse, base_val_rmse, improvement_delta,
    )

    result = {
        "best_params":        best_params,
        "best_val_rmse":      best_val_rmse,
        "base_val_rmse":      base_val_rmse,
        "improvement_delta":  improvement_delta,
        "n_trials":           n_trials,
        "sweep_sample_frac":  SWEEP_SAMPLE_FRAC,
        "top_10_trials": [
            {"trial": t.number, "val_rmse": round(t.value, 4), "params": t.params}
            for t in sorted(study.trials, key=lambda t: t.value)[:10]
        ],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    # Tag the MLflow run with best params and delta
    if run_id:
        client = mlflow.tracking.MlflowClient()
        client.set_tag(run_id, "bayesian_best_val_rmse",  str(best_val_rmse))
        client.set_tag(run_id, "bayesian_improvement",    str(improvement_delta))
        client.set_tag(run_id, "bayesian_n_trials",       str(n_trials))
        for k, v in study.best_params.items():
            client.set_tag(run_id, f"bayesian_best_{k}", str(round(v, 6) if isinstance(v, float) else v))

    return result


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
    run_bayesian_search:   bool = False,
    bayesian_n_trials:     int  = 50,
) -> dict:
    """
    Run all sensitivity analyses and save outputs to GCS + MLflow.

    Parameters
    ----------
    forecaster            : fitted BaseForecaster
    X_train, y_train      : training data (sweep/search subsample)
    X_val, y_val          : validation data (sweep/search evaluation)
    X_test                : test data (SHAP sample)
    feature_cols          : ordered feature column names
    run_id                : MLflow run ID for artifact logging
    dataset_version_hash  : MD5 hash from data_loader
    base_params           : DEFAULT_PARAMS from trainer.py
    skip_hyperparam_sweep : True → skip OAT sweep (quick runs)
    run_bayesian_search   : True → run Optuna Bayesian optimization (~20–40 min)
    bayesian_n_trials     : number of Optuna trials (default 50)

    Returns
    -------
    sensitivity_report : dict with all analysis results and GCS URIs
    """
    from model_pipeline.visualizations import (
        log_feature_importance_chart,
        log_version_comparison_chart,
        log_sensitivity_curves,
    )

    logger.info("=== Sensitivity Analysis ===")
    artifact_uris = {}

    # --- 1. XGBoost built-in feature importance ---
    logger.info("[1/4] Computing XGBoost gain importance...")
    xgb_importance = compute_feature_importance(forecaster, feature_cols)
    top5_gain = list(xgb_importance.keys())[:5]
    logger.info("  Top-5 by gain: %s", top5_gain)

    # --- 2. SHAP importance ---
    logger.info("[2/4] Computing SHAP importance (10k sample)...")
    shap_importance = compute_shap_importance(forecaster, X_test, feature_cols)
    top5_shap = list(shap_importance.keys())[:5]
    logger.info("  Top-5 by SHAP: %s", top5_shap)

    # Combined importance artifact
    feature_importance_data = {
        "run_id":               run_id,
        "dataset_version_hash": dataset_version_hash,
        "xgboost_gain":         xgb_importance,
        "shap_mean_abs":        shap_importance,
        "top_5_by_gain":        top5_gain,
        "top_5_by_shap":        top5_shap,
        "gain_shap_agreement":  top5_gain[:3] == top5_shap[:3],
        "timestamp":            datetime.now(timezone.utc).isoformat(),
    }
    artifact_uris["feature_importance_gcs"] = _save_to_gcs(
        run_id, "feature_importance.json", feature_importance_data
    )

    # --- 3. OAT Hyperparameter sensitivity sweep ---
    if skip_hyperparam_sweep:
        logger.info("[3/4] Hyperparameter sweep skipped (skip_hyperparam_sweep=True).")
        hyperparam_data = {"skipped": True, "reason": "skip_hyperparam_sweep=True"}
    else:
        logger.info("[3/4] Running OAT hyperparameter sensitivity sweep (~15–25 min)...")
        hyperparam_results = run_hyperparam_sensitivity(
            X_train, y_train, X_val, y_val, feature_cols, base_params
        )
        most_sensitive = max(
            hyperparam_results.items(),
            key=lambda kv: max(abs(d) for d in kv[1]["delta_from_base"]),
        )
        hyperparam_data = {
            "run_id":               run_id,
            "sweep_sample_frac":    SWEEP_SAMPLE_FRAC,
            "parameters":           hyperparam_results,
            "most_sensitive_param": most_sensitive[0],
            "timestamp":            datetime.now(timezone.utc).isoformat(),
        }
        logger.info("  Most sensitive parameter: %s", most_sensitive[0])

    artifact_uris["hyperparam_sensitivity_gcs"] = _save_to_gcs(
        run_id, "hyperparam_sensitivity.json", hyperparam_data
    )

    # --- 4. Bayesian hyperparameter optimization (optional) ---
    if run_bayesian_search:
        logger.info("[4/4] Running Bayesian optimization (%d trials)...", bayesian_n_trials)
        bayesian_data = run_bayesian_optimization(
            X_train=X_train, y_train=y_train,
            X_val=X_val,     y_val=y_val,
            base_params=base_params,
            n_trials=bayesian_n_trials,
            run_id=run_id,
        )
        artifact_uris["bayesian_search_gcs"] = _save_to_gcs(
            run_id, "bayesian_search.json", bayesian_data
        )
        logger.info(
            "  Bayesian best RMSE=%.4f | improvement=%.4f",
            bayesian_data.get("best_val_rmse", 0),
            bayesian_data.get("improvement_delta", 0),
        )
    else:
        logger.info("[4/4] Bayesian search skipped (run_bayesian_search=False).")
        bayesian_data = {"skipped": True, "reason": "run_bayesian_search=False"}

    # --- Log MLflow tags + artifact paths ---
    _log_to_mlflow(run_id, artifact_uris, top5_shap)

    # --- Log charts to MLflow (visible in Artifacts tab → charts/) ---
    logger.info("Logging visualisation charts to MLflow...")
    try:
        log_feature_importance_chart(run_id, feature_importance_data)
        log_version_comparison_chart(
            run_id,
            client=mlflow.tracking.MlflowClient(),
        )
        log_sensitivity_curves(run_id, hyperparam_data)
        logger.info("Charts logged successfully.")
    except Exception as chart_exc:
        # Chart failures must never crash the pipeline
        logger.warning("Chart logging failed (non-fatal): %s", chart_exc)

    # Build final report
    sensitivity_report = {
        "run_id":              run_id,
        "feature_importance":  feature_importance_data,
        "hyperparam_analysis": hyperparam_data,
        "bayesian_search":     bayesian_data,
        "artifact_uris":       artifact_uris,
    }

    logger.info("Sensitivity analysis complete.")
    return sensitivity_report