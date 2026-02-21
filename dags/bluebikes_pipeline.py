"""
BlueForecast Data Pipeline DAG
Orchestrates the full data pipeline from raw ingestion to feature engineering,
schema validation, and bias detection.

Alert mechanism: logging-based failure callbacks on every task.
Pipeline optimization: parallel enrichment tasks (stations, weather, holidays).
"""

import logging
from datetime import datetime, timedelta
from airflow import DAG
from airflow.operators.python import PythonOperator

from src.pipeline_tasks import (
    download_raw_data,
    clean_data,
    process_station_metadata,
    process_weather_data,
    process_holiday_calendar,
    aggregate_demand,
    run_feature_engineering,
    validate_schema,
    detect_bias,
)

alert_logger = logging.getLogger("bluebikes_pipeline.alerts")
alert_logger.setLevel(logging.WARNING)


# ── Alert callback ──────────────────────────────────────────────────────────

def task_failure_alert(context):
    """
    Logging-based alert triggered on any task failure.
    Logs task details, exception, and execution context for debugging.
    Can be extended to send Slack/email notifications.
    """
    task = context.get("task_instance")
    dag_id = context.get("dag").dag_id
    task_id = task.task_id
    execution_date = context.get("execution_date")
    exception = context.get("exception")
    try_number = task.try_number
    log_url = task.log_url

    alert_logger.critical(
        "=" * 60 + "\n"
        "🚨 PIPELINE ALERT: Task Failed\n"
        "=" * 60 + "\n"
        "  DAG:            %s\n"
        "  Task:           %s\n"
        "  Execution Date: %s\n"
        "  Try Number:     %s\n"
        "  Exception:      %s\n"
        "  Log URL:        %s\n"
        "=" * 60,
        dag_id, task_id, execution_date, try_number, exception, log_url
    )


def task_success_alert(context):
    """Log successful task completion for monitoring."""
    task = context.get("task_instance")
    duration = task.duration
    alert_logger.info(
        "✅ Task '%s' completed successfully in %.1f seconds",
        task.task_id, duration or 0
    )


# ── DAG definition ──────────────────────────────────────────────────────────

default_args = {
    "owner": "blueforecast",
    "retries": 1,
    "retry_delay": timedelta(minutes=5),
    "on_failure_callback": task_failure_alert,
    "on_success_callback": task_success_alert,
}

with DAG(
    dag_id="bluebikes_data_pipeline",
    default_args=default_args,
    description="End-to-end data pipeline for Bluebikes demand prediction",
    start_date=datetime(2025, 1, 1),
    schedule=None,
    catchup=False,
    tags=["bluebikes", "data-pipeline", "mlops"],
) as dag:

    # Stage 1: Download raw data
    t_download = PythonOperator(
        task_id="download_raw_data",
        python_callable=download_raw_data,
    )

    # Stage 2: Clean raw data
    t_clean = PythonOperator(
        task_id="clean_data",
        python_callable=clean_data,
    )

    # Stage 3: Parallel enrichment tasks (optimized — run concurrently)
    t_stations = PythonOperator(
        task_id="process_station_metadata",
        python_callable=process_station_metadata,
    )

    t_weather = PythonOperator(
        task_id="process_weather_data",
        python_callable=process_weather_data,
    )

    t_holidays = PythonOperator(
        task_id="process_holiday_calendar",
        python_callable=process_holiday_calendar,
    )

    # Stage 4: Aggregate demand
    t_aggregate = PythonOperator(
        task_id="aggregate_demand",
        python_callable=aggregate_demand,
    )

    # Stage 5: Feature engineering
    t_features = PythonOperator(
        task_id="run_feature_engineering",
        python_callable=run_feature_engineering,
    )

    # Stage 6: Schema validation (anomaly detection — fails pipeline on bad data)
    t_validate = PythonOperator(
        task_id="validate_schema",
        python_callable=validate_schema,
    )

    # Stage 7: Bias detection
    t_bias = PythonOperator(
        task_id="detect_bias",
        python_callable=detect_bias,
    )

    # ── Task dependencies ───────────────────────────────────────────────────
    # download → clean → [stations, weather, holidays] → aggregate → features → validate → bias
    #
    # Optimization: stations, weather, holidays run in PARALLEL after clean_data
    # (identified via Airflow Gantt chart — these have no mutual dependencies)
    t_download >> t_clean
    t_clean >> [t_stations, t_weather, t_holidays]
    [t_stations, t_weather, t_holidays] >> t_aggregate
    t_aggregate >> t_features
    t_features >> t_validate
    t_validate >> t_bias