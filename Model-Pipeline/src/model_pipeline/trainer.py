"""
Baseline model trainer for BlueForecast.

ARCHITECTURE CONTRACT:
  XGBoost is NOT the pipeline's dependency — BaseForecaster is.
  XGBoost is one swappable implementation of that interface.

  To replace XGBoost later:
    1. Subclass BaseForecaster
    2. Implement train() and predict()
    3. Pass your class to run_training_pipeline()
    Nothing else in this pipeline changes.

MLFLOW SETUP:
  Tracking URI is read from the MLFLOW_TRACKING_URI environment variable.
  If unset, defaults to a local 'mlruns/' directory (no server required for dev).
  For Docker: set MLFLOW_TRACKING_URI=http://mlflow:5000

TRAINING TIME ESTIMATE:
  Full 5.8M row training set with tree_method='hist': ~10–20 min on CPU.
  For a quick plumbing check, use sample_frac (see smoke test at bottom).
"""

import logging
import os
from abc import ABC, abstractmethod
from typing import Any

import mlflow
import mlflow.xgboost
import numpy as np
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

logger = logging.getLogger("model_pipeline.trainer")
logger.setLevel(logging.INFO)

MLFLOW_EXPERIMENT = "BlueForecast-Demand"

DEFAULT_PARAMS: dict[str, Any] = {
    "n_estimators": 300,
    "max_depth": 6,
    "learning_rate": 0.05,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "random_state": 42,
    "n_jobs": -1,
    "objective": "reg:squarederror",
    "eval_metric": "rmse",
    "tree_method": "hist",       # memory-efficient for large datasets
    "early_stopping_rounds": 20, # stop if val RMSE doesn't improve for 20 rounds
}


# ---------------------------------------------------------------------------
# Interface contract (stable) — XGBoost implements this, but is replaceable
# ---------------------------------------------------------------------------

class BaseForecaster(ABC):
    """
    Stable interface contract for all BlueForecast model implementations.

    The pipeline interacts with this class only. The underlying model
    (XGBoost, LightGBM, neural net, etc.) is an implementation detail.
    """

    @abstractmethod
    def train(
        self,
        X_train: np.ndarray,
        y_train: np.ndarray,
        X_val:   np.ndarray,
        y_val:   np.ndarray,
        params:  dict[str, Any],
    ) -> "BaseForecaster":
        """Fit the model. Must return self."""
        ...

    @abstractmethod
    def predict(self, X: np.ndarray) -> np.ndarray:
        """Return predictions as a 1-D float array."""
        ...

    @property
    @abstractmethod
    def model_type(self) -> str:
        """Human-readable model identifier, e.g. 'XGBoostRegressor'."""
        ...

    @property
    @abstractmethod
    def feature_importances(self) -> dict[str, float]:
        """Feature name → importance score mapping."""
        ...

    @property
    @abstractmethod
    def best_iteration(self) -> int:
        """Number of trees/rounds actually used (after early stopping)."""
        ...


# ---------------------------------------------------------------------------
# XGBoost implementation
# ---------------------------------------------------------------------------

class XGBoostForecaster(BaseForecaster):
    """
    XGBoost regressor wrapped behind the BaseForecaster interface.
    This is the placeholder baseline model.
    """

    def __init__(self) -> None:
        self._model: xgb.XGBRegressor | None = None
        self._feature_names: list[str] = []

    def train(
        self,
        X_train: np.ndarray,
        y_train: np.ndarray,
        X_val:   np.ndarray,
        y_val:   np.ndarray,
        params:  dict[str, Any],
    ) -> "XGBoostForecaster":
        # In XGBoost >=2.0 early_stopping_rounds moved to the constructor.
        early_stopping_rounds = params.get("early_stopping_rounds", 20)
        fit_params = {k: v for k, v in params.items()
                      if k != "early_stopping_rounds"}

        self._model = xgb.XGBRegressor(
            **fit_params,
            early_stopping_rounds=early_stopping_rounds,
        )
        self._model.fit(
            X_train, y_train,
            eval_set=[(X_val, y_val)],
            verbose=50,  # print every 50 rounds
        )
        return self

    def predict(self, X: np.ndarray) -> np.ndarray:
        if self._model is None:
            raise RuntimeError("Model has not been trained yet. Call train() first.")
        return self._model.predict(X)

    @property
    def model_type(self) -> str:
        return "XGBoostRegressor"

    @property
    def feature_importances(self) -> dict[str, float]:
        if self._model is None:
            return {}
        scores = self._model.feature_importances_
        return dict(zip(self._feature_names, scores.tolist()))

    @property
    def best_iteration(self) -> int:
        if self._model is None:
            return 0
        return int(self._model.best_iteration)

    def set_feature_names(self, names: list[str]) -> None:
        """Store feature names for importance reporting."""
        self._feature_names = names


# ---------------------------------------------------------------------------
# Training pipeline (Tasks C + D: train + model selection)
# ---------------------------------------------------------------------------

def _setup_mlflow() -> None:
    """Configure MLflow tracking URI and experiment."""
    tracking_uri = os.getenv("MLFLOW_TRACKING_URI", "mlruns")
    mlflow.set_tracking_uri(tracking_uri)
    mlflow.set_experiment(MLFLOW_EXPERIMENT)
    logger.info("MLflow tracking URI: %s | Experiment: %s", tracking_uri, MLFLOW_EXPERIMENT)


def _compute_metrics(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    prefix: str,
) -> dict[str, float]:
    """
    Compute RMSE, MAE, MAPE, R² for a prediction set.

    MAPE is computed only on rows where y_true > 0 to avoid division by zero.
    (Zero-demand hours are legitimate but make MAPE undefined.)
    """
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    mae  = float(mean_absolute_error(y_true, y_pred))
    r2   = float(r2_score(y_true, y_pred))

    nonzero_mask = y_true > 0
    if nonzero_mask.sum() > 0:
        mape = float(
            np.mean(np.abs((y_true[nonzero_mask] - y_pred[nonzero_mask])
                           / y_true[nonzero_mask])) * 100
        )
    else:
        mape = float("nan")

    return {
        f"{prefix}_rmse": rmse,
        f"{prefix}_mae":  mae,
        f"{prefix}_mape": mape,
        f"{prefix}_r2":   r2,
    }


def _get_current_best_val_rmse() -> float | None:
    """
    Query MLflow for the best approved run's val_rmse in this experiment.
    Returns None if no approved run exists yet.
    """
    client = mlflow.tracking.MlflowClient()
    try:
        experiment = client.get_experiment_by_name(MLFLOW_EXPERIMENT)
        if experiment is None:
            return None
        runs = client.search_runs(
            experiment_ids=[experiment.experiment_id],
            filter_string="tags.status = 'approved'",
            order_by=["metrics.val_rmse ASC"],
            max_results=1,
        )
        if runs:
            return runs[0].data.metrics.get("val_rmse")
    except Exception as exc:
        logger.warning("Could not query MLflow for best run: %s", exc)
    return None


def run_training_pipeline(
    X_train,
    y_train,
    X_val,
    y_val,
    feature_cols:         list[str],
    dataset_version_hash: str,
    params:               dict[str, Any] | None = None,
    forecaster_class:     type[BaseForecaster]  = XGBoostForecaster,
) -> tuple[BaseForecaster, str]:
    """
    Full training pipeline: train → evaluate → log to MLflow → select best model.

    Parameters
    ----------
    X_train, y_train : training features and target (pandas DataFrame/Series)
    X_val, y_val     : validation features and target (pandas DataFrame/Series)
    feature_cols     : ordered list of feature column names (for importance logging)
    dataset_version_hash : MD5 hash from data_loader — logged as a run tag
    params           : hyperparameters (defaults to DEFAULT_PARAMS if None)
    forecaster_class : which BaseForecaster subclass to instantiate

    Returns
    -------
    forecaster : fitted BaseForecaster instance
    run_id     : MLflow run ID for this training run
    """
    if params is None:
        params = DEFAULT_PARAMS

    _setup_mlflow()

    forecaster = forecaster_class()
    if hasattr(forecaster, "set_feature_names"):
        forecaster.set_feature_names(feature_cols)

    X_train_arr = X_train.values if hasattr(X_train, "values") else X_train
    y_train_arr = y_train.values if hasattr(y_train, "values") else y_train
    X_val_arr   = X_val.values   if hasattr(X_val, "values")   else X_val
    y_val_arr   = y_val.values   if hasattr(y_val, "values")   else y_val

    with mlflow.start_run() as run:
        run_id = run.info.run_id
        logger.info("MLflow run started: %s", run_id)

        # --- Tags ---
        mlflow.set_tags({
            "model_type":            forecaster.model_type,
            "dataset_version_hash":  dataset_version_hash,
            "feature_count":         str(len(feature_cols)),
            "train_rows":            str(len(X_train_arr)),
            "val_rows":              str(len(X_val_arr)),
            "status":                "pending",  # updated after selection
        })

        # --- Log hyperparameters ---
        mlflow.log_params({k: v for k, v in params.items()
                           if k != "early_stopping_rounds"})
        mlflow.log_param("early_stopping_rounds",
                         params.get("early_stopping_rounds", 20))

        # --- Train ---
        logger.info("Training %s on %s rows...", forecaster.model_type,
                    f"{len(X_train_arr):,}")
        forecaster.train(X_train_arr, y_train_arr, X_val_arr, y_val_arr, params)
        logger.info("Training complete. Best iteration: %d", forecaster.best_iteration)
        mlflow.log_metric("best_iteration", forecaster.best_iteration)

        # --- Evaluate on train + val ---
        train_metrics = _compute_metrics(
            y_train_arr, forecaster.predict(X_train_arr), prefix="train"
        )
        val_metrics = _compute_metrics(
            y_val_arr, forecaster.predict(X_val_arr), prefix="val"
        )
        all_metrics = {**train_metrics, **val_metrics}
        mlflow.log_metrics(all_metrics)

        for name, value in all_metrics.items():
            logger.info("  %s: %.4f", name, value)

        # --- Log model artifact ---
        if hasattr(forecaster, "_model") and forecaster._model is not None:
            mlflow.xgboost.log_model(forecaster._model, artifact_path="model")
            logger.info("Model artifact logged to MLflow.")

        # --- Task D: model selection ---
        current_best = _get_current_best_val_rmse()
        new_val_rmse = val_metrics["val_rmse"]

        if current_best is None:
            # First valid run — promote automatically
            status         = "approved"
            selection_note = "First valid run — promoted automatically."
        elif new_val_rmse < current_best:
            status         = "approved"
            selection_note = (
                f"New run RMSE {new_val_rmse:.4f} < current best {current_best:.4f}. "
                "Promoted."
            )
        else:
            status         = "rejected"
            selection_note = (
                f"New run RMSE {new_val_rmse:.4f} ≥ current best {current_best:.4f}. "
                "Rejected — current champion retained."
            )

        mlflow.set_tags({"status": status, "selection_note": selection_note})
        logger.info("Model selection → %s | %s", status.upper(), selection_note)

    return forecaster, run_id
