"""
Bayesian hyperparameter optimization for BlueForecast using Optuna.

Closes the submission requirement: "grid search, random search, or Bayesian
optimization" (Section 3 of guidelines).

The existing OAT sweep in sensitivity.py explores one parameter at a time.
This module explores the joint search space using Optuna's TPE sampler.

USAGE:
  from model_pipeline.hyperparam_tuner import run_optuna_search

  best_params = run_optuna_search(
      X_train, y_train, X_val, y_val,
      n_trials=30, sample_frac=0.20,
  )

RUNTIME:  30 trials × 20% subsample ≈ 15–30 min on CPU.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Any

import numpy as np
import optuna
import xgboost as xgb
from sklearn.metrics import mean_squared_error
from google.cloud import storage

logger = logging.getLogger("model_pipeline.hyperparam_tuner")
logger.setLevel(logging.INFO)

BUCKET = "bluebikes-demand-predictor-data"

# Suppress Optuna's verbose per-trial output
optuna.logging.set_verbosity(optuna.logging.WARNING)

# Fixed params NOT tuned by Optuna
FIXED_PARAMS: dict[str, Any] = {
    "random_state": 42,
    "n_jobs": -1,
    "objective": "reg:squarederror",
    "eval_metric": "rmse",
    "tree_method": "hist",
    "early_stopping_rounds": 20,
}


def _objective(
    trial: optuna.Trial,
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_val: np.ndarray,
    y_val: np.ndarray,
) -> float:
    """Optuna objective: train XGBoost with sampled params, return val RMSE."""
    params = {
        "n_estimators":    trial.suggest_int("n_estimators", 100, 1000, step=100),
        "max_depth":       trial.suggest_int("max_depth", 3, 10),
        "learning_rate":   trial.suggest_float("learning_rate", 0.01, 0.20, log=True),
        "subsample":       trial.suggest_float("subsample", 0.6, 1.0, step=0.1),
        "colsample_bytree": trial.suggest_float("colsample_bytree", 0.6, 1.0, step=0.1),
        "min_child_weight": trial.suggest_int("min_child_weight", 1, 10),
        "reg_alpha":       trial.suggest_float("reg_alpha", 1e-3, 10.0, log=True),
        "reg_lambda":      trial.suggest_float("reg_lambda", 1e-3, 10.0, log=True),
    }

    model = xgb.XGBRegressor(
        **params,
        random_state=42,
        n_jobs=-1,
        objective="reg:squarederror",
        eval_metric="rmse",
        tree_method="hist",
        early_stopping_rounds=20,
    )
    model.fit(X_train, y_train, eval_set=[(X_val, y_val)], verbose=False)
    y_pred = model.predict(X_val)
    rmse = float(np.sqrt(mean_squared_error(y_val, y_pred)))

    logger.info(
        "  Trial %d: RMSE=%.4f | n_est=%d depth=%d lr=%.4f",
        trial.number, rmse,
        trial.params["n_estimators"],
        trial.params["max_depth"],
        trial.params["learning_rate"],
    )
    return rmse


def run_optuna_search(
    X_train,
    y_train,
    X_val,
    y_val,
    n_trials: int = 30,
    sample_frac: float = 0.20,
    random_state: int = 42,
) -> dict[str, Any]:
    """
    Run Optuna Bayesian search on a training subsample.

    Returns
    -------
    best_params : dict ready to merge with FIXED_PARAMS for final training
    """
    X_tr = X_train.values if hasattr(X_train, "values") else X_train
    y_tr = y_train.values if hasattr(y_train, "values") else y_train
    X_v = X_val.values if hasattr(X_val, "values") else X_val
    y_v = y_val.values if hasattr(y_val, "values") else y_val

    # Subsample training data for speed
    rng = np.random.default_rng(random_state)
    n_sample = int(len(X_tr) * sample_frac)
    idx = rng.choice(len(X_tr), size=n_sample, replace=False)
    X_sub, y_sub = X_tr[idx], y_tr[idx]

    logger.info(
        "Starting Optuna search: %d trials on %s-row subsample (%.0f%%)",
        n_trials, f"{n_sample:,}", sample_frac * 100,
    )

    study = optuna.create_study(
        direction="minimize",
        sampler=optuna.samplers.TPESampler(seed=random_state),
        study_name="blueforecast-hpo",
    )
    study.optimize(
        lambda trial: _objective(trial, X_sub, y_sub, X_v, y_v),
        n_trials=n_trials,
        show_progress_bar=False,
    )

    best = study.best_trial
    logger.info("Optuna complete. Best trial #%d: RMSE=%.4f", best.number, best.value)
    for k, v in best.params.items():
        logger.info("  %s: %s", k, v)

    # Merge tuned params with fixed params
    return {**best.params, **FIXED_PARAMS}


def save_optuna_report(
    best_params: dict[str, Any],
    n_trials: int,
    sample_frac: float,
    baseline_val_rmse: float,
    best_val_rmse: float,
    run_id: str,
) -> str:
    """Save Optuna results to GCS. Returns the GCS URI."""
    report = {
        "run_id": run_id,
        "method": "optuna_tpe_bayesian",
        "n_trials": n_trials,
        "sample_frac": sample_frac,
        "best_params": {k: v for k, v in best_params.items()
                        if k not in ("random_state", "n_jobs", "objective",
                                     "eval_metric", "tree_method",
                                     "early_stopping_rounds")},
        "baseline_val_rmse": round(baseline_val_rmse, 4),
        "best_val_rmse": round(best_val_rmse, 4),
        "improvement": round(baseline_val_rmse - best_val_rmse, 4),
        "improvement_pct": round(
            (baseline_val_rmse - best_val_rmse) / baseline_val_rmse * 100, 2
        ) if baseline_val_rmse > 0 else 0.0,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    gcs_path = f"processed/models/{run_id}/optuna_search.json"
    blob = storage.Client().bucket(BUCKET).blob(gcs_path)
    blob.upload_from_string(
        json.dumps(report, indent=2, default=str),
        content_type="application/json",
    )
    uri = f"gs://{BUCKET}/{gcs_path}"
    logger.info("Optuna report saved → %s", uri)
    return uri