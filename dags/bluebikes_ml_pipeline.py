"""
bluebikes_ml_pipeline.py
ML training pipeline for Bluebikes demand forecasting.
Validates feature matrix, runs ML feature engineering, trains and evaluates models.

DAG Parameters:
    train_years:   comma-separated years to train on e.g. "2023,2024"
    holdout_months: number of months to hold out for testing e.g. 3
    model_type:    "xgboost", "linear", or "all"
    feature_set:   "base" (use data pipeline output) or "extended" (run ml_feature_engineering)
    run_mode:      "train" or "validate_only"
"""

from datetime import datetime, timedelta
from airflow import DAG
from airflow.providers.google.cloud.operators.dataproc import (
    DataprocCreateClusterOperator,
    DataprocDeleteClusterOperator,
    DataprocSubmitJobOperator,
)
from airflow.utils.trigger_rule import TriggerRule

# ── Constants ────────────────────────────────────────────────────────────────
PROJECT_ID   = "bluebikes-demand-predictor"
REGION       = "us-central1"
BUCKET       = "bluebikes-demand-predictor-data"
JOBS_URI     = f"gs://{BUCKET}/jobs"
CLUSTER_NAME = "bb-ml-{{ ds_nodash }}-{{ ti.try_number }}"
GCP_CONN_ID  = "google_cloud_dataproc"

# ── Cluster config ───────────────────────────────────────────────────────────
CLUSTER_CONFIG = {
    "master_config": {
        "num_instances": 1,
        "machine_type_uri": "e2-standard-2",
        "disk_config": {
            "boot_disk_type": "pd-standard",
            "boot_disk_size_gb": 50,
        },
    },
    "worker_config": {"num_instances": 0},
    "software_config": {"image_version": "2.1-debian11"},
}

# ── Default args ─────────────────────────────────────────────────────────────
default_args = {
    "owner":       "blueforecast-ml",
    "retries":     0,
    "retry_delay": timedelta(minutes=5),
}

# ── DAG ──────────────────────────────────────────────────────────────────────
with DAG(
    dag_id="bluebikes_ml_pipeline",
    default_args=default_args,
    description="ML training pipeline — validate features, engineer ML features, train and evaluate models",
    start_date=datetime(2025, 1, 1),
    schedule=None,
    catchup=False,
    tags=["bluebikes", "mlops", "ml", "training"],
    params={
        "train_years":     "2023,2024",
        "holdout_months":  "3",
        "model_type":      "all",
        "feature_set":     "base",
        "run_mode":        "train",
    },
) as dag:

    # ── 1. Create ephemeral cluster ──────────────────────────────────────────
    create_cluster = DataprocCreateClusterOperator(
        task_id="create_cluster",
        project_id=PROJECT_ID,
        region=REGION,
        cluster_name=CLUSTER_NAME,
        cluster_config=CLUSTER_CONFIG,
        gcp_conn_id=GCP_CONN_ID,
    )

    # ── 2. Validate feature matrix ───────────────────────────────────────────
    validate_features = DataprocSubmitJobOperator(
        task_id="validate_features",
        project_id=PROJECT_ID,
        region=REGION,
        gcp_conn_id=GCP_CONN_ID,
        job={
            "placement": {"cluster_name": CLUSTER_NAME},
            "pyspark_job": {
                "main_python_file_uri": f"{JOBS_URI}/validate_feature_matrix.py",
                "args": [
                    "--train_years",    "{{ params.train_years }}",
                    "--bucket",         BUCKET,
                    "--run_id",         "{{ run_id }}",
                ],
            },
        },
    )

    # ── 3. ML feature engineering (optional extended features) ───────────────
    ml_feature_engineering = DataprocSubmitJobOperator(
        task_id="ml_feature_engineering",
        project_id=PROJECT_ID,
        region=REGION,
        gcp_conn_id=GCP_CONN_ID,
        job={
            "placement": {"cluster_name": CLUSTER_NAME},
            "pyspark_job": {
                "main_python_file_uri": f"{JOBS_URI}/ml_feature_engineering.py",
                "args": [
                    "--train_years",  "{{ params.train_years }}",
                    "--feature_set",  "{{ params.feature_set }}",
                    "--bucket",       BUCKET,
                    "--run_id",       "{{ run_id }}",
                ],
            },
        },
    )

    # ── 4. Model training ────────────────────────────────────────────────────
    model_training = DataprocSubmitJobOperator(
        task_id="model_training",
        project_id=PROJECT_ID,
        region=REGION,
        gcp_conn_id=GCP_CONN_ID,
        job={
            "placement": {"cluster_name": CLUSTER_NAME},
            "pyspark_job": {
                "main_python_file_uri": f"{JOBS_URI}/model_training.py",
                "args": [
                    "--train_years",    "{{ params.train_years }}",
                    "--holdout_months", "{{ params.holdout_months }}",
                    "--model_type",     "{{ params.model_type }}",
                    "--feature_set",    "{{ params.feature_set }}",
                    "--run_mode",       "{{ params.run_mode }}",
                    "--bucket",         BUCKET,
                    "--run_id",         "{{ run_id }}",
                ],
            },
        },
    )

    # ── 5. Model evaluation ──────────────────────────────────────────────────
    model_evaluation = DataprocSubmitJobOperator(
        task_id="model_evaluation",
        project_id=PROJECT_ID,
        region=REGION,
        gcp_conn_id=GCP_CONN_ID,
        job={
            "placement": {"cluster_name": CLUSTER_NAME},
            "pyspark_job": {
                "main_python_file_uri": f"{JOBS_URI}/model_evaluation.py",
                "args": [
                    "--bucket",  BUCKET,
                    "--run_id",  "{{ run_id }}",
                ],
            },
        },
    )

    # ── 6. Delete cluster (always runs) ─────────────────────────────────────
    delete_cluster = DataprocDeleteClusterOperator(
        task_id="delete_cluster",
        project_id=PROJECT_ID,
        region=REGION,
        cluster_name=CLUSTER_NAME,
        gcp_conn_id=GCP_CONN_ID,
        trigger_rule=TriggerRule.ALL_DONE,
    )

    # ── Dependencies ─────────────────────────────────────────────────────────
    create_cluster >> validate_features >> ml_feature_engineering
    ml_feature_engineering >> model_training >> model_evaluation >> delete_cluster