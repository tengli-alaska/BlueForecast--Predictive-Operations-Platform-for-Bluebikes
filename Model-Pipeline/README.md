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
│       ├── trainer.py               # BaseForecaster ABC + XGBoostForecaster + Optuna integration
│       ├── hyperparam_tuner.py      # Optuna TPE Bayesian hyperparameter optimization
│       ├── evaluator.py             # Hold-out test-set gate (RMSE / R² / MAE thresholds)
│       ├── bias_detection.py        # 6-slice RMSE disparity analysis + mitigation weights
│       ├── sensitivity.py           # SHAP TreeExplainer + one-at-a-time hyperparam sweep
│       ├── visualizations.py        # Result plots (5 types) → GCS + MLflow artifacts
│       ├── drift_detector.py        # Production drift monitoring (KL divergence, MAE trend)
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
- Click **Trigger DAG** with JSON config:

```json
{
  "skip_hyperparam_sweep": true,
  "run_optuna": false
}
```

**DAG config options:**

| Key | Default | Description |
|-----|---------|-------------|
| `skip_hyperparam_sweep` | `true` | Skip OAT sensitivity sweep (~15 min saved) |
| `run_optuna` | `false` | Run Optuna Bayesian HPO before training (~15–30 min) |
| `optuna_n_trials` | `30` | Number of Optuna trials (only used if `run_optuna=true`) |
| `optuna_sample_frac` | `0.20` | Fraction of training data for Optuna subsample |

**Timing estimates:**
- Fast run (`skip_hyperparam_sweep=true`, `run_optuna=false`): ~25 min
- Full OAT sweep: ~45 min
- Full Optuna + OAT: ~60–75 min

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
| `processed/models/{run_id}/hyperparam_sensitivity.json` | OAT sweep results per parameter |
| `processed/models/{run_id}/optuna_search.json` | Optuna Bayesian HPO results (if `run_optuna=true`) |
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
| `detect_bias_and_sensitivity` | RMSE disparity check across 6 slice dimensions → blocks if any exceeds 3.0× → SHAP + feature importance → optional hyperparam sweep → **result visualizations** (5 plots) | `bias_status` (str) | 1 hour |
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

Two complementary approaches are implemented:

**1. One-at-a-time (OAT) sensitivity sweep** (`sensitivity.py`)

Varies one parameter while holding others at base values. Run on a 20% training subsample.

| Parameter | Values tested | Best | Verdict |
|-----------|--------------|------|---------|
| `n_estimators` | 100, 200, 300, 500, 700 | 700 (still declining) | **Raise to 1000 next run** |
| `max_depth` | 3, 4, 6, 8, 10 | 8 (plateau at 8–10) | **Raise to 8 next run** |
| `learning_rate` | 0.01, 0.03, 0.05, 0.1, 0.2 | 0.05 | Already optimal |

**2. Optuna Bayesian optimization** (`hyperparam_tuner.py`)

Joint search across 8 parameters using TPE (Tree-structured Parzen Estimator). Explores interaction effects that OAT misses (e.g., deeper trees with lower learning rate).

| Parameter | Search space | Scale |
|-----------|-------------|-------|
| `n_estimators` | 100 – 1000 (step 100) | Linear |
| `max_depth` | 3 – 10 | Linear |
| `learning_rate` | 0.01 – 0.20 | Log |
| `subsample` | 0.6 – 1.0 | Linear |
| `colsample_bytree` | 0.6 – 1.0 | Linear |
| `min_child_weight` | 1 – 10 | Linear |
| `reg_alpha` | 0.001 – 10.0 | Log |
| `reg_lambda` | 0.001 – 10.0 | Log |

**Design decisions:**
- **TPE sampler** over random/grid search — converges faster with small trial budgets (20–50 trials), adapts sampling based on previous results.
- **20% subsample** balances speed vs representativeness. Directional improvements transfer to full dataset.
- **Joint search space** addresses the OAT limitation: interaction effects between parameters are now explored.
- Best params are merged into the final full-data training run and logged to MLflow with the tag `hpo_method: optuna_tpe_bayesian`.
- Results saved to `processed/models/{run_id}/optuna_search.json` on GCS.

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

The pipeline generates **5 publication-quality plots** during the `detect_bias_and_sensitivity` task. All plots are saved as PNG to GCS and logged as MLflow artifacts.

| Plot | File | What it shows |
|------|------|--------------|
| Feature importance | `feature_importance.png` | Side-by-side horizontal bar chart: SHAP mean\|value\| vs XGBoost gain (top 15 features) |
| Predicted vs actual | `predicted_vs_actual.png` | Scatter plot with perfect-prediction line, RMSE/R² annotation (50k-sample for readability) |
| Residual distribution | `residual_distribution.png` | Histogram of (actual − predicted) with mean/std/median annotations |
| Bias disparity | `bias_disparity.png` | Bar chart of RMSE disparity ratios across all 6 slice dimensions, red threshold line at 3.0× |
| SHAP summary | `shap_summary.png` | Beeswarm plot showing feature impact direction and magnitude (5k-sample) |

Plots are stored at `processed/models/{run_id}/plots/` on GCS and under `plots/` in the MLflow run artifacts. Plot GCS URIs are also logged as MLflow tags (`plot_feature_importance`, `plot_predicted_vs_actual`, etc.) for quick access from the MLflow UI.

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

Minimum group size to qualify for disparity computation: **1,000 samples**. Groups below this are excluded from the ratio to avoid statistical noise.

Bias report is written to `processed/models/{run_id}/bias_report.json` and logged to the MLflow run as tags. The bias disparity bar chart is generated as part of the [Result Visualizations](#result-visualizations).

---

## Drift Detection

The `drift_detector.py` module provides production model monitoring across three dimensions:

| Drift Type | Method | Threshold | Action |
|-----------|--------|-----------|--------|
| **Feature drift** | KL divergence per feature between training and production distributions | > 0.1 per feature | Alert: lists drifted features |
| **Performance drift** | MAE comparison between validation baseline and production errors | > 20% increase | Alert: recommend retraining |
| **Target drift** | KL divergence between training and production target distributions | > 0.15 | Alert: concept drift detected |

The drift pipeline runs as a standalone function (`run_drift_detection_pipeline()`) that accepts reference data (training set) and current data (production window). It produces a structured report with per-dimension results, an overall drift flag, and a clear recommendation ("RETRAIN MODEL" or "Model is stable").

An Airflow task wrapper (`drift_detection_task()`) is included for integration into the DAG when production data becomes available.

---

## Tests

29 unit tests covering the logic layer of every module. No GCS or MLflow credentials required — all external calls are mocked.

```bash
# Run locally
cd Model-Pipeline
python -m pytest tests/test_model_pipeline.py -v
```

| Module | Tests | What they check |
|--------|-------|----------------|
| **Schema validation** (3) | `test_schema_validation_passes`, `_fails_missing_col`, `_fails_nulls` | 29-column contract, RuntimeError on violations |
| **Temporal split** (3) | `test_temporal_split_sizes`, `_ordering`, `_no_overlap` | Row count conservation, no temporal leakage, disjoint sets |
| **Slice labelling** (3) | `test_time_of_day_labels`, `_capacity_labels`, `_precipitation_labels` | Correct categorical assignment for bias slicing |
| **Disparity ratio** (2) | `test_disparity_ratio_calculation`, `_skips_small_groups` | Exact ratio math, min-sample exclusion |
| **Evaluation gates** (2) | `test_threshold_check_passes`, `_fails_on_high_rmse` | Pass/fail logic for RMSE/R²/MAE thresholds |
| **MAPE zero-mask** (1) | `test_metrics_mape_excludes_zero_demand` | MAPE computed only on y_true > 0 |
| **Rollback gate** (2) | `test_rollback_gate_blocks`, `_passes` | 10% regression ceiling enforced |
| **Prediction safety** (1) | `test_prediction_no_negatives` | np.maximum clips negatives to 0 |
| **Optuna HPO** (3) | `test_optuna_returns_valid_params`, `_params_in_valid_ranges`, `_runs_with_small_subsample` | Correct keys returned, search space bounds respected, subsample works |
| **Visualizations** (3) | `test_predicted_vs_actual_creates_plot`, `_residual_distribution_creates_plot`, `_bias_disparity_handles_empty_report` | GCS URI returned, graceful handling of empty data |
| **Drift detection** (6) | `test_kl_divergence_identical_distributions`, `_different_distributions`, `_performance_drift_detects_degradation`, `_no_alert_when_stable`, `_feature_drift_detects_shifted_feature`, `_target_drift_stable_distribution` | KL math, MAE threshold logic, feature-level detection, false-positive avoidance |

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

### Pipeline Triggers

| Trigger | Jobs |
|---------|------|
| Push to any branch touching `Model-Pipeline/**` | `test` (lint + 29 unit tests) |
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

### Notifications and Alerts

The CI/CD pipeline includes automated notifications for pipeline state changes:

**Slack notifications** (requires `SLACK_WEBHOOK_URL` secret in GitHub repo settings):
- Failure on any branch: posts run details + link to logs
- Success on `main`: confirms CI passed

**GitHub Issue fallback** (always active, no setup required):
- On any CI failure, a GitHub Issue is auto-created with the `ci-failure` and `model-pipeline` labels, including branch, commit, author, and a link to the failed run.

**Runtime alerts** (Airflow pipeline):
- `current.json` on GCS updated on every task start/completion — dashboard polls this file
- Crash logs written to `processed/pipeline-logs/crashes/` on any task failure
- Airflow alert callbacks log task ID, execution date, and exception on every failure

**Setup Slack (one-time):**
1. Create an incoming webhook at [api.slack.com/apps](https://api.slack.com/apps)
2. Add `SLACK_WEBHOOK_URL` as a GitHub repository secret (Settings → Secrets → Actions)

---

## Key Design Decisions

- **4 coarse-grained DAG tasks, not 8 micro-tasks** — loading 8.2M rows from GCS repeatedly is expensive. Logically related steps are grouped: validate / train+eval / bias+sensitivity+visualizations / register+predict.

- **XCom carries primitives only** — `run_id` (str), `val_rmse` (float), `bias_status` (str), `registry_version` (int). Never DataFrames. Each task re-loads from GCS or MLflow independently (stateless Airflow workers).

- **Temporal split, never random** — shuffling an 8.2M-row time-series dataset would leak future lag features into training. Boundaries are hard date cuts: train `< 2024-07-01`, val `Jul–Sep 2024`, test `Oct–Dec 2024`.

- **`BaseForecaster` ABC** — XGBoost is an implementation detail. Swapping to LightGBM or TFT means one new class; evaluator, bias detection, registry, and predictor code are unchanged.

- **Optuna for joint HPO, OAT for interpretability** — Optuna explores interaction effects across 8 parameters simultaneously. OAT sweep remains for clear single-parameter sensitivity reporting. Both are optional and toggled via DAG config.

- **Crash-only logging** — success runs produce zero persistent log artifacts. Only failures write to GCS. Reduces storage costs and noise. GCS lifecycle rule cleans up after 30 days.

- **`current.json` for graphical tracking** — single GCS file overwritten on every task transition. Dashboard polls one endpoint, no Airflow API access needed.

- **Rollback gate at 10%** — a new model must not regress val RMSE by more than 10% vs. the current champion. Lead can override with `force_promote=True`.

- **Station capacity is the priority bias slice** — the data pipeline found a 10.21× raw demand disparity across station sizes. The model narrows this to 2.96× RMSE disparity. Mitigation weights are implemented and will activate automatically if it crosses 3.0×.

- **`sample_weight` wired end-to-end** — bias mitigation weights flow from `compute_mitigation_weights()` through `BaseForecaster.train()` to XGBoost's `.fit()`. MLflow tags track whether weights were applied.

- **LabelEncoder persisted to GCS** — station ID encoding uses `sklearn.LabelEncoder` saved as a pickle to GCS (`processed/features/station_label_encoder.pkl`). This ensures consistent encoding between training and prediction, avoiding the non-determinism of `.astype("category").cat.codes`.

- **MAPE excluded from gates** — too noisy on zero-demand hours (0÷0). Logged to MLflow as informational only.

- **Docker build only on `main`** — building the full Airflow image takes ~10 min. Gated to post-merge only, not every PR push.

- **Port 8082 for Airflow** — avoids clash with the Data Pipeline stack at 8081.

- **MLflow backend: SQLite + GCS artifact root** — simple, self-contained, no extra managed services. Artifact root on GCS makes model artifacts durable and accessible to all pipeline workers.

---

## Docker Services

| Service | Image | Port | Role |
|---------|-------|------|------|
| `postgres` | postgres:15 | — | Airflow metadata DB |
| `airflow-webserver` | apache/airflow:2.9.3 | 8082 | Airflow UI |
| `airflow-scheduler` | apache/airflow:2.9.3 | — | DAG scheduling |
| `airflow-init` | apache/airflow:2.9.3 | — | DB init (runs once) |
| `mlflow` | python:3.11-slim (Dockerfile.mlflow) | 5000 | Experiment tracking + model registry |
