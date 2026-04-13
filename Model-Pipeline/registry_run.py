"""
Part 1: Register baseline model to MLflow registry
Part 2: Test rollback gate fires correctly
"""

import sys, json, logging
logging.basicConfig(level=logging.INFO, format="%(name)s - %(message)s")
sys.path.insert(0, "src")

import mlflow
from google.cloud import storage
from model_pipeline.trainer   import _setup_mlflow
from model_pipeline.registry  import register_model, RegistryPromotionError

_setup_mlflow()
client = mlflow.tracking.MlflowClient()

# ── Load approved run from MLflow ─────────────────────────────────────────────
experiment = client.get_experiment_by_name("BlueForecast-Demand")
runs = client.search_runs(
    experiment_ids=[experiment.experiment_id],
    filter_string="tags.status = 'approved'",
    order_by=["metrics.val_rmse ASC"],
    max_results=1,
)
run_id               = runs[0].info.run_id
val_rmse             = runs[0].data.metrics["val_rmse"]
dataset_version_hash = runs[0].data.tags["dataset_version_hash"]

def load_gcs_json(uri: str) -> dict:
    path = uri.replace("gs://bluebikes-demand-predictor-data/", "")
    blob = storage.Client().bucket("bluebikes-demand-predictor-data").blob(path)
    return json.loads(blob.download_as_text())

validation_summary = load_gcs_json(runs[0].data.tags["validation_summary_gcs"])
bias_report        = load_gcs_json(runs[0].data.tags["bias_report_gcs"])

# ═══════════════════════════════════════════════════════════════════════════════
# PART 1: Register the baseline model
# ═══════════════════════════════════════════════════════════════════════════════
print("\n" + "="*50)
print("PART 1: Register baseline model")
print("="*50)

metadata = register_model(
    run_id=run_id,
    val_rmse=val_rmse,
    dataset_version_hash=dataset_version_hash,
    validation_summary=validation_summary,
    bias_report=bias_report,
)

print(f"\n{'='*50}")
print(f"Registry:  {metadata['registry_name']}")
print(f"Version:   v{metadata['registry_version']}")
print(f"Stage:     {metadata['registry_stage']}")
print(f"Alias:     {metadata['registry_alias']}")
print(f"Val RMSE:  {metadata['val_rmse']}")
print(f"Test RMSE: {metadata['test_rmse']}")
print(f"Bias:      {metadata['bias_status']}")
print(f"Commit:    {metadata['code_commit_sha']}")
print(f"GCS:       gs://bluebikes-demand-predictor-data/processed/models/approved/metadata.json")

# ═══════════════════════════════════════════════════════════════════════════════
# PART 2: Test rollback gate — simulate a bad future model (val_rmse=2.0)
# ═══════════════════════════════════════════════════════════════════════════════
print("\n" + "="*50)
print("PART 2: Test rollback gate")
print("="*50)

try:
    register_model(
        run_id=run_id,
        val_rmse=2.0,                       # deliberately bad (> 1.6131 × 1.10 = 1.7744)
        dataset_version_hash=dataset_version_hash,
        validation_summary=validation_summary,
        bias_report=bias_report,
    )
    print("ERROR: rollback gate did not fire -- something is wrong")
except RegistryPromotionError as e:
    print("Rollback gate fired correctly")
    print(str(e))
    print("\nChampion retained.")
