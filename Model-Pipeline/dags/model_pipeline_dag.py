"""
Airflow DAG: model_pipeline

Orchestrates the BlueForecast model development pipeline.
Runs manually (schedule_interval=None) or on-demand after the data pipeline completes.

TASK FLOW:
  validate_data_input → train_and_evaluate → detect_bias_and_sensitivity → register_and_predict

Each task is a stateless PythonOperator that reads from / writes to GCS and MLflow.
XCom carries only small metadata (run_id, val_rmse, bias_status, etc.).

MANUAL TRIGGER CONFIG:
  {
    "skip_hyperparam_sweep": false,   ← run OAT hyperparam sweep (~+20 min)
    "run_bayesian_search":   false    ← run Optuna Bayesian search (~+30 min)
  }
"""

import logging
from datetime import datetime, timedelta

from airflow import DAG
from airflow.operators.python import PythonOperator

import sys
sys.path.insert(0, "/opt/airflow/src")

from model_tasks import (
    task_validate_data_input,
    task_train_and_evaluate,
    task_detect_bias_and_sensitivity,
    task_register_and_predict,
)

logger = logging.getLogger("model_pipeline.dag")


def _send_failure_alert(context: dict) -> None:
    """
    Task failure callback. Logs to console always.
    If SLACK_WEBHOOK_URL env var is set, also POSTs a structured message to Slack.
    Zero breaking change when webhook is not configured.
    """
    import os
    dag_id  = context.get("dag").dag_id
    task_id = context.get("task_instance").task_id
    exec_dt = str(context.get("execution_date"))
    exc     = str(context.get("exception", "unknown"))

    logger.error(
        "DAG FAILURE | dag_id=%s | task_id=%s | execution_date=%s | exception=%s",
        dag_id, task_id, exec_dt, exc,
    )

    webhook_url = os.getenv("SLACK_WEBHOOK_URL", "")
    if webhook_url:
        try:
            import urllib.request
            import json as _json
            payload = _json.dumps({
                "text": (
                    f":red_circle: *BlueForecast pipeline failure*\n"
                    f"• DAG: `{dag_id}`\n"
                    f"• Task: `{task_id}`\n"
                    f"• Time: {exec_dt}\n"
                    f"• Error: `{exc[:300]}`"
                )
            }).encode()
            req = urllib.request.Request(
                webhook_url,
                data=payload,
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=5)
            logger.info("Slack alert sent.")
        except Exception as slack_exc:
            logger.warning("Slack alert failed (non-fatal): %s", slack_exc)


default_args = {
    "owner":              "bluebikes-ml",
    "retries":            1,
    "retry_delay":        timedelta(minutes=5),
    "on_failure_callback": _send_failure_alert,
}

with DAG(
    dag_id="model_pipeline",
    default_args=default_args,
    description="BlueForecast XGBoost training, validation, bias detection, and registry push",
    schedule_interval=None,           # manual trigger only
    start_date=datetime(2024, 1, 1),
    catchup=False,
    tags=["model", "bluebikes", "xgboost"],
    params={
        "skip_hyperparam_sweep": True,    # set False to run full OAT sweep (~+20 min)
        "run_bayesian_search":   False,   # set True to run Optuna Bayesian search (~+30 min)
    },
) as dag:

    t1_validate = PythonOperator(
        task_id="validate_data_input",
        python_callable=task_validate_data_input,
    )

    t2_train = PythonOperator(
        task_id="train_and_evaluate",
        python_callable=task_train_and_evaluate,
        execution_timeout=timedelta(hours=1),   # training + eval: ~25 min
    )

    t3_bias = PythonOperator(
        task_id="detect_bias_and_sensitivity",
        python_callable=task_detect_bias_and_sensitivity,
        execution_timeout=timedelta(hours=1),   # bias + optional sweep: ~25 min
    )

    t4_register = PythonOperator(
        task_id="register_and_predict",
        python_callable=task_register_and_predict,
        execution_timeout=timedelta(minutes=30),
    )

    t1_validate >> t2_train >> t3_bias >> t4_register
