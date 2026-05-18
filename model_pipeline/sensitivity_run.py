"""
BlueForecast sensitivity analysis runner.

Pass 1: SKIP_SWEEP=True  -> SHAP + feature importance only (~3 min)
Pass 2: SKIP_SWEEP=False -> adds hyperparameter sweep (~20 min)
"""

import sys, logging
logging.basicConfig(level=logging.INFO, format="%(name)s - %(message)s")
sys.path.insert(0, "src")

import mlflow, mlflow.xgboost

from model_pipeline.data_loader  import load_feature_matrix, get_X_y, FEATURE_COLS
from model_pipeline.splitter     import temporal_split
from model_pipeline.trainer      import XGBoostForecaster, DEFAULT_PARAMS, _setup_mlflow
from model_pipeline.sensitivity  import run_sensitivity_analysis

# ── Toggle ───────────────────────────────────────────────────────────────────
SKIP_SWEEP = True  # True for fast pass, False for full sweep
# ─────────────────────────────────────────────────────────────────────────────

# 1. Load data (LabelEncoder handled inside data_loader)
df, version_hash, _le = load_feature_matrix()

train_df, val_df, test_df = temporal_split(df)
X_train, y_train = get_X_y(train_df)
X_val,   y_val   = get_X_y(val_df)
X_test,  y_test  = get_X_y(test_df)

# 2. Load approved model
_setup_mlflow()
client     = mlflow.tracking.MlflowClient()
experiment = client.get_experiment_by_name("BlueForecast-Demand")
runs = client.search_runs(
    experiment_ids=[experiment.experiment_id],
    filter_string="tags.status = 'approved'",
    order_by=["metrics.val_rmse ASC"],
    max_results=1,
)
run_id    = runs[0].info.run_id
print(f"Approved run: {run_id}")

xgb_model = mlflow.xgboost.load_model(f"runs:/{run_id}/model")
forecaster = XGBoostForecaster()
forecaster._model = xgb_model
forecaster.set_feature_names(FEATURE_COLS)

# 3. Run sensitivity analysis
report = run_sensitivity_analysis(
    forecaster=forecaster,
    X_train=X_train, y_train=y_train,
    X_val=X_val,     y_val=y_val,
    X_test=X_test,
    feature_cols=FEATURE_COLS,
    run_id=run_id,
    dataset_version_hash=version_hash,
    base_params=DEFAULT_PARAMS,
    skip_hyperparam_sweep=SKIP_SWEEP,
)

# ── Print feature importance ─────────────────────────────────────────────────
fi = report["feature_importance"]

print("\n=== Top 10 by SHAP (mean |SHAP|) ===")
max_shap = max(fi["shap_mean_abs"].values())
for i, (feat, val) in enumerate(list(fi["shap_mean_abs"].items())[:10], 1):
    bar = "#" * int(val / max_shap * 30)
    print(f"  {i:>2}. {feat:<25} {val:.4f}  {bar}")

print("\n=== Top 10 by XGBoost Gain ===")
max_gain = max(fi["xgboost_gain"].values())
for i, (feat, val) in enumerate(list(fi["xgboost_gain"].items())[:10], 1):
    bar = "#" * int(val / max_gain * 30)
    print(f"  {i:>2}. {feat:<25} {val:.4f}  {bar}")

print(f"\nTop-3 gain/SHAP agreement: {fi['gain_shap_agreement']}")
print(f"SHAP top-3: {fi['top_5_by_shap'][:3]}")
print(f"Gain top-3: {fi['top_5_by_gain'][:3]}")
print(f"\nFeature importance -> GCS: {report['artifact_uris']['feature_importance_gcs']}")

# ── Print hyperparam sweep results (Pass 2 only) ─────────────────────────────
if not SKIP_SWEEP:
    ha = report["hyperparam_analysis"]
    print(f"\n=== Hyperparameter Sensitivity ({int(ha['sweep_sample_frac']*100)}% of train data) ===")
    print(f"Most sensitive parameter: {ha['most_sensitive_param']}\n")

    for param, data in ha["parameters"].items():
        best_idx  = data["val_rmse"].index(min(data["val_rmse"]))
        best_val  = data["values"][best_idx]
        best_rmse = min(data["val_rmse"])
        delta     = data["delta_from_base"][best_idx]
        direction = f"better by {abs(delta):.4f}" if delta < 0 else f"worse by {delta:.4f}"
        print(f"  {param:<18}  base={data['base_value']}  best_value={best_val}  "
              f"best_rmse={best_rmse:.4f}  ({direction} vs base)")

        curve = "  " + " -> ".join(
            f"{v}:{r:.3f}" for v, r in zip(data["values"], data["val_rmse"])
        )
        print(curve)
        print()

    print(f"Sensitivity report -> GCS: {report['artifact_uris']['hyperparam_sensitivity_gcs']}")