# BlueForecast — Deployment Pipeline

Complete deployment, serving, and monitoring package for the BlueForecast Bluebikes demand prediction system. This folder is self-contained: every script, config, workflow, and model artifact needed to deploy, monitor, and retrain the system is here.

> **GitHub Actions note:** The CI/CD workflow files in `ci-cd/` are reference copies. GitHub only executes workflows from `.github/workflows/` — the live copies must remain there.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Model Summary](#2-model-summary)
3. [Folder Structure](#3-folder-structure)
4. [Environment Setup](#4-environment-setup)
5. [Cloud Deployment — GCP Cloud Run](#5-cloud-deployment--gcp-cloud-run)
6. [Edge Deployment — ONNX](#6-edge-deployment--onnx)
7. [CI/CD Pipeline](#7-cicd-pipeline)
8. [Model Monitoring & Retraining](#8-model-monitoring--retraining)
9. [Notifications](#9-notifications)
10. [Step-by-Step Replication Guide (Fresh Environment)](#10-step-by-step-replication-guide-fresh-environment)
11. [Verifying Deployment](#11-verifying-deployment)
12. [Logs & Monitoring](#12-logs--monitoring)
13. [Monitoring Thresholds Reference](#13-monitoring-thresholds-reference)

---

## 1. System Overview

BlueForecast predicts hourly bike-sharing demand at individual Bluebikes stations across Boston. The deployment system has two independent tiers:

| Tier | Target | Service | Purpose |
|------|--------|---------|---------|
| **Cloud** | GCP | Cloud Run | FastAPI inference API + Next.js operations dashboard |
| **Edge** | Any device | Docker + ONNX | Offline inference, zero cloud dependencies |

**Data & prediction flow:**

```
GCS (feature_matrix.parquet)
       │
       ▼
MLflow Training Run (XGBoost)
       │
       ├──► Cloud Run API ──► Dashboard (Next.js)
       │         ▲
       │         │ refresh every 6h (GitHub Actions)
       │
       └──► ONNX Export ──► Edge Docker Container
```

Predictions are refreshed every 6 hours via a scheduled GitHub Actions workflow. The model is retrained on-demand via manual workflow dispatch, with promotion gated on RMSE, bias, and drift checks.

---

## 2. Model Summary

| Property | Value |
|----------|-------|
| Model type | XGBoost Regressor |
| Target | Hourly bike demand per station (trips/hour) |
| Features | 29 (station, time, weather, lag, rolling, cyclical) |
| Test RMSE | **1.2865** |
| Test MAE | **0.6510** |
| Test R² | **0.7022** |
| Validation status | PASSED |
| Bias status | PASSED |
| ONNX validation | PASSED (max diff: 5.8e-07) |

### Feature Schema (29 features)

| Category | Features |
|----------|----------|
| Station | `start_station_id`, `capacity` |
| Time | `hour_of_day`, `day_of_week`, `month`, `year`, `is_weekend`, `is_holiday` |
| Weather | `temperature_c`, `precipitation_mm`, `wind_speed_kmh`, `humidity_pct`, `feels_like_c`, `weather_code`, `is_cold`, `is_hot`, `is_precipitation` |
| Lag | `demand_lag_1h`, `demand_lag_24h`, `demand_lag_168h` |
| Rolling | `rolling_avg_3h`, `rolling_avg_6h`, `rolling_avg_24h` |
| Cyclical | `hour_sin`, `hour_cos`, `dow_sin`, `dow_cos`, `month_sin`, `month_cos` |

---

## 3. Folder Structure

Everything needed for deployment is in this folder:

```
deployment-pipeline/
├── README.md                              ← This file
├── .env.example                           ← Environment variable template
│
├── scripts/                               ← Cloud deployment scripts
│   ├── deploy_dashboard.sh                ← Build + push Docker images; deploy to Cloud Run
│   ├── refresh_serving.sh                 ← Refresh Cloud Run revision after model promotion
│   └── verify_deployment.sh              ← POST-deploy API health check
│
├── monitoring/                            ← All monitoring, alerting, and retraining
│   ├── retrain_and_promote.py             ← End-to-end retrain + gate + promote orchestrator
│   ├── performance_tracker.py             ← Compute rolling 7-day RMSE/MAE from GCS predictions
│   ├── notify.py                          ← Slack + email alert dispatcher
│   └── thresholds.yaml                    ← All drift and performance thresholds
│
├── edge-deployment/                       ← Complete ONNX edge inference package
│   ├── Dockerfile                         ← python:3.11-slim image, port 8080
│   ├── docker-compose.yaml                ← Container with 512 MB RAM / 1 CPU limits
│   ├── inference_server.py                ← FastAPI server (no cloud deps at runtime)
│   ├── export_to_onnx.py                  ← Convert XGBoost .ubj → ONNX, validate parity
│   ├── config.yaml                        ← Edge server configuration
│   ├── requirements.txt                   ← onnxruntime, fastapi, uvicorn
│   ├── model/
│   │   ├── blueforecast.onnx              ← Exported ONNX model (1.02 MB)
│   │   ├── model.ubj                      ← Source XGBoost model (1.28 MB)
│   │   └── model_metadata.json            ← Feature schema + training metrics + ONNX validation
│   └── tests/
│       └── test_inference.py              ← 18 unit tests (schema, encoding, ONNX parity)
│
└── ci-cd/                                 ← GitHub Actions workflow reference copies
    ├── deploy_dashboard.yml               ← Trigger: push to main (dashboard/ or deployment-pipeline/)
    ├── model_pipeline.yml                 ← Trigger: push to Model-Pipeline/ or manual
    ├── refresh_predictions.yml            ← Trigger: cron every 6h or manual
    ├── monitor_and_retrain.yml            ← Trigger: manual dispatch only
    └── tests.yml                          ← Integration tests (placeholder)
```

Other project folders used by the deployment scripts (not copied here):
```
../dashboard/api/          ← FastAPI backend — built and deployed by deploy_dashboard.sh
../dashboard/next-app/     ← Next.js frontend — built and deployed by deploy_dashboard.sh
../Model-Pipeline/src/     ← Python packages imported by retrain_and_promote.py
```

---

## 4. Environment Setup

### Prerequisites

- Python 3.11+
- Docker and Docker Compose
- `gcloud` CLI (install: https://cloud.google.com/sdk/docs/install)
- A GCP project with billing enabled

### GCP Service Account Setup (first time)

```bash
# Create service account
gcloud iam service-accounts create blueforecast-deploy \
  --display-name="BlueForecast Deployment SA"

# Grant required roles
gcloud projects add-iam-policy-binding <YOUR_PROJECT_ID> \
  --member="serviceAccount:blueforecast-deploy@<YOUR_PROJECT_ID>.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding <YOUR_PROJECT_ID> \
  --member="serviceAccount:blueforecast-deploy@<YOUR_PROJECT_ID>.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding <YOUR_PROJECT_ID> \
  --member="serviceAccount:blueforecast-deploy@<YOUR_PROJECT_ID>.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"

gcloud projects add-iam-policy-binding <YOUR_PROJECT_ID> \
  --member="serviceAccount:blueforecast-deploy@<YOUR_PROJECT_ID>.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

# Download key (save contents as GitHub secret GCP_SA_KEY_JSON)
gcloud iam service-accounts keys create sa-key.json \
  --iam-account=blueforecast-deploy@<YOUR_PROJECT_ID>.iam.gserviceaccount.com
```

### GCP Resources Required

| Resource | Name |
|----------|------|
| GCS bucket | `bluebikes-demand-predictor-data` |
| Artifact Registry repository | `blueforecast` (region: `us-east1`) |
| Cloud Run region | `us-east1` |

### GitHub Secrets Required

Set these at **GitHub repo → Settings → Secrets and variables → Actions**:

| Secret | Description |
|--------|-------------|
| `GCP_SA_KEY_JSON` | Full JSON content of `sa-key.json` created above |
| `GCP_PROJECT_ID` | Your GCP project ID (e.g. `my-gcp-project-123`) |
| `SLACK_WEBHOOK_URL` | (Optional) Slack Incoming Webhook URL for alerts |

### Local Python Dependencies

```bash
# From repo root
pip install -r Model-Pipeline/requirements.txt

# For edge deployment only
pip install -r deployment-pipeline/edge-deployment/requirements.txt
```

Key packages used by the deployment pipeline:

| Package | Purpose |
|---------|---------|
| `xgboost` | Model training and inference |
| `mlflow` | Experiment tracking and model registry |
| `google-cloud-storage` | Read/write GCS artifacts |
| `evidently` | Data drift detection |
| `optuna` | Bayesian hyperparameter optimization |
| `shap` | Feature sensitivity analysis |
| `onnxruntime` | ONNX model inference (edge) |
| `onnxmltools` | XGBoost → ONNX conversion |
| `fastapi`, `uvicorn` | API serving (cloud and edge) |
| `requests` | Slack webhook HTTP calls |

---

## 5. Cloud Deployment — GCP Cloud Run

### Architecture

```
GitHub Push (main)
      │
      ▼
GitHub Actions: deploy_dashboard.yml
      │
      ├─► docker build dashboard/api     ──► Artifact Registry
      ├─► docker build dashboard/next-app ──► Artifact Registry
      │
      └─► gcloud run deploy blueforecast-api       ──► Cloud Run (port 8000)
          gcloud run deploy blueforecast-dashboard  ──► Cloud Run (port 3000)
```

### Services Deployed

| Service | Image Source | Resources | Port | Instances |
|---------|-------------|-----------|------|-----------|
| `blueforecast-api` | `dashboard/api/Dockerfile` | 512 Mi RAM, 1 CPU | 8000 | 1–3 |
| `blueforecast-dashboard` | `dashboard/next-app/Dockerfile` | 512 Mi RAM, 1 CPU | 3000 | 1–3 |

### Deployment Scripts

#### `scripts/deploy_dashboard.sh`

Two-phase script: build + push images, then deploy to Cloud Run.

```bash
# Phase 1 — build Docker images and push to Artifact Registry
PROJECT_ID=my-project REGION=us-east1 REGISTRY=us-east1-docker.pkg.dev \
  REPO=blueforecast API_SERVICE=blueforecast-api \
  DASHBOARD_SERVICE=blueforecast-dashboard IMAGE_TAG=latest \
  bash deployment-pipeline/scripts/deploy_dashboard.sh build-push

# Phase 2 — deploy to Cloud Run (reads same env vars)
bash deployment-pipeline/scripts/deploy_dashboard.sh deploy
```

The `deploy` action:
1. Deploys the API to Cloud Run with `--allow-unauthenticated`
2. Reads the deployed API URL and injects it as `API_BASE_URL` into the dashboard
3. Updates the API service with `DASHBOARD_URL` for CORS configuration

Required environment variables for both phases:

| Variable | Example | Description |
|----------|---------|-------------|
| `PROJECT_ID` | `my-project-123` | GCP project ID |
| `REGION` | `us-east1` | GCP region |
| `REGISTRY` | `us-east1-docker.pkg.dev` | Artifact Registry host |
| `REPO` | `blueforecast` | Artifact Registry repo name |
| `API_SERVICE` | `blueforecast-api` | Cloud Run API service name |
| `DASHBOARD_SERVICE` | `blueforecast-dashboard` | Cloud Run dashboard service name |
| `IMAGE_TAG` | `latest` or `${{ github.sha }}` | Docker image tag |

#### `scripts/refresh_serving.sh`

After a new model is promoted to the MLflow registry, this refreshes the Cloud Run API revision so it picks up the new model without a full image rebuild:

```bash
API_SERVICE=blueforecast-api REGION=us-east1 \
  REFRESH_TOKEN="$(date -u +%Y%m%dT%H%M%SZ)" \
  bash deployment-pipeline/scripts/refresh_serving.sh
```

This updates the `MODEL_REFRESHED_AT` environment variable on the running Cloud Run service, which triggers a new revision.

#### `scripts/verify_deployment.sh`

Checks the API health endpoint and prints deployed service URLs:

```bash
API_URL="https://blueforecast-api-xxxx-ue.a.run.app" \
  DASHBOARD_URL="https://blueforecast-dashboard-xxxx-ue.a.run.app" \
  bash deployment-pipeline/scripts/verify_deployment.sh
```

Expected output:
```
=== Verifying API health ===
{"status":"ok","model":"champion","version":"..."}
=== Deployment Complete ===
API:       https://blueforecast-api-xxxx-ue.a.run.app
Dashboard: https://blueforecast-dashboard-xxxx-ue.a.run.app
```

---

## 6. Edge Deployment — ONNX

The XGBoost champion model is converted to ONNX format for deployment on resource-constrained devices (Raspberry Pi, IoT gateways, edge servers) with **zero cloud dependencies** at runtime.

### Edge Architecture

```
┌──────────────────────────────────────────────────┐
│              Edge Device / Server                 │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │     Docker Container (blueforecast-edge) │    │
│  │                                          │    │
│  │  ┌──────────────┐   ┌────────────────┐   │    │
│  │  │ ONNX Runtime │   │ FastAPI Server │   │    │
│  │  │  (CPU only)  │──▶│   Port 8080    │   │    │
│  │  └──────────────┘   └────────────────┘   │    │
│  │         ▲                                │    │
│  │  ┌──────────────┐                        │    │
│  │  │ blueforecast │                        │    │
│  │  │    .onnx     │                        │    │
│  │  └──────────────┘                        │    │
│  └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

### Model Optimization Results

| Aspect | XGBoost (Cloud) | ONNX (Edge) |
|--------|----------------|-------------|
| File format | `.ubj` binary | `.onnx` |
| File size | 1.28 MB | **1.02 MB** |
| Runtime dependency | xgboost + mlflow + GCS | onnxruntime only |
| Inference latency | ~5 ms | **2.8 ms** |
| Cloud dependency | MLflow + GCS required | **None** |
| Prediction parity | — | Max diff: 5.8e-07 (PASSED) |

### Edge API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Liveness check — model loaded, uptime |
| GET | `/model-info` | Model metadata, feature schema, training metrics |
| POST | `/predict` | Single station-hour demand forecast |
| POST | `/predict/batch` | Batch predictions for multiple stations |

### Sample Prediction Request / Response

```bash
curl -X POST http://localhost:8080/predict \
  -H "Content-Type: application/json" \
  -d '{
    "start_station_id": 100, "capacity": 19,
    "hour_of_day": 8, "day_of_week": 1, "month": 6, "year": 2024,
    "is_weekend": 0, "is_holiday": 0,
    "temperature_c": 22.5, "precipitation_mm": 0.0,
    "wind_speed_kmh": 12.0, "humidity_pct": 65.0,
    "feels_like_c": 21.0, "weather_code": 0,
    "is_cold": 0, "is_hot": 0, "is_precipitation": 0,
    "demand_lag_1h": 5.0, "demand_lag_24h": 8.0,
    "demand_lag_168h": 7.0, "rolling_avg_3h": 4.5,
    "rolling_avg_6h": 5.2, "rolling_avg_24h": 6.1
  }'
```

```json
{
  "station_id": 100,
  "predicted_demand": 1.236,
  "prediction_timestamp": "2026-04-13T06:37:50.936357",
  "inference_time_ms": 2.8
}
```

Cyclical features (`hour_sin`, `hour_cos`, `dow_sin`, `dow_cos`, `month_sin`, `month_cos`) are auto-computed by the inference server if not provided.

### Docker Resource Limits (edge-deployment/docker-compose.yaml)

| Resource | Limit |
|----------|-------|
| Memory | 512 MB |
| CPU | 1 core |
| Health check | Every 30s via `/health` |
| Restart policy | On failure |

### Running Edge Tests

```bash
cd deployment-pipeline/edge-deployment
pip install pytest httpx
pytest tests/test_inference.py -v
# Expected: 18 passed
```

Tests cover: feature schema validation, cyclical feature encoding, request conversion, ONNX model prediction parity, and model metadata validation.

---

## 7. CI/CD Pipeline

All five workflow files are in `ci-cd/` (reference copies; live versions in `.github/workflows/`).

### Workflow Summary

| File | Trigger | Jobs |
|------|---------|------|
| `deploy_dashboard.yml` | Push to `main` touching `dashboard/` or `deployment-pipeline/`; manual | build-push → deploy → verify |
| `model_pipeline.yml` | Push touching `Model-Pipeline/`; PR; manual | lint+test → docker-build → (optional) train |
| `refresh_predictions.yml` | Cron `0 */6 * * *`; manual | generate 24h forecasts → verify GCS write |
| `monitor_and_retrain.yml` | Manual dispatch only | Job 1: drift health check + report. Job 2: full retrain → validate → promote → Slack notify (runs if drift detected or `force_retrain=true`) |
| `tests.yml` | — | Placeholder (integration tests coming) |

---

### `deploy_dashboard.yml` — Automated Cloud Deployment

Triggered automatically when `dashboard/` or `deployment-pipeline/` files are pushed to `main`.

**Job 1 — `build-push`:**
- Authenticates to GCP using `GCP_SA_KEY_JSON` secret
- Builds `dashboard/api` and `dashboard/next-app` Docker images
- Pushes both to Artifact Registry tagged with the commit SHA

**Job 2 — `deploy`** (runs after build-push):
- Deploys API to Cloud Run (512Mi, 1 CPU, 1–3 instances, port 8000)
- Deploys dashboard to Cloud Run with `API_BASE_URL` set to live API URL
- Runs `verify_deployment.sh` to confirm health endpoint responds

---

### `model_pipeline.yml` — Model CI

Triggered on every push touching `Model-Pipeline/`.

**Job 1 — `test`** (always runs):
```bash
ruff check Model-Pipeline/src/ Model-Pipeline/dags/
pytest Model-Pipeline/tests/test_model_pipeline.py -v --tb=short
# 29 unit tests, no GCP credentials required
```

**Job 2 — `docker-build`** (main branch only):
```bash
docker compose -f Model-Pipeline/docker-compose.yaml build --no-cache
# Verifies Airflow + MLflow images build cleanly
```

**Job 3 — `train`** (manual dispatch, `run_training=true` only):
```bash
QUICK_CHECK=True RUN_OPTUNA=<input> python train.py   # 5% sample
python evaluate.py                                     # test set gate
python bias_check.py                                   # bias detection
python sensitivity_run.py                              # SHAP analysis
```

To trigger manually:
```
GitHub → Actions → "Model Pipeline CI" → Run workflow
  run_training: true
  run_optuna: true   # optional — enables Bayesian HPO
```

**Job 4 — `notify`** (always): Sends Slack alert on failure; creates GitHub Issue as fallback.

---

### `refresh_predictions.yml` — Scheduled Forecast Refresh

Runs automatically every 6 hours. Generates fresh 24-hour demand forecasts for all stations and writes them to GCS:

```
gs://bluebikes-demand-predictor-data/processed/predictions/latest/
```

To trigger manually:
```
GitHub → Actions → "BlueForecast — Refresh Predictions" → Run workflow
```

---

### `monitor_and_retrain.yml` — Drift Check & Retraining

Manual-only workflow with two sequential jobs:

**Job 1 — `monitor`**: Loads the approved model metadata and drift report from GCS, prints a full health summary, and sets a `drift_detected` output flag.

**Job 2 — `retrain`**: Runs if `force_retrain=true` OR `drift_detected=true`. Executes the full `retrain_and_promote.py` pipeline, then refreshes the Cloud Run serving revision. Sends a Slack alert on failure.

```
GitHub → Actions → "BlueForecast — Monitor & Retrain" → Run workflow
  force_retrain: true       # retrain even if no drift detected
  reason: "new data available"
```

> Auto-retraining on a schedule is intentionally disabled — current drift is calendar-driven (month/year features), not model degradation. MAE improved 30% on the current model. Full retrain is triggered manually when new training data is available.

---

## 8. Model Monitoring & Retraining

### Monitoring Stack

| Component | File | Purpose |
|-----------|------|---------|
| Thresholds config | `monitoring/thresholds.yaml` | All drift and performance alert thresholds |
| Performance tracker | `monitoring/performance_tracker.py` | Load recent predictions from GCS, compute 7-day rolling RMSE/MAE |
| Alert dispatcher | `monitoring/notify.py` | Send Slack/email notifications for drift, promotion, degradation events |
| Retrain orchestrator | `monitoring/retrain_and_promote.py` | End-to-end retrain → validate → drift check → promote pipeline |

### `monitoring/performance_tracker.py`

Reads recent prediction parquet files from `gs://bluebikes-demand-predictor-data/processed/predictions/` and computes rolling 7-day RMSE and MAE. Saves the result to `processed/reports/performance_latest.json`.

```bash
PYTHONPATH=. python3 deployment-pipeline/monitoring/performance_tracker.py
```

Output format:
```json
{
  "status": "ok",
  "rmse_7d": 1.3124,
  "mae_7d": 0.6821,
  "sample_count": 4832,
  "daily": { "2026-04-19": {"rmse": 1.28, "mae": 0.65, "count": 720} },
  "run_at": "2026-04-20T08:00:00"
}
```

### `monitoring/notify.py`

Dispatches Slack and email alerts. Called by `retrain_and_promote.py` automatically. Can also be called standalone:

```python
from deployment_pipeline.monitoring.notify import notify_drift_detected, notify_model_promoted

notify_drift_detected(drift_report)       # orange Slack alert
notify_model_promoted(new_rmse, old_rmse) # green Slack alert
```

Requires `SLACK_WEBHOOK_URL` environment variable. Email requires `NOTIFY_EMAIL`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`.

### `monitoring/retrain_and_promote.py` — Full Retraining Orchestrator

End-to-end pipeline that retrains, validates, and promotes a new model.

**What it does, step by step:**

1. Loads `feature_matrix.parquet` from GCS, performs temporal train/val/test split
2. Trains XGBoost candidate (optional Optuna Bayesian HPO: 30 trials, 20% subsample)
3. Evaluates on held-out test set — gates: RMSE, R², MAE
4. Runs bias detection across station-level subgroups
5. Runs SHAP sensitivity analysis (OAT sweep optional)
6. Detects feature drift (KS test, KL divergence on 10k samples)
7. Detects performance drift (MAE change on reference vs current errors)
8. Saves drift report to `gs://.../processed/models/{run_id}/drift_report.json`
9. Registers model to MLflow Model Registry if all gates pass (must be > 2% better)
10. Regenerates 24-hour production predictions

```bash
# Standard full retrain (from repo root)
PYTHONPATH=Model-Pipeline/src python3 deployment-pipeline/monitoring/retrain_and_promote.py

# Fast CI mode — 5% data, 50 estimators
QUICK_CHECK=true PYTHONPATH=Model-Pipeline/src \
  python3 deployment-pipeline/monitoring/retrain_and_promote.py

# With Bayesian HPO (30 Optuna trials)
RUN_OPTUNA=true PYTHONPATH=Model-Pipeline/src \
  python3 deployment-pipeline/monitoring/retrain_and_promote.py

# Emergency override — bypass gates
FORCE_PROMOTE=true BIAS_OVERRIDE_REASON="approved by oncall" \
  PYTHONPATH=Model-Pipeline/src \
  python3 deployment-pipeline/monitoring/retrain_and_promote.py
```

**Environment flags:**

| Variable | Default | Description |
|----------|---------|-------------|
| `QUICK_CHECK` | `false` | Use 5% data sample, 50 estimators |
| `RUN_OPTUNA` | `false` | Enable Optuna Bayesian HPO (30 trials) |
| `SKIP_SWEEP` | `true` | Skip OAT hyperparameter sweep (keep true for speed) |
| `FORCE_PROMOTE` | `false` | Bypass all promotion gates (emergency only) |
| `BIAS_OVERRIDE_REASON` | `""` | Required justification when `FORCE_PROMOTE=true` |

**Promotion gate logic:**

```
Train candidate
      │
      ▼
Evaluate on test set
  Gate: RMSE ≤ threshold?
  Gate: R² ≥ threshold?
  Gate: MAE ≤ threshold?
      │ PASS
      ▼
Bias detection
  Gate: no protected-group disparity?
      │ PASS
      ▼
Compare to production model
  Gate: new RMSE < production RMSE × 0.98 (must improve by > 2%)?
      ├── YES → Register to MLflow Registry → Regenerate predictions
      └── NO  → Log result, keep existing production model
```

---

## 9. Notifications

### Slack

Configure `SLACK_WEBHOOK_URL` as a GitHub Actions secret or local environment variable.

| Event | Color | Trigger |
|-------|-------|---------|
| Drift detected | Orange | KS test or MAE drift above threshold |
| Retraining triggered | Blue | `notify_retrain_triggered()` |
| Model promoted | Green | New model passes all gates |
| Model not promoted | Grey | Candidate did not beat production by 2% |
| Performance degraded | Red | 7-day RMSE > 1.5× baseline |
| CI failure | Red | GitHub Actions test job fails |

### GitHub Issues (CI failure fallback)

If `SLACK_WEBHOOK_URL` is not set, `model_pipeline.yml` automatically opens a GitHub Issue on test failures with branch, author, and link to the failing run.

### Email (Optional)

Set `NOTIFY_EMAIL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` to enable email alerts. Disabled by default in `monitoring/thresholds.yaml`.

---

## 10. Step-by-Step Replication Guide (Fresh Environment)

These steps take you from a clean machine to a fully deployed system.

### Step 1 — Install Prerequisites

```bash
# Python 3.11
python3 --version   # should be 3.11+

# Docker
docker --version    # 20.10+
docker compose version

# gcloud CLI
curl https://sdk.cloud.google.com | bash
exec -l $SHELL
gcloud --version
```

### Step 2 — Clone the Repository

```bash
git clone https://github.com/<org>/bluebikes-demand-predictor.git
cd bluebikes-demand-predictor
```

### Step 3 — Authenticate to GCP

```bash
gcloud auth login
gcloud config set project <YOUR_PROJECT_ID>
gcloud auth configure-docker us-east1-docker.pkg.dev
```

### Step 4 — Create GCP Service Account and Resources

```bash
# Enable required APIs
gcloud services enable run.googleapis.com \
  artifactregistry.googleapis.com \
  storage.googleapis.com

# Create service account
gcloud iam service-accounts create blueforecast-deploy \
  --display-name="BlueForecast Deployment SA"

SA="blueforecast-deploy@<YOUR_PROJECT_ID>.iam.gserviceaccount.com"

# Grant roles
for ROLE in roles/run.admin roles/artifactregistry.writer \
            roles/storage.objectAdmin roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding <YOUR_PROJECT_ID> \
    --member="serviceAccount:${SA}" --role="${ROLE}"
done

# Download key
gcloud iam service-accounts keys create sa-key.json --iam-account="${SA}"

# Create Artifact Registry repo
gcloud artifacts repositories create blueforecast \
  --repository-format=docker \
  --location=us-east1

# Create GCS bucket
gcloud storage buckets create gs://bluebikes-demand-predictor-data \
  --location=us-east1
```

### Step 5 — Set GitHub Secrets

Go to **GitHub → repo → Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|--------|-------|
| `GCP_SA_KEY_JSON` | Paste contents of `sa-key.json` |
| `GCP_PROJECT_ID` | Your project ID string |
| `SLACK_WEBHOOK_URL` | Your Slack webhook (optional) |

### Step 6 — Set Local Environment Variables

```bash
# Copy the template and fill in your values
cp deployment-pipeline/.env.example .env

export PROJECT_ID="<YOUR_PROJECT_ID>"
export REGION="us-east1"
export REGISTRY="us-east1-docker.pkg.dev"
export REPO="blueforecast"
export API_SERVICE="blueforecast-api"
export DASHBOARD_SERVICE="blueforecast-dashboard"
export IMAGE_TAG="latest"
```

### Step 7 — Install Python Dependencies

```bash
pip install -r Model-Pipeline/requirements.txt
```

### Step 8 — Build and Push Docker Images

```bash
bash deployment-pipeline/scripts/deploy_dashboard.sh build-push
```

This builds `dashboard/api` (FastAPI) and `dashboard/next-app` (Next.js) and pushes both to Artifact Registry.

### Step 9 — Deploy to Cloud Run

```bash
bash deployment-pipeline/scripts/deploy_dashboard.sh deploy
```

This deploys both Cloud Run services, wires `API_BASE_URL` into the dashboard, and sets `DASHBOARD_URL` on the API for CORS.

### Step 10 — Verify the Deployment

```bash
export API_URL="$(gcloud run services describe blueforecast-api \
  --region=us-east1 --format='value(status.url)')"
export DASHBOARD_URL="$(gcloud run services describe blueforecast-dashboard \
  --region=us-east1 --format='value(status.url)')"

bash deployment-pipeline/scripts/verify_deployment.sh
```

Expected:
```
=== Verifying API health ===
{"status":"ok","model":"champion","version":"..."}
=== Deployment Complete ===
API:       https://blueforecast-api-xxxx-ue.a.run.app
Dashboard: https://blueforecast-dashboard-xxxx-ue.a.run.app
```

### Step 11 — Generate Initial Forecasts

```bash
PYTHONPATH=Model-Pipeline/src GCS_BUCKET=bluebikes-demand-predictor-data \
  python3 -c "from model_pipeline.predictor import run_prediction_pipeline; run_prediction_pipeline()"
```

Or trigger via GitHub Actions:
```
GitHub → Actions → "BlueForecast — Refresh Predictions" → Run workflow
```

Verify predictions were written:
```bash
gcloud storage ls -l gs://bluebikes-demand-predictor-data/processed/predictions/latest/
```

### Step 12 — (Optional) Run Model Retraining

```bash
# Quick check — 5% sample, fast
QUICK_CHECK=true PYTHONPATH=Model-Pipeline/src \
  python3 deployment-pipeline/monitoring/retrain_and_promote.py

# Full retrain with HPO
RUN_OPTUNA=true PYTHONPATH=Model-Pipeline/src \
  python3 deployment-pipeline/monitoring/retrain_and_promote.py
```

After a successful promotion, refresh the serving revision:
```bash
export REFRESH_TOKEN="$(date -u +%Y%m%dT%H%M%SZ)"
bash deployment-pipeline/scripts/refresh_serving.sh
```

### Step 13 — (Optional) Start Edge Inference Server

```bash
cd deployment-pipeline/edge-deployment

# Model files already present — skip export if blueforecast.onnx exists
# To re-export from a new model.ubj:
pip install xgboost mlflow onnxruntime onnxmltools skl2onnx numpy
python export_to_onnx.py

# Start container
docker compose up --build -d

# Verify
curl http://localhost:8080/health
# → {"status":"healthy","model_loaded":true,"model_format":"ONNX","uptime_seconds":...}

# Run tests
pip install pytest httpx
pytest tests/test_inference.py -v
# → 18 passed
```

---

## 11. Verifying Deployment

### Cloud API Health

```bash
curl https://<API_URL>/api/health
# → {"status": "ok", "model": "champion", "version": "..."}
```

### Prediction Endpoint

```bash
curl "https://<API_URL>/api/predictions?station_id=67&hours=24"
```

### Latest Predictions in GCS

```bash
gcloud storage ls -l \
  gs://bluebikes-demand-predictor-data/processed/predictions/latest/
```

### Drift Report

```bash
gcloud storage cat \
  gs://bluebikes-demand-predictor-data/processed/reports/drift_latest.json
```

### Approved Model Metadata

```bash
gcloud storage cat \
  gs://bluebikes-demand-predictor-data/processed/models/approved/metadata.json
```

### Rolling Performance Metrics

```bash
gcloud storage cat \
  gs://bluebikes-demand-predictor-data/processed/reports/performance_latest.json
```

### Edge Server Health

```bash
curl http://localhost:8080/health
curl http://localhost:8080/model-info
```

---

## 12. Logs & Monitoring

### What Gets Logged and Where

| Layer | What is logged | Where it lives |
|-------|---------------|----------------|
| Training runs | Params, RMSE, MAE, R², artifacts, tags | MLflow (`mlruns/` locally, GCS remotely) |
| Drift report | Per-feature KS test results, MAE delta, recommendation | `gs://.../processed/models/{run_id}/drift_report.json` |
| Performance metrics | 7-day rolling RMSE/MAE, daily breakdown | `gs://.../processed/reports/performance_latest.json` |
| Model metadata | run_id, RMSE, promotion status, dataset hash | `gs://.../processed/models/approved/metadata.json` |
| Predictions | Hourly forecasts for all stations | `gs://.../processed/predictions/latest/*.parquet` |
| Cloud Run logs | API request/response, errors, startup | GCP Cloud Logging (automatic) |
| CI/CD run logs | Each workflow step output | GitHub Actions → Actions tab |
| Edge server health | Model loaded, uptime, inference time | `/health` endpoint response body |

### Reading Cloud Run Logs

```bash
# Stream live API logs
gcloud logging read "resource.type=cloud_run_revision \
  AND resource.labels.service_name=blueforecast-api" \
  --limit=50 --format="table(timestamp,textPayload)"

# Filter for errors only
gcloud logging read "resource.type=cloud_run_revision \
  AND resource.labels.service_name=blueforecast-api \
  AND severity>=ERROR" --limit=20
```

### Reading MLflow Logs

```bash
# View all training runs
cd Model-Pipeline
mlflow ui --port 5000
# Open http://localhost:5000 in browser

# Or inspect directly
python3 -c "
import mlflow
mlflow.set_tracking_uri('mlruns')
runs = mlflow.search_runs(order_by=['start_time DESC'])
print(runs[['run_id','metrics.val_rmse','metrics.test_rmse','status']].head(10))
"
```

### Reading GCS Reports

```bash
# Latest drift report
gcloud storage cat \
  gs://bluebikes-demand-predictor-data/processed/reports/drift_latest.json | python3 -m json.tool

# Latest performance metrics
gcloud storage cat \
  gs://bluebikes-demand-predictor-data/processed/reports/performance_latest.json | python3 -m json.tool

# Approved model metadata
gcloud storage cat \
  gs://bluebikes-demand-predictor-data/processed/models/approved/metadata.json | python3 -m json.tool
```

### Log Retention

GCS bucket lifecycle rules (`Model-Pipeline/lifecycle.json`) automatically delete pipeline crash logs older than 30 days from `processed/pipeline-logs/crashes/`. All model artifacts and reports are retained indefinitely.

---

## 13. Monitoring Thresholds Reference

Full config: [`monitoring/thresholds.yaml`](monitoring/thresholds.yaml)

| Category | Parameter | Value | Meaning |
|----------|-----------|-------|---------|
| Data drift | `drift_share_threshold` | 0.25 | Alert if > 25% of features drift |
| Data drift | `min_drifted_columns` | 3 | Alert if > 3 columns drift simultaneously |
| Data drift | `stat_test` | `ks` | Kolmogorov-Smirnov test |
| Data drift | `stat_test_threshold` | 0.05 | p-value significance cutoff |
| Concept drift | `rmse_increase_threshold` | 0.30 | Alert if RMSE grows > 30% above training baseline |
| Concept drift | `min_samples` | 100 | Min predictions required for concept drift evaluation |
| Performance | `rmse_multiplier_threshold` | 1.50 | 7-day RMSE must stay < 1.5× baseline |
| Performance | `mae_absolute_threshold` | 4.0 | 7-day MAE must stay < 4.0 trips/hour |
| Performance | `min_samples_7d` | 50 | Min samples required to compute 7-day metrics |
| Retraining | `cooldown_days` | 3 | Minimum days between retraining runs |
| Retraining | `promotion_threshold` | 0.02 | New model must improve RMSE by > 2% to be promoted |
| Schedule | `monitoring_cron` | `0 */6 * * *` | Monitoring check every 6 hours |
| Schedule | `drift_lookback_days` | 7 | Days of history used for drift evaluation |
