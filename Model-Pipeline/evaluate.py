"""
BlueForecast test-set evaluation runner.
Loads the approved MLflow run, evaluates on held-out test set, enforces thresholds.
"""

import sys, os, logging
logging.basicConfig(level=logging.INFO, format="%(name)s - %(message)s")
sys.path.insert(0, "src")

import mlflow
import mlflow.xgboost

from model_pipeline.data_loader import load_feature_matrix, get_X_y, FEATURE_COLS
from model_pipeline.splitter    import temporal_split
from model_pipeline.trainer     import XGBoostForecaster, _setup_mlflow
from model_pipeline.evaluator   import evaluate_on_test, VALIDATION_THRESHOLDS

# 1. Load data (LabelEncoder handled inside data_loader)
df, version_hash, _le = load_feature_matrix()

_, _, test_df = temporal_split(df)
X_test, y_test = get_X_y(test_df)

# 2. Fetch the approved run from MLflow
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

# 3. Reload model from MLflow and wrap in our interface
xgb_model = mlflow.xgboost.load_model(f"runs:/{run_id}/model")
forecaster = XGBoostForecaster()
forecaster._model = xgb_model
forecaster.set_feature_names(FEATURE_COLS)

# 4. Run the validation gate
summary = evaluate_on_test(
    forecaster=forecaster,
    X_test=X_test,
    y_test=y_test,
    run_id=run_id,
    dataset_version_hash=version_hash,
)

print("\n=== Validation Gate Result ===")
print(f"Status    : {summary['validation_status']}")
print(f"Test RMSE : {summary['metrics']['test_rmse']:.4f}  (limit <= {VALIDATION_THRESHOLDS['max_test_rmse']})")
print(f"Test R2   : {summary['metrics']['test_r2']:.4f}  (limit >= {VALIDATION_THRESHOLDS['min_test_r2']})")
print(f"Test MAE  : {summary['metrics']['test_mae']:.4f}  (limit <= {VALIDATION_THRESHOLDS['max_test_mae']})")
print(f"Test MAPE : {summary['metrics']['test_mape']:.1f}%  (informational)")