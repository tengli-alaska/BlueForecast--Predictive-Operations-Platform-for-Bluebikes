"""
Airflow-callable wrapper functions for the BlueForecast model pipeline.

OBSERVABILITY:
  _update_pipeline_status() — writes current.json to GCS on every task start/end.
  _write_crash_log()        — writes a structured crash JSON to GCS on failure only.

PRODUCTION LOG STRATEGY:
  Success runs leave no persistent logs beyond current.json (overwritten each run).
  Only failures produce stored crash artifacts (auto-deleted after 30 days via GCS lifecycle).
"""

import json
import logging
import traceback
from datetime import datetime, timezone

import mlflow
import mlflow.xgboost
from google.cloud import storage

logger = logging.getLogger("model_pipeline.tasks")
logger.setLevel(logging.INFO)

BUCKET = "bluebikes-demand-predictor-data"
STATUS_GCS_PATH  = "processed/pipeline-status/current.json"
CRASH_GCS_PREFIX = "processed/pipeline-logs/crashes"

TASK_ORDER = [
    "validate_data_input",
    "train_and_evaluate",
    "detect_bias_and_sensitivity",
    "register_and_predict",
]


# ---------------------------------------------------------------------------
# Observability helpers
# ---------------------------------------------------------------------------

def _update_pipeline_status(
    dag_run_id: str,
    task_name:  str,
    status:     str,          # "running" | "success" | "failed" | "pending"
    run_id:     str | None = None,
    **metrics,
) -> None:
    """
    Read-modify-write the live pipeline status JSON in GCS.
    Called at the start and end of every task wrapper.
    Overwrites the same file — this is a live indicator, not an audit log.

    GCS path: processed/pipeline-status/current.json
    """
    try:
        gcs     = storage.Client()
        blob    = gcs.bucket(BUCKET).blob(STATUS_GCS_PATH)
        now_iso = datetime.now(timezone.utc).isoformat()

        # Load existing status or initialise fresh
        if blob.exists():
            current = json.loads(blob.download_as_text())
        else:
            current = {
                "dag_run_id":     dag_run_id,
                "run_id":         None,
                "overall_status": "running",
                "started_at":     now_iso,
                "updated_at":     now_iso,
                "tasks": {t: {"status": "pending"} for t in TASK_ORDER},
                "metrics": {
                    "val_rmse":         None,
                    "test_rmse":        None,
                    "bias_status":      None,
                    "registry_version": None,
                },
            }

        # Update this task's entry
        task_entry = current["tasks"].setdefault(task_name, {})
        task_entry["status"] = status
        if status == "running":
            task_entry["started_at"] = now_iso
        elif status in ("success", "failed"):
            task_entry["completed_at"] = now_iso
            task_entry.update(metrics)     # attach any extra kv pairs (rmse, hash, etc.)

        # Propagate top-level fields
        if run_id:
            current["run_id"] = run_id
        current["updated_at"] = now_iso
        current["dag_run_id"] = dag_run_id

        # Roll up overall_status
        statuses = [v.get("status") for v in current["tasks"].values()]
        if "failed" in statuses:
            current["overall_status"] = "failed"
        elif all(s == "success" for s in statuses):
            current["overall_status"] = "success"
        else:
            current["overall_status"] = "running"

        # Merge any top-level metrics
        for k in ("val_rmse", "test_rmse", "bias_status", "registry_version"):
            if k in metrics:
                current["metrics"][k] = metrics[k]

        blob.upload_from_string(
            json.dumps(current, indent=2, default=str),
            content_type="application/json",
        )
    except Exception as exc:
        # Status update failure must never crash the pipeline task itself
        logger.warning("_update_pipeline_status failed (non-fatal): %s", exc)


def _write_crash_log(
    task_id:    str,
    dag_run_id: str,
    exception:  Exception,
    context:    dict,
    run_id:     str | None = None,
) -> None:
    """
    Write a structured crash report to GCS. Called only inside except blocks.
    Success runs never trigger this — zero log storage on happy path.

    GCS path: processed/pipeline-logs/crashes/{dag_run_id}_{task_id}.json
    Auto-deleted after 30 days via GCS lifecycle rule (set once via gsutil).
    """
    try:
        tb_lines = traceback.format_exc().splitlines()
        crash_log = {
            "task_id":      task_id,
            "dag_run_id":   dag_run_id,
            "run_id":       run_id,
            "exception_type":    type(exception).__name__,
            "exception_message": str(exception),
            "traceback_tail":    tb_lines[-20:],   # last 20 lines only
            "execution_date":    str(context.get("execution_date")),
            "timestamp":         datetime.now(timezone.utc).isoformat(),
        }
        path = f"{CRASH_GCS_PREFIX}/{dag_run_id}_{task_id}.json"
        storage.Client().bucket(BUCKET).blob(path).upload_from_string(
            json.dumps(crash_log, indent=2, default=str),
            content_type="application/json",
        )
        logger.error("Crash log written → gs://%s/%s", BUCKET, path)
    except Exception as log_exc:
        logger.error("_write_crash_log itself failed: %s", log_exc)


def _dag_run_id(context: dict) -> str:
    return str(context.get("dag_run").run_id if context.get("dag_run") else "local")


# ---------------------------------------------------------------------------
# Task 1 — Validate incoming feature matrix
# ---------------------------------------------------------------------------

def task_validate_data_input(**context) -> dict:
    dag_run_id = _dag_run_id(context)
    _update_pipeline_status(dag_run_id, "validate_data_input", "running")
    try:
        from model_pipeline.data_loader import load_feature_matrix
        from model_pipeline.trainer import _setup_mlflow

        _setup_mlflow()
        df, dataset_hash = load_feature_matrix()

        context["ti"].xcom_push(key="dataset_hash", value=dataset_hash)
        context["ti"].xcom_push(key="dataset_rows",  value=len(df))

        _update_pipeline_status(
            dag_run_id, "validate_data_input", "success",
            dataset_hash=dataset_hash, dataset_rows=len(df),
        )
        logger.info("Data validation passed. Hash: %s | Rows: %s", dataset_hash, f"{len(df):,}")
        return {"status": "ok", "dataset_hash": dataset_hash, "rows": len(df)}

    except Exception as exc:
        _write_crash_log("validate_data_input", dag_run_id, exc, context)
        _update_pipeline_status(dag_run_id, "validate_data_input", "failed")
        logger.error("task_validate_data_input failed: %s", exc)
        raise


# ---------------------------------------------------------------------------
# Task 2 — Train model + hold-out evaluation
# ---------------------------------------------------------------------------

def task_train_and_evaluate(**context) -> dict:
    dag_run_id   = _dag_run_id(context)
    dataset_hash = context["ti"].xcom_pull(task_ids="validate_data_input", key="dataset_hash")
    _update_pipeline_status(dag_run_id, "train_and_evaluate", "running")
    run_id = None
    try:
        from model_pipeline.data_loader  import load_feature_matrix, get_X_y, FEATURE_COLS
        from model_pipeline.splitter     import temporal_split
        from model_pipeline.trainer      import run_training_pipeline, DEFAULT_PARAMS, _setup_mlflow
        from model_pipeline.evaluator    import evaluate_on_test

        _setup_mlflow()
        df, _ = load_feature_matrix()
        train_df, val_df, test_df = temporal_split(df)

        X_train, y_train = get_X_y(train_df)
        X_val,   y_val   = get_X_y(val_df)
        X_test,  y_test  = get_X_y(test_df)

        forecaster, run_id = run_training_pipeline(
            X_train=X_train, y_train=y_train,
            X_val=X_val,     y_val=y_val,
            feature_cols=FEATURE_COLS,
            dataset_version_hash=dataset_hash,
            params=DEFAULT_PARAMS,
        )

        val_summary = evaluate_on_test(
            forecaster=forecaster,
            X_test=X_test,
            y_test=y_test,
            run_id=run_id,
            dataset_version_hash=dataset_hash,
        )

        val_rmse  = val_summary["metrics"]["test_rmse"]
        test_rmse = val_rmse

        context["ti"].xcom_push(key="run_id",   value=run_id)
        context["ti"].xcom_push(key="val_rmse", value=val_rmse)

        _update_pipeline_status(
            dag_run_id, "train_and_evaluate", "success",
            run_id=run_id, val_rmse=val_rmse, test_rmse=test_rmse,
        )
        logger.info("Training complete. run_id=%s | test_rmse=%.4f", run_id[:8], val_rmse)
        return {"run_id": run_id, "test_rmse": val_rmse, "validation_status": "PASSED"}

    except Exception as exc:
        _write_crash_log("train_and_evaluate", dag_run_id, exc, context, run_id=run_id)
        _update_pipeline_status(dag_run_id, "train_and_evaluate", "failed", run_id=run_id)
        logger.error("task_train_and_evaluate failed: %s", exc)
        raise


# ---------------------------------------------------------------------------
# Task 3 — Bias detection + sensitivity analysis
# ---------------------------------------------------------------------------

def task_detect_bias_and_sensitivity(**context) -> dict:
    dag_run_id   = _dag_run_id(context)
    run_id       = context["ti"].xcom_pull(task_ids="train_and_evaluate",  key="run_id")
    logger.info("DEBUG run_id pulled from XCom: %s", run_id)
    dataset_hash = context["ti"].xcom_pull(task_ids="validate_data_input", key="dataset_hash")
    _update_pipeline_status(dag_run_id, "detect_bias_and_sensitivity", "running", run_id=run_id)
    try:
        from model_pipeline.data_loader    import load_feature_matrix, get_X_y, FEATURE_COLS
        from model_pipeline.splitter       import temporal_split
        from model_pipeline.trainer        import XGBoostForecaster, DEFAULT_PARAMS, _setup_mlflow
        from model_pipeline.bias_detection import detect_model_bias
        from model_pipeline.sensitivity    import run_sensitivity_analysis

        dag_conf              = (context.get("dag_run").conf or {}) if context.get("dag_run") else {}
        skip_hyperparam_sweep = dag_conf.get("skip_hyperparam_sweep", True)

        _setup_mlflow()
        import xgboost as xgb
        import tempfile
        import os
        # Look up model UUID from run_id by scanning MLmodel files in GCS
        gcs_client = storage.Client()
        bucket = gcs_client.bucket(BUCKET)
        model_path = None
        for blob in bucket.list_blobs(prefix="mlflow-artifacts/1/models/"):
            if blob.name.endswith("MLmodel"):
                content = blob.download_as_text()
                if f"run_id: {run_id}" in content:
                    model_path = blob.name.replace("MLmodel", "model.ubj")
                    break

        if model_path is None:
            raise RuntimeError(f"Could not find model.ubj for run_id={run_id}")

        logger.info("Loading model from GCS: %s", model_path)
        with tempfile.NamedTemporaryFile(suffix=".ubj", delete=False) as tmp:
            tmp_path = tmp.name
        bucket.blob(model_path).download_to_filename(tmp_path)
        xgb_model = xgb.XGBRegressor()
        xgb_model.load_model(tmp_path)
        os.unlink(tmp_path)
        forecaster = XGBoostForecaster()
        forecaster._model = xgb_model
        forecaster.set_feature_names(FEATURE_COLS)

        df, _ = load_feature_matrix()
        train_df, val_df, test_df = temporal_split(df)
        X_train, y_train = get_X_y(train_df)
        X_val,   y_val   = get_X_y(val_df)
        X_test,  y_test  = get_X_y(test_df)

        bias_report = detect_model_bias(
            forecaster=forecaster,
            X_test=X_test, y_test=y_test,
            run_id=run_id,
            dataset_version_hash=dataset_hash,
        )
        bias_status = bias_report["bias_status"]

        run_sensitivity_analysis(
            forecaster=forecaster,
            X_train=X_train, y_train=y_train,
            X_val=X_val,     y_val=y_val,
            X_test=X_test,
            feature_cols=FEATURE_COLS,
            run_id=run_id,
            dataset_version_hash=dataset_hash,
            base_params=DEFAULT_PARAMS,
            skip_hyperparam_sweep=skip_hyperparam_sweep,
        )

        context["ti"].xcom_push(key="bias_status", value=bias_status)
        _update_pipeline_status(
            dag_run_id, "detect_bias_and_sensitivity", "success",
            run_id=run_id, bias_status=bias_status,
        )
        logger.info("Bias + sensitivity complete. bias_status=%s", bias_status)
        return {"bias_status": bias_status}

    except Exception as exc:
        _write_crash_log("detect_bias_and_sensitivity", dag_run_id, exc, context, run_id=run_id)
        _update_pipeline_status(dag_run_id, "detect_bias_and_sensitivity", "failed", run_id=run_id)
        logger.error("task_detect_bias_and_sensitivity failed: %s", exc)
        raise


# ---------------------------------------------------------------------------
# Task 4 — Registry push + prediction output
# ---------------------------------------------------------------------------

def task_register_and_predict(**context) -> dict:
    dag_run_id   = _dag_run_id(context)
    run_id       = context["ti"].xcom_pull(task_ids="train_and_evaluate",  key="run_id")
    val_rmse     = context["ti"].xcom_pull(task_ids="train_and_evaluate",  key="val_rmse")
    dataset_hash = context["ti"].xcom_pull(task_ids="validate_data_input", key="dataset_hash")
    _update_pipeline_status(dag_run_id, "register_and_predict", "running", run_id=run_id)
    try:
        from model_pipeline.registry  import register_model
        from model_pipeline.predictor import run_prediction_pipeline
        from model_pipeline.trainer   import _setup_mlflow

        _setup_mlflow()
        logger.info("DEBUG: Loading model for run_id = %s", run_id)
        client = mlflow.tracking.MlflowClient()
        run    = client.get_run(run_id)

        def _load_gcs_json(gcs_uri: str) -> dict:
            path = gcs_uri.replace(f"gs://{BUCKET}/", "")
            blob = storage.Client().bucket(BUCKET).blob(path)
            return json.loads(blob.download_as_text())

        validation_summary = _load_gcs_json(run.data.tags["validation_summary_gcs"])
        bias_report        = _load_gcs_json(run.data.tags["bias_report_gcs"])

        registry_meta    = register_model(
            run_id=run_id,
            val_rmse=val_rmse,
            dataset_version_hash=dataset_hash,
            validation_summary=validation_summary,
            bias_report=bias_report,
        )
        registry_version = registry_meta["registry_version"]

        run_prediction_pipeline()
        predictions_gcs = f"gs://{BUCKET}/processed/predictions/latest/predictions.parquet"

        context["ti"].xcom_push(key="registry_version", value=int(registry_version))
        context["ti"].xcom_push(key="predictions_gcs",  value=predictions_gcs)

        _update_pipeline_status(
            dag_run_id, "register_and_predict", "success",
            run_id=run_id,
            registry_version=registry_version,
            predictions_gcs=predictions_gcs,
        )
        logger.info("Pipeline complete. Registry v%s | Predictions → %s",
                    registry_version, predictions_gcs)
        return {"registry_version": registry_version, "predictions_gcs": predictions_gcs}

    except Exception as exc:
        _write_crash_log("register_and_predict", dag_run_id, exc, context, run_id=run_id)
        _update_pipeline_status(dag_run_id, "register_and_predict", "failed", run_id=run_id)
        logger.error("task_register_and_predict failed: %s", exc)
        raise
