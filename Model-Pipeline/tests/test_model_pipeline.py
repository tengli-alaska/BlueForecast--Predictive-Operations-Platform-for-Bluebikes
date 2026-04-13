"""
Unit tests for the BlueForecast model pipeline.

All GCS and MLflow calls are mocked — no credentials or network required.
Tests cover the logic layer of each module: schema validation, temporal split,
slice labelling, disparity ratio, rollback gate, evaluation thresholds,
metric computation, prediction output safety, Optuna HPO, visualizations,
and drift detection.

Run: pytest Model-Pipeline/tests/test_model_pipeline.py -v
"""

# Mock google.cloud before any module imports to avoid needing credentials
import sys
from unittest.mock import MagicMock
sys.modules['google.cloud'] = MagicMock()
sys.modules['google.cloud.storage'] = MagicMock()

import json
from datetime import datetime, timezone
from unittest.mock import patch

import numpy as np
import pandas as pd
import pytest

import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def minimal_df():
    """29-column DataFrame that satisfies the training contract."""
    from model_pipeline.data_loader import REQUIRED_COLUMNS
    n = 200
    data = {col: np.zeros(n) for col in REQUIRED_COLUMNS}
    data["hour"] = pd.date_range("2023-04-01", periods=n, freq="h")
    data["demand_count"] = np.random.randint(0, 10, n).astype(float)
    return pd.DataFrame(data)


# ── Task A: Schema validation ──────────────────────────────────────────────────

def test_schema_validation_passes(minimal_df):
    from model_pipeline.data_loader import _validate_schema
    _validate_schema(minimal_df)   # must not raise


def test_schema_validation_fails_missing_col(minimal_df):
    from model_pipeline.data_loader import _validate_schema
    broken = minimal_df.drop(columns=["demand_lag_1h"])
    with pytest.raises(RuntimeError, match="Missing required columns"):
        _validate_schema(broken)


def test_schema_validation_fails_nulls(minimal_df):
    from model_pipeline.data_loader import _validate_schema
    broken = minimal_df.copy()
    broken.loc[0, "demand_lag_1h"] = None
    with pytest.raises(RuntimeError, match="Null values"):
        _validate_schema(broken)


# ── Task B: Temporal split ─────────────────────────────────────────────────────

@pytest.fixture
def time_df():
    """Minimal DataFrame spanning the three split windows."""
    from model_pipeline.data_loader import REQUIRED_COLUMNS
    dates = pd.date_range("2023-04-01", "2024-12-31", freq="h")
    n = len(dates)
    data = {col: np.zeros(n) for col in REQUIRED_COLUMNS}
    data["hour"]         = dates
    data["demand_count"] = np.zeros(n)
    return pd.DataFrame(data)


def test_temporal_split_sizes(time_df):
    from model_pipeline.splitter import temporal_split
    train, val, test = temporal_split(time_df)
    assert len(train) + len(val) + len(test) == len(time_df)
    assert len(train) > 0 and len(val) > 0 and len(test) > 0


def test_temporal_split_ordering(time_df):
    from model_pipeline.splitter import temporal_split
    train, val, test = temporal_split(time_df)
    assert train["hour"].max() < val["hour"].min(), "Train bleeds into val"
    assert val["hour"].max()   < test["hour"].min(), "Val bleeds into test"


def test_temporal_split_no_overlap(time_df):
    from model_pipeline.splitter import temporal_split
    train, val, test = temporal_split(time_df)
    train_hours = set(train["hour"].astype(str))
    val_hours   = set(val["hour"].astype(str))
    test_hours  = set(test["hour"].astype(str))
    assert train_hours.isdisjoint(val_hours)
    assert val_hours.isdisjoint(test_hours)


# ── Task G: Slice labelling ────────────────────────────────────────────────────

def test_time_of_day_labels():
    from model_pipeline.bias_detection import _time_of_day_label
    hours = pd.Series([7, 13, 22])
    result = _time_of_day_label(hours).tolist()
    assert result == ["peak", "off_peak", "night"]


def test_capacity_labels():
    from model_pipeline.bias_detection import _capacity_label
    caps = pd.Series([5, 15, 30])
    result = _capacity_label(caps).tolist()
    assert result == ["low", "mid", "high"]


def test_precipitation_labels():
    from model_pipeline.bias_detection import _precipitation_label
    precip = pd.Series([0.0, 2.5])
    result = _precipitation_label(precip).tolist()
    assert result == ["dry", "rainy"]


def test_disparity_ratio_calculation():
    from model_pipeline.bias_detection import _compute_disparity_ratio
    group_metrics = pd.DataFrame({
        "group": ["a", "b", "c"],
        "rmse":  [1.0, 2.0, 3.0],
        "mae":   [0.5, 1.0, 1.5],
        "count": [2000, 2000, 2000],
    })
    ratio = _compute_disparity_ratio(group_metrics, min_samples=1000)
    assert abs(ratio - 3.0) < 1e-6


def test_disparity_ratio_skips_small_groups():
    from model_pipeline.bias_detection import _compute_disparity_ratio
    group_metrics = pd.DataFrame({
        "group": ["a", "b"],
        "rmse":  [1.0, 5.0],
        "mae":   [0.5, 2.5],
        "count": [5000, 50],      # 'b' is below min_samples
    })
    ratio = _compute_disparity_ratio(group_metrics, min_samples=1000)
    assert ratio is None   # only 1 eligible group → can't compute ratio


# ── Task E: Evaluation thresholds ─────────────────────────────────────────────

def test_threshold_check_passes():
    """RMSE well below ceiling → no exception."""
    from model_pipeline.evaluator import _check_thresholds
    _check_thresholds(
        metrics={"test_rmse": 1.29, "test_r2": 0.70, "test_mae": 0.65},
        thresholds={"max_test_rmse": 2.5, "min_test_r2": 0.5, "max_test_mae": 1.5},
    )


def test_threshold_check_fails_on_high_rmse():
    from model_pipeline.evaluator import _check_thresholds
    result = _check_thresholds(
        metrics={"test_rmse": 3.0, "test_r2": 0.70, "test_mae": 0.65},
        thresholds={"max_test_rmse": 2.5, "min_test_r2": 0.5, "max_test_mae": 1.5},
    )
    assert result["rmse_passed"] is False
    assert result["all_passed"] is False


# ── Task C: MAPE zero-mask ────────────────────────────────────────────────────

def test_metrics_mape_excludes_zero_demand():
    from model_pipeline.trainer import _compute_metrics
    y_true = np.array([0.0, 0.0, 4.0])   # first two are zero-demand hours
    y_pred = np.array([1.0, 1.0, 5.0])   # wild errors on zero rows
    metrics = _compute_metrics(y_true, y_pred, prefix="test")
    # MAPE should only use the row where y_true=4 → |4-5|/4 = 25%
    assert abs(metrics["test_mape"] - 25.0) < 1.0


# ── Task L: Rollback gate ─────────────────────────────────────────────────────

@patch("model_pipeline.registry.MlflowClient")
@patch("model_pipeline.registry.storage.Client")
def test_rollback_gate_blocks(mock_gcs, mock_mlflow):
    """val_rmse=2.0 > champion 1.6 × 1.10 = 1.76 → RegistryPromotionError."""
    from model_pipeline.registry import register_model, RegistryPromotionError

    client_inst = MagicMock()
    mock_mlflow.return_value = client_inst

    champion_mock = MagicMock()
    champion_mock.version = "1"
    champion_mock.run_id  = "abc123"
    client_inst.get_model_version_by_alias.return_value = champion_mock

    run_mock = MagicMock()
    run_mock.data.metrics = {"val_rmse": 1.6}
    client_inst.get_run.return_value = run_mock

    with pytest.raises(RegistryPromotionError):
        register_model(
            run_id="test-run",
            val_rmse=2.0,
            dataset_version_hash="abc",
            validation_summary={"metrics": {"test_rmse": 2.0, "test_r2": 0.5},"validation_status": "PASSED"},
            bias_report={"bias_status": "PASSED", "violations": [], "dimensions": {}},
        )


@patch("model_pipeline.registry.mlflow.register_model")
@patch("model_pipeline.registry.MlflowClient")
@patch("model_pipeline.registry.storage.Client")
def test_rollback_gate_passes(mock_gcs, mock_mlflow, mock_register):
    """val_rmse=1.5 < champion 1.6 × 1.10 = 1.76 → proceeds without error."""
    from model_pipeline.registry import register_model

    client_inst = MagicMock()
    mock_mlflow.return_value = client_inst

    champion_mock = MagicMock()
    champion_mock.version = "1"
    champion_mock.run_id  = "abc123"
    client_inst.get_model_version_by_alias.return_value = champion_mock

    run_mock = MagicMock()
    run_mock.data.metrics = {"val_rmse": 1.6}
    client_inst.get_run.return_value = run_mock

    version_mock = MagicMock()
    version_mock.version = "2"
    mock_register.return_value = version_mock

    mock_gcs.return_value.bucket.return_value.blob.return_value.upload_from_string = MagicMock()

    register_model(
        run_id="test-run",
        val_rmse=1.5,
        dataset_version_hash="abc",
        validation_summary={"metrics": {"test_rmse": 1.5, "test_r2": 0.72}, "validation_status": "PASSED"},
        bias_report={"bias_status": "PASSED", "violations": [], "dimensions": {}},
    )   # must not raise


# ── Task M: Prediction safety ─────────────────────────────────────────────────

def test_prediction_no_negatives():
    """XGBoost can output negatives; confirm np.maximum clips them."""
    raw_preds = np.array([-0.5, 0.0, 1.3, -0.1, 2.7])
    clipped   = np.maximum(raw_preds, 0.0)
    assert (clipped >= 0).all()
    assert clipped[0] == 0.0
    assert clipped[2] == 1.3


# ══════════════════════════════════════════════════════════════════════════════
# NEW TESTS — Optuna HPO, Visualizations, Drift Detection
# ══════════════════════════════════════════════════════════════════════════════


# ── Optuna Hyperparameter Tuner ───────────────────────────────────────────────

class TestHyperparamTuner:

    def test_optuna_returns_valid_params(self):
        """Optuna search returns dict with all expected tuned + fixed keys."""
        from model_pipeline.hyperparam_tuner import run_optuna_search

        rng = np.random.default_rng(42)
        n = 500
        X = pd.DataFrame(rng.standard_normal((n, 5)), columns=[f"f{i}" for i in range(5)])
        y = pd.Series(rng.standard_normal(n))

        best = run_optuna_search(X, y, X, y, n_trials=3, sample_frac=1.0)

        expected_tuned = {"n_estimators", "max_depth", "learning_rate",
                          "subsample", "colsample_bytree", "min_child_weight",
                          "reg_alpha", "reg_lambda"}
        assert expected_tuned.issubset(set(best.keys()))
        # Fixed params must also be present
        assert best["objective"] == "reg:squarederror"
        assert best["tree_method"] == "hist"

    def test_optuna_params_in_valid_ranges(self):
        """Returned hyperparams respect search space bounds."""
        from model_pipeline.hyperparam_tuner import run_optuna_search

        rng = np.random.default_rng(42)
        n = 300
        X = pd.DataFrame(rng.standard_normal((n, 3)), columns=["a", "b", "c"])
        y = pd.Series(rng.standard_normal(n))

        best = run_optuna_search(X, y, X, y, n_trials=2, sample_frac=1.0)

        assert 100 <= best["n_estimators"] <= 1000
        assert 3 <= best["max_depth"] <= 10
        assert 0.01 <= best["learning_rate"] <= 0.20
        assert 0.6 <= best["subsample"] <= 1.0
        assert 1 <= best["min_child_weight"] <= 10

    def test_optuna_runs_with_small_subsample(self):
        """Verify Optuna works with a tiny subsample fraction."""
        from model_pipeline.hyperparam_tuner import run_optuna_search

        rng = np.random.default_rng(42)
        X = rng.standard_normal((1000, 3))
        y = rng.standard_normal(1000)

        best = run_optuna_search(X, y, X, y, n_trials=2, sample_frac=0.10)
        assert "n_estimators" in best


# ── Visualizations ────────────────────────────────────────────────────────────

class TestVisualizations:

    def test_predicted_vs_actual_creates_plot(self):
        """plot_predicted_vs_actual returns a GCS URI."""
        from model_pipeline.visualizations import plot_predicted_vs_actual

        y_true = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        y_pred = np.array([1.1, 2.2, 2.8, 4.1, 5.3])

        with patch("model_pipeline.visualizations._save_plot_to_gcs",
                    return_value="gs://mock/pred_vs_actual.png"):
            with patch("model_pipeline.visualizations._log_plot_as_mlflow_artifact"):
                uri = plot_predicted_vs_actual(y_true, y_pred, "test_run_123")
                assert uri == "gs://mock/pred_vs_actual.png"

    def test_residual_distribution_creates_plot(self):
        """plot_residual_distribution returns a GCS URI."""
        from model_pipeline.visualizations import plot_residual_distribution

        y_true = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        y_pred = np.array([1.1, 2.2, 2.8, 4.1, 5.3])

        with patch("model_pipeline.visualizations._save_plot_to_gcs",
                    return_value="gs://mock/residuals.png"):
            with patch("model_pipeline.visualizations._log_plot_as_mlflow_artifact"):
                uri = plot_residual_distribution(y_true, y_pred, "test_run_123")
                assert uri == "gs://mock/residuals.png"

    def test_bias_disparity_handles_empty_report(self):
        """Empty dimensions dict → returns empty string, no crash."""
        from model_pipeline.visualizations import plot_bias_disparity
        uri = plot_bias_disparity({"dimensions": {}}, "test_run_123")
        assert uri == ""


# ── Drift Detection ───────────────────────────────────────────────────────────

class TestDriftDetection:

    def test_kl_divergence_identical_distributions(self):
        """KL divergence of identical distributions should be near zero."""
        from model_pipeline.drift_detector import compute_kl_divergence

        rng = np.random.default_rng(42)
        data = rng.standard_normal(5000)
        kl = compute_kl_divergence(data, data)
        assert kl < 0.01, f"KL divergence of identical data should be ~0, got {kl}"

    def test_kl_divergence_different_distributions(self):
        """KL divergence of shifted distributions should be > 0."""
        from model_pipeline.drift_detector import compute_kl_divergence

        rng = np.random.default_rng(42)
        ref = rng.standard_normal(5000)
        shifted = rng.standard_normal(5000) + 3.0  # shifted mean
        kl = compute_kl_divergence(ref, shifted)
        assert kl > 0.1, f"Shifted distributions should have high KL, got {kl}"

    def test_performance_drift_detects_degradation(self):
        """MAE increase > 20% should trigger drift alert."""
        from model_pipeline.drift_detector import detect_performance_drift

        baseline_errors = np.array([0.5, 0.6, 0.4, 0.5, 0.7])  # mean ~0.54
        current_errors  = np.array([1.0, 1.2, 0.9, 1.1, 1.3])  # mean ~1.10 → +100%
        result = detect_performance_drift(baseline_errors, current_errors, threshold_pct=20.0)
        assert result["drift_detected"] is True

    def test_performance_drift_no_alert_when_stable(self):
        """MAE increase < 20% should not trigger drift alert."""
        from model_pipeline.drift_detector import detect_performance_drift

        baseline_errors = np.array([0.5, 0.6, 0.4, 0.5, 0.7])
        current_errors  = np.array([0.55, 0.62, 0.45, 0.52, 0.72])  # ~5% increase
        result = detect_performance_drift(baseline_errors, current_errors, threshold_pct=20.0)
        assert result["drift_detected"] is False

    def test_feature_drift_detects_shifted_feature(self):
        """A shifted feature column should be flagged as drifted."""
        from model_pipeline.drift_detector import detect_feature_drift

        rng = np.random.default_rng(42)
        ref = pd.DataFrame({"temp": rng.standard_normal(5000), "wind": rng.standard_normal(5000)})
        cur = pd.DataFrame({"temp": rng.standard_normal(5000) + 5.0, "wind": rng.standard_normal(5000)})
        result = detect_feature_drift(ref, cur, threshold=0.1)
        assert result["drift_detected"] is True
        assert "temp" in result["drifted_features"]

    def test_target_drift_stable_distribution(self):
        """Same target distribution → no drift detected."""
        from model_pipeline.drift_detector import detect_target_drift

        rng = np.random.default_rng(42)
        data = rng.standard_normal(5000)
        result = detect_target_drift(data, data, threshold=0.15)
        assert result["drift_detected"] is False