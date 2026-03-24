# BlueForecast — Model Pipeline

Hourly bike-share demand forecasting for 534 Bluebikes stations across Boston. This pipeline trains, validates, and serves an XGBoost model that predicts `demand_count` one hour ahead per station. It sits directly downstream of the Data Pipeline and feeds the ops dashboard via GCS.

---

## Overview

```
Data Pipeline  ──►  feature_matrix.parquet (GCS)
                            │
                            ▼
              ┌─────────────────────────────┐
              │      Model Pipeline          │
              │    (Airflow + MLflow)        │
              │                             │
              │  t1: validate_data_input    │
              │  t2: train_and_evaluate     │
              │  t3: detect_bias            │
              │  t4: register_and_predict   │
              └──────────────┬──────────────┘
                             │
               ┌─────────────┼──────────────┐
               ▼             ▼              ▼
          MLflow UI      GCS outputs    current.json
        (localhost:5000) predictions/   (live status)
                         models/
```

The model pipeline runs on demand (manual trigger). It reads the feature matrix written by the Data Pipeline, trains an XGBoost model, runs a chain of quality gates, registers the winner to MLflow Model Registry, and writes 24-hour forecasts for every station to GCS.

---

## Prerequisites

Before running this pipeline:

1. **Data pipeline has run** and `gs://bluebikes-demand-predictor-data/processed/features/feature_matrix.parquet` exists
2. **GCP credentials** available at `~/.config/gcloud/` (mounted read-only into all containers)
3. **Docker + Docker Compose** installed
4. **Environment variable:** `GOOGLE_APPLICATION_CREDENTIALS` pointing to your service account key (or ADC via gcloud)

> ⚠️ **Validation gate** (t2): The model must pass all three test-set thresholds before bias detection or registry push runs. If any gate fails, the DAG stops at t2 and no model is registered. See [Validation Gates](#validation-gates) below.

---

## Project Structure

```
Model-Pipeline/
│
├── dags/
│   └── model_pipeline_dag.py        # Airflow DAG — 4 PythonOperators wired in sequence
│
├── src/
│   ├── __init__.py
│   ├── model_tasks.py               # Airflow-callable wrappers (stateless, GCS I/O)
│   └── model_pipeline/
│       ├── data_loader.py           # Load feature_matrix.parquet, schema validation, MD5 hash
│       ├── splitter.py              # Temporal train/val/test split (no shuffle — leakage-safe)
│       ├── trainer.py               # BaseForecaster ABC + XGBoostForecaster implementation
│       ├── evaluate.py              # Hold-out test-set gate (RMSE / R² / MAE thresholds)
│       ├── bias_detection.py        # 6-slice RMSE disparity analysis + mitigation weights
│       ├── sensitivity.py           # SHAP TreeExplainer + OAT sweep + Bayesian optimization (Optuna)
│       ├── visualizer.py            # MLflow chart artifacts (feature importance, version comparison, sensitivity curves)
│       ├── drift_detector.py        # KL divergence feature/target drift + MAE performance drift detection
│       ├── registry.py              # MLflow Model Registry push + rollback gate
│       └── predictor.py             # Recursive 24h rolling forecast per station
│
├── tests/
│   └── test_model_pipeline.py       # 17 unit tests — no GCS/MLflow credentials needed
│
├── train.py                         # Dev runner: python train.py (QUICK_CHECK=True for 5% sample)
├── evaluate.py                      # Dev runner: load approved run, re-run test gate
├── bias_check.py                    # Dev runner: run bias detection on approved run
├── sensitivity_run.py               # Dev runner: SHAP + hyperparam sweep (SKIP_SWEEP toggle)
├── registry_run.py                  # Dev runner: register model + test rollback gate
├── predictor.py                     # Dev runner: generate 24h forecasts from champion model
│
├── docker-compose.yaml              # 5 services: postgres, airflow ×3, mlflow
├── Dockerfile.mlflow                # python:3.11-slim + mlflow + google-cloud-storage
├── lifecycle.json                   # GCS lifecycle rule: delete crash logs after 30 days
└── requirements.txt
```

**Developer runner scripts** (`train.py`, `evaluate.py`, etc.) are standalone scripts for running individual pipeline stages locally without Docker. They are not part of the Airflow DAG — they exist for fast iteration and debugging.

---

## How to Run

### 1. Start the stack

```bash
cd Model-Pipeline
docker compose up --build -d
```

Wait ~2 minutes for `airflow-init` to complete. Then verify all services are healthy:

```bash
docker compose ps
```

| UI | URL |
|----|-----|
| Airflow | http://localhost:8082 (admin / admin) |
| MLflow  | http://localhost:5000 |

### 2. Trigger the DAG

In the Airflow UI at `localhost:8082`:
- Find the `model_pipeline` DAG
- Click **Trigger DAG** → set `skip_hyperparam_sweep: true` for a fast run (~25 min), or `false` for full sweep (~45 min)

### 3. Watch live status

```bash
gsutil cat gs://bluebikes-demand-predictor-data/processed/pipeline-status/current.json
```

Each task updates this file on start and completion. No Airflow access needed for monitoring.

### 4. Apply GCS lifecycle rule (one-time)

```bash
gsutil lifecycle set lifecycle.json gs://bluebikes-demand-predictor-data
```

This enables auto-deletion of crash logs after 30 days.

---

## Pipeline Outputs

| Path | Content |
|------|---------|
| `processed/models/{run_id}/validation_summary.json` | Test-set gate results (RMSE / R² / MAE vs thresholds) |
| `processed/models/{run_id}/bias_report.json` | Per-slice RMSE + disparity ratios across all 6 dimensions |
| `processed/models/{run_id}/feature_importance.json` | XGBoost gain scores + SHAP mean \|SHAP\| per feature |
| `processed/models/{run_id}/shap_summary.json` | SHAP values (10k-row sample) |
| `processed/models/{run_id}/hyperparam_sensitivity.json` | OAT sweep results + Bayesian optimization best params per parameter |
| `processed/models/{run_id}/drift_report.json` | Feature / target / performance drift scores vs. training distribution |
| `processed/models/approved/metadata.json` | Champion model provenance (run_id, version, hash, commit SHA) |
| `processed/predictions/latest/predictions.parquet` | 24h forecast for all 534 stations (overwritten each run) |
| `processed/predictions/{date}/predictions.parquet` | Dated snapshot |
| `processed/pipeline-status/current.json` | Live pipeline status (overwritten on every task transition) |
| `processed/pipeline-logs/crashes/{dag_run_id}_{task_id}.json` | Crash JSON (written only on failure, auto-deleted after 30 days) |
| `mlflow-artifacts/` | MLflow model artifacts, backed by GCS |

---

## DAG Tasks

```
validate_data_input  →  train_and_evaluate  →  detect_bias_and_sensitivity  →  register_and_predict
```

| Task | What it does | XCom output | Timeout |
|------|-------------|-------------|---------|
| `validate_data_input` | Loads `feature_matrix.parquet`, validates schema (29 required columns, zero nulls), computes MD5 hash for dataset versioning | `dataset_hash` (str) | — |
| `train_and_evaluate` | Temporal split → XGBoost training → val RMSE model selection → test-set gate (blocks if thresholds fail) | `run_id` (str), `val_rmse` (float) | 1 hour |
| `detect_bias_and_sensitivity` | RMSE disparity check across 6 slice dimensions → blocks if any exceeds 3.0× → SHAP + feature importance → optional OAT sweep + Bayesian optimization → drift detection (feature / target / performance) | `bias_status` (str) | 1 hour |
| `register_and_predict` | Rollback gate (blocks if new RMSE > champion × 1.10) → MLflow registry push → champion alias update → 24h recursive forecast | `registry_version` (int), `predictions_gcs` (str) | 30 min |

**XCom carries small primitives only** — never DataFrames. Each task re-loads data from GCS independently (stateless workers).

---

## Model

### Why XGBoost

The target (`demand_count`) is a sparse count variable (most hours: 0–5 rides, peak: up to 135). The feature set is dominated by temporal lags and rolling means — tabular time-series structure that gradient-boosted trees handle naturally without sequence modeling overhead.

The model is wrapped behind a `BaseForecaster` ABC. Swapping to LightGBM or a Temporal Fusion Transformer means implementing one class — the rest of the pipeline (evaluator, bias detection, registry, predictor) is untouched.

### Hyperparameters

| Parameter | Value | Note |
|-----------|-------|------|
| `n_estimators` | 300 | Trained to 299/300 — not plateaued, next run: 1000 |
| `max_depth` | 6 | Sweep shows plateau at 8 — next run: 8 |
| `learning_rate` | 0.05 | Sweep confirmed optimal — no change |
| `subsample` | 0.8 | Standard regularization |
| `colsample_bytree` | 0.8 | Standard regularization |
| `tree_method` | hist | Memory-efficient for 5.8M rows |
| `early_stopping_rounds` | 20 | Stops on val RMSE plateau |
| `objective` | reg:squarederror | Regression target |

### Tuning Done

**Round 1 — One-at-a-time (OAT) sensitivity sweep** on a 20% training subsample:

| Parameter | Values tested | Best | Verdict |
|-----------|--------------|------|---------|
| `n_estimators` | 100, 300, 500, 700 | 700 (still declining) | Raise to 1000 next run |
| `max_depth` | 3, 6, 8, 10 | 8 (plateau at 8–10) | Raise to 8 next run |
| `learning_rate` | 0.01, 0.05, 0.10, 0.20 | 0.05 | Already optimal |

**Round 2 — Bayesian optimization (Optuna TPE, 50 trials)** — available, off by default. Enable at trigger time:

```
run_bayesian_search: true   ← set in DAG trigger conf
```

| Search space | Range |
|---|---|
| `n_estimators` | 200 – 1500 |
| `max_depth` | 4 – 10 |
| `learning_rate` | 0.01 – 0.20 |
| `subsample` | 0.60 – 1.0 |
| `colsample_bytree` | 0.60 – 1.0 |

Runs on the same 20% subsample as the OAT sweep (speed + consistency). Best params and `improvement_delta` are logged to MLflow tags and included in `hyperparam_sensitivity.json`. Joint interaction effects between all 5 parameters are explored in a single run (~15 min extra).

### Model Metrics (Baseline Run)

| Split | RMSE | MAE | R² |
|-------|------|-----|----|
| Val (Jul–Sep 2024) | 1.6131 | — | 0.7052 |
| **Test (Oct–Dec 2024)** | **1.2858** | **0.6507** | **0.7025** |

Test RMSE < Val RMSE because Oct–Dec is lower-demand off-season — fewer extreme peaks, not overfitting. The model explains 70% of demand variance. The remaining 30% is event-driven noise not in the feature set.

**SHAP top-5 features** (all lag/rolling — expected for 1h horizon):
1. `demand_lag_168h` — 0.3190
2. `demand_lag_1h` — 0.2650
3. `rolling_avg_24h`
4. `rolling_avg_6h`
5. `demand_lag_24h`

Weather features rank 10+. The model is learning temporal demand momentum.

### Validation Gates

A model must pass **all three** simultaneously to proceed to bias detection and registry:

| Gate | Threshold | Baseline result | Status |
|------|-----------|----------------|--------|
| Test RMSE | ≤ 2.5 | 1.2858 | ✅ PASSED |
| Test R² | ≥ 0.50 | 0.7025 | ✅ PASSED |
| Test MAE | ≤ 1.5 | 0.6507 | ✅ PASSED |
| MAPE | informational | — | not gated |

> Thresholds are conservative for the baseline. Tighten to RMSE ≤ 1.80 / R² ≥ 0.60 / MAE ≤ 1.00 after the next improved run.

### Future Scope

**Level 1 — Better XGBoost (days):** `n_estimators=1000`, `max_depth=8`, Optuna Bayesian search, station cluster embeddings. Expected RMSE: ~1.0–1.1.

**Level 2 — Richer features (weeks):** Events calendar (marathons, concerts), nearby station demand as spatial features, longer rolling windows (2-week, monthly), public transit disruption flags. Expected RMSE: ~0.80–0.95.

**Level 3 — Architecture change (months):** Temporal Fusion Transformer (explicit multi-horizon, known-future covariates), DeepAR (probabilistic output — "70% chance demand > 10" is more useful than a point estimate), or XGBoost + LSTM residual hybrid. The `BaseForecaster` ABC is already in place for a drop-in swap.

---

## MLflow Visualizations

Three charts are automatically generated and logged as MLflow artifacts under `charts/` at the end of every t3 run. Chart failures are non-fatal — a chart error never crashes the pipeline.

| Chart | Artifact path | What it shows |
|-------|--------------|---------------|
| **Feature Importance** | `charts/feature_importance.png` | Horizontal bar chart of top-15 features by mean \|SHAP\| value |
| **Version Comparison** | `charts/version_comparison.png` | Grouped bar (val RMSE + test RMSE) across the last 10 approved runs — current run highlighted |
| **Sensitivity Curves** | `charts/sensitivity_curves.png` | One subplot per hyperparameter from the OAT sweep: val RMSE vs. param value, base value marked with dashed red line, best value with green dot |

View them in the MLflow UI under **Artifacts → charts/** for any run, or download via:

```bash
mlflow artifacts download --run-id <run_id> --artifact-path charts -d ./charts_out
```

---

## Bias Detection

Model RMSE is evaluated across **6 slice dimensions** on the test set. Any dimension with a max/min RMSE disparity ratio exceeding 3.0× blocks registry promotion.

| Dimension | Groups | Gate | Baseline result |
|-----------|--------|------|----------------|
| `time_of_day` | peak / off_peak / night | ≤ 3.0× | ✅ PASSED |
| `day_type` | weekday / weekend / holiday | ≤ 3.0× | ✅ PASSED |
| `season` | spring / summer / fall / winter | ≤ 3.0× | ✅ PASSED |
| `station_capacity` | low (≤10) / mid (11–20) / high (>20) | ≤ 3.0× | ✅ PASSED (2.96×) ⚠️ |
| `precipitation` | dry / rainy | ≤ 3.0× | ✅ PASSED |
| `temperature` | cold (<10°C) / mild / hot (>25°C) | ≤ 3.0× | ✅ PASSED |

> ⚠️ **Watch item:** `station_capacity` at **2.96×** — 1.3% below the gate. Low-dock stations (≤10 docks) are meaningfully harder to predict. The data pipeline showed a 10.21× raw demand disparity; the model narrows this to 2.96× RMSE disparity. Mitigation weights (`compute_mitigation_weights()`) are implemented and ready to activate if this crosses 3.0× on the next run.

Minimum group size to qualify for disparity computation: **1,000 samples**. Groups below this are excluded from the ratio to avoid statistical noise.

Bias report is written to `processed/models/{run_id}/bias_report.json` and logged to the MLflow run as tags.

---

## Production Monitoring — Drift Detection

Drift detection runs at the end of t3 (after bias + sensitivity) using training distribution as the reference and the test split as the proxy for "current production data". All results are **informational** — drift never blocks pipeline promotion at this stage (no live production traffic yet).

| Check | Method | Threshold | Output |
|-------|--------|-----------|--------|
| **Feature drift** | KL divergence per feature | > 0.10 per feature | `drift_detected: true/false` per feature |
| **Target drift** | KL divergence on `demand_count` | > 0.15 | `kl_divergence`, distribution stats |
| **Performance drift** | MAE % increase (test vs. val) | > 20% | `mae_increase_pct`, `drift_detected` |

Results are written to `processed/models/{run_id}/drift_report.json` and tagged to the MLflow run:

```
mlflow tag: drift_status = STABLE | ALERT
mlflow tag: drift_feature_kl_max = <float>
mlflow tag: drift_target_kl = <float>
mlflow tag: drift_performance_mae_pct = <float>
```

When the deployment pipeline goes live, upgrade `ALERT` status to block promotion — the gate is already in place, just informational today.

---

## Tests

17 unit tests covering the logic layer of every module. No GCS or MLflow credentials required — all external calls are mocked.

```bash
# Run locally
python -m pytest Model-Pipeline/tests/test_model_pipeline.py -v
```

| Test | What it checks |
|------|---------------|
| `test_schema_validation_passes` | `_validate_schema()` accepts correct 29-column DataFrame |
| `test_schema_validation_fails_missing_col` | Raises `RuntimeError` when a required column is missing |
| `test_schema_validation_fails_nulls` | Raises `RuntimeError` when nulls are present |
| `test_temporal_split_sizes` | Train + val + test row count == total, all splits non-empty |
| `test_temporal_split_ordering` | Train max < val min < test min (no temporal leakage) |
| `test_temporal_split_no_overlap` | Timestamp sets are fully disjoint |
| `test_time_of_day_labels` | `[7, 13, 22]` → `['peak', 'off_peak', 'night']` |
| `test_capacity_labels` | `[5, 15, 30]` → `['low', 'mid', 'high']` |
| `test_precipitation_labels` | `[0.0, 2.5]` → `['dry', 'rainy']` |
| `test_disparity_ratio_calculation` | RMSE `[1.0, 2.0, 3.0]` → ratio exactly 3.0 |
| `test_disparity_ratio_skips_small_groups` | Group with < 1,000 samples excluded from ratio |
| `test_threshold_check_passes` | Good metrics → all fields `True` in result dict |
| `test_threshold_check_fails_on_high_rmse` | RMSE 3.0 > limit 2.5 → `rmse_passed=False`, `all_passed=False` |
| `test_metrics_mape_excludes_zero_demand` | MAPE computed only on rows where `y_true > 0` |
| `test_rollback_gate_blocks` | New `val_rmse=2.0` > champion `1.6 × 1.10` → `RegistryPromotionError` |
| `test_rollback_gate_passes` | New `val_rmse=1.5` < ceiling → proceeds without error |
| `test_prediction_no_negatives` | `np.maximum(preds, 0)` clips all negatives to 0 |

---

## Observability

### Live Pipeline Status

Every task writes to a single JSON file in GCS at start and completion:

```
gs://bluebikes-demand-predictor-data/processed/pipeline-status/current.json
```

```json
{
  "dag_run_id": "...",
  "overall_status": "running",
  "tasks": {
    "validate_data_input":         { "status": "success", "dataset_hash": "8067a6..." },
    "train_and_evaluate":          { "status": "running", "val_rmse": null },
    "detect_bias_and_sensitivity": { "status": "pending" },
    "register_and_predict":        { "status": "pending" }
  },
  "metrics": { "val_rmse": null, "bias_status": null, "registry_version": null }
}
```

The ops dashboard polls this one file — no Airflow access needed.

### Crash-Only Logging

**Principle: successful runs leave no persistent logs.**

On any task failure, a structured crash JSON is written to GCS:

```
processed/pipeline-logs/crashes/{dag_run_id}_{task_id}.json
```

Contents: `exception_type`, `exception_message`, `traceback_tail` (last 20 lines), `timestamp`, `run_id`.

Airflow container logs retain only `WARNING+` level, rolling 7-day window (`AIRFLOW__LOGGING__LOGGING_LEVEL: WARNING`, `AIRFLOW__LOG_RETENTION_DAYS: 7`).

### Failure Alerts

On any task failure, Airflow fires `on_failure_callback` which:
1. Writes the crash JSON to GCS (see above)
2. **Posts to Slack** if `SLACK_WEBHOOK_URL` is set in the environment

Slack message format:
```
🚨 BlueForecast DAG FAILURE
DAG: model_pipeline
Task: train_and_evaluate
Time: 2026-03-24T01:04:39Z
Error: too many values to unpack (expected 2)
```

To enable: uncomment `SLACK_WEBHOOK_URL` in `docker-compose.yaml` and set your webhook URL. If the env var is not set, the alert silently falls back to log-only — the pipeline is never blocked by a missing webhook.

### GCS Lifecycle Rule

Crash logs auto-delete after 30 days. Apply once:

```bash
gsutil lifecycle set lifecycle.json gs://bluebikes-demand-predictor-data
```

`lifecycle.json` (included in repo):
```json
{
  "rule": [{
    "action": { "type": "Delete" },
    "condition": { "age": 30, "matchesPrefix": ["processed/pipeline-logs/crashes/"] }
  }]
}
```

---

## CI/CD

| Trigger | Jobs |
|---------|------|
| Push to any branch touching `Model-Pipeline/**` | `test` (lint + 17 unit tests) |
| PR into `main` | `test` — **blocks merge if red** |
| Push to `main` | `test` + `docker-build` (build verification, no push) |
| `Data-Pipeline/.../feature_engineering.py` changes | `test` — schema contract check |
| `workflow_dispatch` | `test` (manual trigger) |

```
ruff check Model-Pipeline/src/ Model-Pipeline/dags/
    ↓
pytest Model-Pipeline/tests/test_model_pipeline.py -v
    ↓
[main only] docker compose build --no-cache
```

Full model retraining is **never auto-triggered in CI** — requires GCP credentials and 8.2M-row GCS access. Training is triggered manually via Airflow or `workflow_dispatch`.

---

## Key Design Decisions

- **4 coarse-grained DAG tasks, not 8 micro-tasks** — loading 8.2M rows from GCS repeatedly is expensive. Logically related steps are grouped: validate / train+eval / bias+sensitivity / register+predict.

- **XCom carries primitives only** — `run_id` (str), `val_rmse` (float), `bias_status` (str), `registry_version` (int). Never DataFrames. Each task re-loads from GCS or MLflow independently (stateless Airflow workers).

- **Temporal split, never random** — shuffling an 8.2M-row time-series dataset would leak future lag features into training. Boundaries are hard date cuts: train `< 2024-07-01`, val `Jul–Sep 2024`, test `Oct–Dec 2024`.

- **`BaseForecaster` ABC** — XGBoost is an implementation detail. Swapping to LightGBM or TFT means one new class; evaluator, bias detection, registry, and predictor code are unchanged.

- **Crash-only logging** — success runs produce zero persistent log artifacts. Only failures write to GCS. Reduces storage costs and noise. GCS lifecycle rule cleans up after 30 days.

- **`current.json` for graphical tracking** — single GCS file overwritten on every task transition. Dashboard polls one endpoint, no Airflow API access needed.

- **Rollback gate at 10%** — a new model must not regress val RMSE by more than 10% vs. the current champion. Lead can override with `force_promote=True`.

- **Station capacity is the priority bias slice** — the data pipeline found a 10.21× raw demand disparity across station sizes. The model narrows this to 2.96× RMSE disparity. Mitigation weights are implemented and will activate automatically if it crosses 3.0×.

- **MAPE excluded from gates** — too noisy on zero-demand hours (0÷0). Logged to MLflow as informational only.

- **Docker build only on `main`** — building the full Airflow image takes ~10 min. Gated to post-merge only, not every PR push.

- **Port 8082 for Airflow** — avoids clash with the Data Pipeline stack at 8081.

- **MLflow backend: SQLite + GCS artifact root** — simple, self-contained, no extra managed services. Artifact root on GCS makes model artifacts durable and accessible to all pipeline workers.

- **Bayesian optimization off by default** — Optuna TPE (50 trials) adds ~15 min to a run. Gated behind `run_bayesian_search: false` in DAG params so standard runs stay fast. Enable at trigger time when actively tuning.

- **Drift detection is informational until live traffic** — the KL divergence + MAE gates are fully implemented and tagged to MLflow. Status is `STABLE | ALERT` but never blocks promotion today. When the deployment pipeline ships, upgrade one flag to make `ALERT` a hard gate.

- **Visualizations are non-fatal** — chart generation (matplotlib → MLflow artifacts) is wrapped in try/except. A missing dependency or rendering error never crashes the pipeline; charts are a convenience, not a gate.

- **Slack alerts degrade gracefully** — `SLACK_WEBHOOK_URL` is checked at runtime. If unset, the failure handler writes to GCS and logs the error without throwing. No webhook misconfiguration can silence the crash JSON.

---

## Docker Services

| Service | Image | Port | Role |
|---------|-------|------|------|
| `postgres` | postgres:15 | — | Airflow metadata DB |
| `airflow-webserver` | apache/airflow:2.9.3 | 8082 | Airflow UI |
| `airflow-scheduler` | apache/airflow:2.9.3 | — | DAG scheduling |
| `airflow-init` | apache/airflow:2.9.3 | — | DB init (runs once) |
| `mlflow` | python:3.11-slim (Dockerfile.mlflow) | 5000 | Experiment tracking + model registry |
