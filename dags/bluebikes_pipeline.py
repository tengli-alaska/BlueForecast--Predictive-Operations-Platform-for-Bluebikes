"""
Bluebikes Demand Predictor — Phase 1 MLOps Pipeline
Ephemeral single-node Dataproc cluster, strict linear deps, budget-safe.
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
ZONE         = "us-central1-a"
BUCKET       = "bluebikes-demand-predictor-data"
JOBS_URI     = f"gs://{BUCKET}/jobs"
CLUSTER_NAME = "bb-{{ ds_nodash }}-{{ ti.try_number }}"
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
    "owner": "blueforecast",
    "retries": 0,
    "retry_delay": timedelta(minutes=5),
}

# ── DAG ──────────────────────────────────────────────────────────────────────
with DAG(
    dag_id="bluebikes_pipeline",
    default_args=default_args,
    description="Phase 1 — Ephemeral Dataproc MLOps Pipeline",
    start_date=datetime(2025, 1, 1),
    schedule=None,
    catchup=False,
    tags=["bluebikes", "mlops", "dataproc", "phase1"],
    params={
        "year":         "2023",
        "mode":         "demo",
        "start_yyyymm": "202304",
        "end_yyyymm":   "202304",
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

    # ── 2. Raw ingestion ─────────────────────────────────────────────────────
    raw_ingestion = DataprocSubmitJobOperator(
        task_id="raw_ingestion",
        project_id=PROJECT_ID,
        region=REGION,
        gcp_conn_id=GCP_CONN_ID,
        job={
            "placement": {"cluster_name": CLUSTER_NAME},
            "pyspark_job": {
                "main_python_file_uri": f"{JOBS_URI}/raw_ingestion.py",
                "args": [
                    "--year", "{{ params.year }}",
                ],
            },
        },
    )

    # ── 3. Validate raw schema ───────────────────────────────────────────────
    validate_raw_schema = DataprocSubmitJobOperator(
        task_id="validate_raw_schema",
        project_id=PROJECT_ID,
        region=REGION,
        gcp_conn_id=GCP_CONN_ID,
        job={
            "placement": {"cluster_name": CLUSTER_NAME},
            "pyspark_job": {
                "main_python_file_uri": f"{JOBS_URI}/validate_raw_schema.py",
                "args": [
                    "--bucket", BUCKET,
                    "--run_date", "{{ ds }}",
                ],
            },
        },
    )

    # ── 4. Cleaning ──────────────────────────────────────────────────────────
    cleaning_job = DataprocSubmitJobOperator(
        task_id="cleaning_job",
        project_id=PROJECT_ID,
        region=REGION,
        gcp_conn_id=GCP_CONN_ID,
        job={
            "placement": {"cluster_name": CLUSTER_NAME},
            "pyspark_job": {
                "main_python_file_uri": f"{JOBS_URI}/production_cleaning_pipeline.py",
                "args": [
                    "--mode",         "{{ params.mode }}",
                    "--start_yyyymm", "{{ params.start_yyyymm }}",
                    "--end_yyyymm",   "{{ params.end_yyyymm }}",
                    "--bucket",       BUCKET,
                    "--run_id",       "{{ run_id }}",
                ],
            },
        },
    )

    # ── 5. Ingest stations ───────────────────────────────────────────────────
    ingest_stations = DataprocSubmitJobOperator(
        task_id="ingest_stations",
        project_id=PROJECT_ID,
        region=REGION,
        gcp_conn_id=GCP_CONN_ID,
        job={
            "placement": {"cluster_name": CLUSTER_NAME},
            "pyspark_job": {
                "main_python_file_uri": f"{JOBS_URI}/ingest_stations.py",
                "args": ["--bucket", BUCKET],
            },
        },
    )

    # ── 6. Ingest weather ────────────────────────────────────────────────────
    ingest_weather = DataprocSubmitJobOperator(
        task_id="ingest_weather",
        project_id=PROJECT_ID,
        region=REGION,
        gcp_conn_id=GCP_CONN_ID,
        job={
            "placement": {"cluster_name": CLUSTER_NAME},
            "pyspark_job": {
                "main_python_file_uri": f"{JOBS_URI}/ingest_weather.py",
                "args": ["--bucket", BUCKET],
            },
        },
    )

    # ── 7. Ingest holidays ───────────────────────────────────────────────────
    ingest_holidays = DataprocSubmitJobOperator(
        task_id="ingest_holidays",
        project_id=PROJECT_ID,
        region=REGION,
        gcp_conn_id=GCP_CONN_ID,
        job={
            "placement": {"cluster_name": CLUSTER_NAME},
            "pyspark_job": {
                "main_python_file_uri": f"{JOBS_URI}/ingest_holidays.py",
                "args": ["--bucket", BUCKET],
            },
        },
    )

    # ── 8. Delete cluster (always runs, even on failure) ─────────────────────
    delete_cluster = DataprocDeleteClusterOperator(
        task_id="delete_cluster",
        project_id=PROJECT_ID,
        region=REGION,
        cluster_name=CLUSTER_NAME,
        gcp_conn_id=GCP_CONN_ID,
        trigger_rule=TriggerRule.ALL_DONE,
    )

    # ── 9. Demand aggregation ────────────────────────────────────────────────
    demand_aggregation = DataprocSubmitJobOperator(
        task_id="demand_aggregation",
        project_id=PROJECT_ID,
        region=REGION,
        gcp_conn_id=GCP_CONN_ID,
        job={
            "placement": {"cluster_name": CLUSTER_NAME},
            "pyspark_job": {
                "main_python_file_uri": f"{JOBS_URI}/production_demand_aggregation.py",
                "args": [
                    "--start_yyyymm", "{{ params.start_yyyymm }}",
                    "--end_yyyymm",   "{{ params.end_yyyymm }}",
                    "--bucket",       BUCKET,
                    "--run_id",       "{{ run_id }}",
                ],
            },
        },
    )

    # ── 10. Feature engineering ──────────────────────────────────────────────
    feature_engineering = DataprocSubmitJobOperator(
        task_id="feature_engineering",
        project_id=PROJECT_ID,
        region=REGION,
        gcp_conn_id=GCP_CONN_ID,
        job={
            "placement": {"cluster_name": CLUSTER_NAME},
            "pyspark_job": {
                "main_python_file_uri": f"{JOBS_URI}/production_feature_engineering.py",
                "args": [
                    "--year",   "{{ params.year }}",
                    "--bucket", BUCKET,
                    "--run_id", "{{ run_id }}",
                ],
            },
        },
    )

    # ── Dependencies ─────────────────────────────────────────────────────────
    create_cluster >> raw_ingestion >> validate_raw_schema >> cleaning_job
    cleaning_job >> [ingest_stations, ingest_weather, ingest_holidays]
    [ingest_stations, ingest_weather, ingest_holidays] >> demand_aggregation
    demand_aggregation >> feature_engineering >> delete_cluster