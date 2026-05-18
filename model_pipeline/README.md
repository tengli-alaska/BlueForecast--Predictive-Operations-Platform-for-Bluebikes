# BlueForecast : Model Pipeline

Hourly bike-share demand forecasting for 534 Bluebikes stations across Boston. This pipeline trains, validates, and serves an XGBoost model that predicts `demand_count` one hour ahead per station. It sits directly downstream of the Data Pipeline and feeds the ops dashboard via GCS.

---

## Overview

```
Data Pipeline  ──►  feature_matrix.parquet (GCS)
                            │
                            ▼
              ┌─────────────────────────────┐
              │      Model Pipeline         │
              │    (Airflow + MLflow)       │
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
model_pipeline/
│
├── dags/
│   └── model_pipeline_dag.py        # Airflow DAG — 4 PythonOperators + Slack failure callback
│
├── src/
│   ├── __init__.py
│   ├── model_tasks.py               # Airflow-callable wrappers (stateless, GCS I/O)
│   └── model_pipeline/
│       ├── data_loader.py           # Load feature_matrix.parquet, schema validation, MD5 hash, LabelEncoder
│       ├── splitter.py              # Temporal train/val/test split (no shuffle — leakage-safe)
│       ├── trainer.py               # BaseForecaster ABC + XGBoostForecaster + Optuna integration
│       ├── hyperparam_tuner.py      # Optuna TPE Bayesian hyperparameter optimization (standalone module)
│       ├── evaluator.py             # Hold-out test-set gate (RMSE / R² / MAE thresholds)
│       ├── bias_detection.py        # 6-slice RMSE disparity analysis + mitigation weights
│       ├── sensitivity.py           # SHAP TreeExplainer + OAT sweep + Bayesian optimization (Optuna)
│       ├── visualizations.py        # 8 plot types: 5 GCS plots + 3 MLflow charts
│       ├── drift_detector.py        # KL divergence feature/target drift + MAE performance drift
│       ├── registry.py              # MLflow Model Registry push + rollback gate
│       └── predictor.py             # Recursive 24h rolling forecast per station
│
├── tests/
│   └── test_model_pipeline.py       # 29 unit tests — no GCS/MLflow credentials needed
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
├── docs/model_pipeline_overview.pdf # Pipeline architecture diagram
└── requirements.txt
```

**Developer runner scripts** (`train.py`, `evaluate.py`, etc.) are standalone scripts for running individual pipeline stages locally without Docker. They are not part of the Airflow DAG — they exist for fast iteration and debugging.

---

## How to Run

### 1. Start the stack

```bash
cd model_pipeline
docker compose up --build -d
```

Wait ~8 minutes for pip install + `airflow-init` to complete. Then verify all services are healthy:

```bash
docker compose ps
```

| UI | URL | Credentials |
|----|-----|-------------|
| Airflow | http://localhost:8082 | airflow / airflow |
| MLflow  | http://localhost:5000 | — |

> **Note:** First startup takes ~8 min due to pip installing dependencies inside the Airflow containers. Subsequent restarts are faster if containers are not recreated.

### 2. Trigger the DAG

In the Airflow UI at `localhost:8082`:
- Find the `model_pipeline` DAG and **unpause** it
- Click **Trigger DAG** with JSON config:

```json
{
  "skip_hyperparam_sweep": true,
  "run_bayesian_search": false
}
```

**DAG config options:**

| Key | Default | Description |
|-----|---------|-------------|
| `skip_hyperparam_sweep` | `true` | Skip OAT sensitivity sweep (~20 min saved) |
| `run_bayesian_search` | `false` | Run Optuna Bayesian HPO (~30 min extra) |

**Timing estimates:**
- Fast run (`skip_hyperparam_sweep=true`, `run_bayesian_search=false`): ~25 min
- Full OAT sweep: ~45 min
- Full Optuna + OAT: ~75 min

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

### 5. Run tests

```bash
python -m pytest tests/test_model_pipeline.py -v
# Expected: 29 passed
```

---

## Pipeline Outputs

| Path | Content |
|------|---------|
| `processed/models/{run_id}/validation_summary.json` | Test-set gate results (RMSE / R² / MAE vs thresholds) |
| `processed/models/{run_id}/bias_report.json` | Per-slice RMSE + disparity ratios across all 6 dimensions |
| `processed/models/{run_id}/feature_importance.json` | XGBoost gain scores + SHAP mean \|SHAP\| per feature |
| `processed/models/{run_id}/hyperparam_sensitivity.json` | OAT sweep results per parameter |
| `processed/models/{run_id}/bayesian_search.json` | Optuna TPE results (if `run_bayesian_search=true`) |
| `processed/models/{run_id}/drift_report.json` | Feature / target / performance drift scores |
| `processed/models/{run_id}/plots/*.png` | 5 result visualizations (see [Visualizations](#result-visualizations)) |
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
| `train_and_evaluate` | [Optional Optuna HPO →] Temporal split → XGBoost training → val RMSE model selection → test-set gate (blocks if thresholds fail) | `run_id` (str), `val_rmse` (float) | 1 hour |
| `detect_bias_and_sensitivity` | RMSE disparity check (6 slices) → blocks if >3.0× → SHAP + feature importance → optional OAT sweep → optional Bayesian search → drift detection → **result visualizations** (5 GCS plots + 3 MLflow charts) | `bias_status` (str) | 1 hour |
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

### Hyperparameter Tuning

Three complementary approaches are implemented:

**1. One-at-a-time (OAT) sensitivity sweep** (`sensitivity.py` → `run_hyperparam_sensitivity()`)

Varies one parameter while holding others at base values. Run on a 20% training subsample. Provides clear single-parameter sensitivity curves.

| Parameter | Values tested | Best | Verdict |
|-----------|--------------|------|---------|
| `n_estimators` | 100, 200, 300, 500, 700 | 700 (still declining) | Raise to 1000 next run |
| `max_depth` | 3, 4, 6, 8, 10 | 8 (plateau at 8–10) | Raise to 8 next run |
| `learning_rate` | 0.01, 0.03, 0.05, 0.1, 0.2 | 0.05 | Already optimal |

**2. Bayesian optimization via sensitivity module** (`sensitivity.py` → `run_bayesian_optimization()`)

Joint search across 5 parameters using Optuna TPE sampler (50 trials). Explores interaction effects that OAT misses. Enabled via DAG config `run_bayesian_search: true`.

| Parameter | Search space | Scale |
|-----------|-------------|-------|
| `n_estimators` | 200 – 1500 | Linear |
| `max_depth` | 4 – 10 | Linear |
| `learning_rate` | 0.01 – 0.20 | Log |
| `subsample` | 0.60 – 1.0 | Linear |
| `colsample_bytree` | 0.60 – 1.0 | Linear |

**3. Standalone Optuna module** (`hyperparam_tuner.py` → `run_optuna_search()`)

Extended 8-parameter joint search (adds `min_child_weight`, `reg_alpha`, `reg_lambda`). Called from `trainer.py` when `run_optuna=true` is set. Best params are merged into the final full-data training run.

| Additional params | Search space | Scale |
|-------------------|-------------|-------|
| `min_child_weight` | 1 – 10 | Linear |
| `reg_alpha` | 0.001 – 10.0 | Log |
| `reg_lambda` | 0.001 – 10.0 | Log |

**Design decisions:**
- **TPE sampler** over random/grid search — converges faster with small trial budgets (30–50 trials)
- **20% subsample** for all HPO methods — balances speed vs representativeness
- Both approaches are optional and off by default for fast standard runs
- Results saved to GCS as JSON and tagged to MLflow runs

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

**Level 1 — Better XGBoost (days):** `n_estimators=1000`, `max_depth=8`, full Optuna run (50+ trials), station cluster embeddings. Expected RMSE: ~1.0–1.1.

**Level 2 — Richer features (weeks):** Events calendar (marathons, concerts), nearby station demand as spatial features, longer rolling windows (2-week, monthly), public transit disruption flags. Expected RMSE: ~0.80–0.95.

**Level 3 — Architecture change (months):** Temporal Fusion Transformer (explicit multi-horizon, known-future covariates), DeepAR (probabilistic output — "70% chance demand > 10" is more useful than a point estimate), or XGBoost + LSTM residual hybrid. The `BaseForecaster` ABC is already in place for a drop-in swap.

---

## Result Visualizations

The pipeline generates **8 plots** during the `detect_bias_and_sensitivity` task — 5 saved to GCS and 3 logged directly as MLflow chart artifacts.

### GCS Plots (saved to `processed/models/{run_id}/plots/`)

| Plot | File | What it shows |
|------|------|--------------|
| Feature importance | `feature_importance.png` | Side-by-side SHAP mean\|value\| vs XGBoost gain (top 15 features) |
| Predicted vs actual | `predicted_vs_actual.png` | Scatter plot with perfect-prediction line, RMSE/R² annotation (50k-sample) |
| Residual distribution | `residual_distribution.png` | Histogram of (actual − predicted) with mean/std/median annotations |
| Bias disparity | `bias_disparity.png` | Bar chart of RMSE disparity ratios across all 6 slice dimensions, red threshold line at 3.0× |
| SHAP summary | `shap_summary.png` | Beeswarm plot showing feature impact direction and magnitude (5k-sample) |

### MLflow Charts (logged to Artifacts → `charts/`)

| Chart | File | What it shows |
|-------|------|--------------|
| Feature importance | `feature_importance.png` | Top-15 features by SHAP mean \|SHAP\| with value labels |
| Version comparison | `version_comparison.png` | Grouped bar (val RMSE + test RMSE) across last 10 approved runs — current run highlighted in red |
| Sensitivity curves | `sensitivity_curves.png` | One subplot per hyperparameter from OAT sweep: val RMSE vs param value, base value marked with red dashed line, best value with green dot |

Chart failures are non-fatal — a chart error never crashes the pipeline. View charts in the MLflow UI under **Artifacts → charts/** for any run.

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

> ⚠️ **Watch item:** `station_capacity` at **2.96×** — 1.3% below the gate. Low-dock stations (≤10 docks) are meaningfully harder to predict. The data pipeline showed a 10.21× raw demand disparity; the model narrows this to 2.96× RMSE disparity.

### Bias Mitigation

Mitigation weights (`compute_mitigation_weights()` in `bias_detection.py`) are implemented and wired into the training pipeline via the `sample_weight` parameter in `trainer.py`. When activated, the model upweights underrepresented slices during training to reduce RMSE disparity. The weights are ready to activate automatically if station capacity disparity crosses 3.0× on the next run.

The `sample_weight` support flows through the entire stack: `BaseForecaster.train()` → `XGBoostForecaster.train()` → `run_training_pipeline()` → Airflow task wrapper. MLflow logs whether bias mitigation was applied via the `bias_mitigation_applied` tag.

Minimum group size to qualify for disparity computation: **1,000 samples**. Groups below this are excluded from the ratio to avoid statistical noise. Bias report is written to `processed/models/{run_id}/bias_report.json` and logged to the MLflow run as tags.

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
mlflow tag: drift_report_gcs = gs://...
mlflow tag: feature_drift_detected = True | False
mlflow tag: performance_drift_detected = True | False
mlflow tag: target_drift_detected = True | False
```

When the deployment pipeline goes live, upgrade `ALERT` status to block promotion — the gate is already in place, just informational today.

---

## Tests

29 unit tests covering the logic layer of every module. No GCS or MLflow credentials required — all external calls are mocked.

```bash
cd model_pipeline
python -m pytest tests/test_model_pipeline.py -v
# Expected: 29 passed
```

| Module | Count | What they check |
|--------|-------|----------------|
| **Schema validation** | 3 | 29-column contract, RuntimeError on missing columns / nulls |
| **Temporal split** | 3 | Row count conservation, no temporal leakage, disjoint sets |
| **Slice labelling** | 3 | Correct categorical assignment for bias slicing |
| **Disparity ratio** | 2 | Exact ratio math, min-sample exclusion |
| **Evaluation gates** | 2 | Pass/fail logic for RMSE/R²/MAE thresholds |
| **MAPE zero-mask** | 1 | MAPE computed only on y_true > 0 |
| **Rollback gate** | 2 | 10% regression ceiling enforced |
| **Prediction safety** | 1 | np.maximum clips negatives to 0 |
| **Optuna HPO** | 3 | Correct keys returned, search space bounds, subsample works |
| **Visualizations** | 3 | GCS URI returned, graceful empty-data handling |
| **Drift detection** | 6 | KL divergence math, MAE threshold, feature-level detection, false-positive avoidance |

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

### Failure Alerts

On any task failure, the Airflow DAG fires `on_failure_callback` which:
1. Writes the crash JSON to GCS (see above)
2. **Posts to Slack** if `SLACK_WEBHOOK_URL` is set in the environment

If the env var is not set, the alert silently falls back to log-only — the pipeline is never blocked by a missing webhook.

### GCS Lifecycle Rule

Crash logs auto-delete after 30 days. Apply once:

```bash
gsutil lifecycle set lifecycle.json gs://bluebikes-demand-predictor-data
```

---

## CI/CD

### CI/CD Jobs

The GitHub Actions workflow (`.github/workflows/model_pipeline.yml`) defines 4 jobs:

| Job | When it runs | What it does |
|-----|-------------|-------------|
| **Lint + Unit Tests** | Every push/PR touching `model_pipeline/**` | `ruff check` + `pytest` (29 tests) |
| **Docker Build Verification** | Push to `main` only | `docker compose build --no-cache` |
| **Model Training + Validation + Bias Detection** | Manual trigger (`workflow_dispatch`) with `run_training: true` | Trains on 5% sample → evaluates → bias check → sensitivity (SHAP) |
| **Pipeline Notifications** | After every test run | Slack alert on failure, GitHub Issue fallback |

### Pipeline Triggers

| Trigger | Jobs that run |
|---------|--------------|
| Push to any branch touching `model_pipeline/**` | `test` |
| PR into `main` | `test` — **blocks merge if red** |
| Push to `main` | `test` + `docker-build` |
| `data_pipeline/.../feature_engineering.py` changes | `test` — schema contract check |
| `workflow_dispatch` with `run_training: false` | `test` only |
| `workflow_dispatch` with `run_training: true` | `test` → `train` (full pipeline in CI) |

### CI/CD Model Training

The `train` job runs the complete model pipeline in CI when manually triggered:

```
workflow_dispatch (run_training: true)
    └── test (lint + 29 unit tests)
            └── train
                 ├── Train model (5% sample for CI speed)
                 ├── Evaluate on test set (RMSE/R²/MAE gates)
                 ├── Bias detection (6 slice dimensions)
                 └── Sensitivity analysis (SHAP + feature importance)
```

**How to trigger:** Go to GitHub → Actions → "Model Pipeline CI" → **Run workflow** → set `Run model training` to `true`.

**Requirements:** `GCP_SA_KEY_JSON` must be configured as a GitHub repository secret for GCS data access. Without this secret, the training job will fail at GCP authentication — lint/test jobs still run independently.

**Design decision:** Training is gated behind `workflow_dispatch` (not triggered on every push) because it requires GCP credentials and loads 8.2M rows from GCS. Full production training (100% data, 300+ trees) runs via the Airflow DAG on infrastructure with sufficient memory. The CI training job uses a 5% sample to verify the pipeline end-to-end.

### Notifications and Alerts

**Slack notifications** (requires `SLACK_WEBHOOK_URL` secret):
- CI failure on any branch: posts run details + link to logs
- CI success on `main`: confirms CI passed

**GitHub Issue fallback** (always active, no setup required):
- On any CI failure, a GitHub Issue is auto-created with `ci-failure` and `model_pipeline` labels

**Setup secrets (one-time):**
1. `SLACK_WEBHOOK_URL` — Slack incoming webhook URL
2. `GCP_SA_KEY_JSON` — GCP service account key JSON (required for CI training only)

---

## Key Design Decisions

- **4 coarse-grained DAG tasks, not 8 micro-tasks** — loading 8.2M rows from GCS repeatedly is expensive. Logically related steps are grouped: validate / train+eval / bias+sensitivity+visualizations+drift / register+predict.

- **XCom carries primitives only** — `run_id` (str), `val_rmse` (float), `bias_status` (str), `registry_version` (int). Never DataFrames. Each task re-loads from GCS or MLflow independently (stateless Airflow workers).

- **Temporal split, never random** — shuffling an 8.2M-row time-series dataset would leak future lag features into training. Boundaries are hard date cuts: train `< 2024-07-01`, val `Jul–Sep 2024`, test `Oct–Dec 2024`.

- **`BaseForecaster` ABC** — XGBoost is an implementation detail. Swapping to LightGBM or TFT means one new class; evaluator, bias detection, registry, and predictor code are unchanged.

- **Three HPO approaches** — OAT sweep for interpretable single-parameter analysis, Bayesian search (in sensitivity.py) for 5-param joint optimization, standalone Optuna module (hyperparam_tuner.py) for extended 8-param search. All optional, all off by default.

- **Crash-only logging** — success runs produce zero persistent log artifacts. Only failures write to GCS. GCS lifecycle rule cleans up after 30 days.

- **`current.json` for live tracking** — single GCS file overwritten on every task transition. Dashboard polls one endpoint, no Airflow API needed.

- **Rollback gate at 10%** — new model must not regress val RMSE by >10% vs champion. Lead can override with `force_promote=True`.

- **Station capacity is the priority bias slice** — data pipeline showed 10.21× raw demand disparity. Model narrows to 2.96×. Mitigation weights implemented, ready to activate if >3.0×.

- **`sample_weight` wired end-to-end** — bias mitigation weights flow from `compute_mitigation_weights()` through `BaseForecaster.train()` to XGBoost's `.fit()`. MLflow tags track whether weights were applied.

- **LabelEncoder persisted to GCS** — `sklearn.LabelEncoder` saved as pickle to GCS for consistent encoding between training and prediction.

- **Drift detection is informational** — KL divergence + MAE gates fully implemented and tagged to MLflow. Status is `STABLE | ALERT` but never blocks promotion until live traffic exists.

- **Visualizations are non-fatal** — chart generation wrapped in try/except. A rendering error never crashes the pipeline.

- **Slack alerts degrade gracefully** — `SLACK_WEBHOOK_URL` checked at runtime. If unset, failure handler writes to GCS only.

- **MAPE excluded from gates** — too noisy on zero-demand hours (0÷0). Logged to MLflow as informational only.

- **Docker build only on `main`** — gated to post-merge only, not every PR push.

- **Port 8082 for Airflow** — avoids clash with Data Pipeline at 8081.

- **MLflow backend: SQLite + GCS artifact root** — simple, self-contained, no extra managed services.

---

## Docker Services

| Service | Image | Port | Role |
|---------|-------|------|------|
| `postgres` | postgres:15 | — | Airflow metadata DB |
| `airflow-webserver` | apache/airflow:2.9.3 | 8082 | Airflow UI |
| `airflow-scheduler` | apache/airflow:2.9.3 | — | DAG scheduling |
| `airflow-init` | apache/airflow:2.9.3 | — | DB init (runs once) |
| `mlflow` | python:3.11-slim (Dockerfile.mlflow) | 5000 | Experiment tracking + model registry |