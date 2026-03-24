"""
BlueForecast model bias detection runner.
Evaluates RMSE disparity across 6 slice dimensions on the held-out test set.
"""

import sys, logging
logging.basicConfig(level=logging.INFO, format="%(name)s - %(message)s")
sys.path.insert(0, "src")

import mlflow, mlflow.xgboost

from model_pipeline.data_loader    import load_feature_matrix, get_X_y, FEATURE_COLS
from model_pipeline.splitter       import temporal_split
from model_pipeline.trainer        import XGBoostForecaster, _setup_mlflow
from model_pipeline.bias_detection import detect_model_bias, BIAS_THRESHOLDS

# 1. Load data (LabelEncoder handled inside data_loader)
df, version_hash, _le = load_feature_matrix()

_, _, test_df = temporal_split(df)
X_test, y_test = get_X_y(test_df)

# 2. Load approved model
_setup_mlflow()
client = mlflow.tracking.MlflowClient()
experiment = client.get_experiment_by_name("BlueForecast-Demand")
runs = client.search_runs(
    experiment_ids=[experiment.experiment_id],
    filter_string="tags.status = 'approved'",
    order_by=["metrics.val_rmse ASC"],
    max_results=1,
)
run_id = runs[0].info.run_id
print(f"Approved run: {run_id}")

xgb_model = mlflow.xgboost.load_model(f"runs:/{run_id}/model")
forecaster = XGBoostForecaster()
forecaster._model = xgb_model
forecaster.set_feature_names(FEATURE_COLS)

# 3. Run bias detection
report = detect_model_bias(
    forecaster=forecaster,
    X_test=X_test,
    y_test=y_test,
    run_id=run_id,
    dataset_version_hash=version_hash,
)

print(f"\n=== Bias Detection Result: {report['bias_status']} ===")
print(f"Global test RMSE: {report['global_test_rmse']:.4f}")
print(f"\n{'Dimension':<22} {'Ratio':>8}  {'Threshold':>10}  {'Status'}")
print("-" * 58)
for dim, data in report["dimensions"].items():
    ratio_str = f"{data['disparity_ratio']:.2f}x" if data["disparity_ratio"] else "N/A"
    print(f"{dim:<22} {ratio_str:>8}  {data['threshold']:>9.1f}x  {data['status']}")

print(f"\nViolations: {report['violations'] or 'none'}")