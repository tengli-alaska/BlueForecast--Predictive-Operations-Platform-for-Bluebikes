# BlueForecast — Engineering Handoff Notes
**Author:** Sruthi  
**Date:** 2026-04-10  
**Branch:** `deployment-kickstart-sruthilaya`  
**Goal:** Conference presentation of a live MLOps pipeline for Bluebikes demand forecasting

---

## What This Project Covers (Assignment Rubric Mapping)

| Rubric Item | Status | Where |
|---|---|---|
| Deployment Scripts | ✅ Done | `.github/workflows/deploy_dashboard.yml` |
| Connection to Repository (CI/CD) | ✅ Done | GitHub Actions → Cloud Run auto-deploy |
| Monitoring & Drift Detection | ✅ Partial | Drift/Bias pages in dashboard; **retraining trigger not implemented** |
| Environment Configuration | ✅ Done | `docker-compose.yaml`, Dockerfiles, Cloud Run env vars |
| Logs & Monitoring | ✅ Partial | Cloud Run logs + GCS health check; **no Cloud Monitoring alerts** |
| Edge Deployment | ❌ Not done | See section below |

---

## Architecture Overview

```
GitHub Push (dashboard/** changed)
        ↓
GitHub Actions CI/CD
        ├── Build API Docker image → Artifact Registry (us-east1)
        ├── Build Next.js Docker image → Artifact Registry (us-east1)
        ├── Deploy blueforecast-api → Cloud Run
        └── Deploy blueforecast-dashboard → Cloud Run

Cloud Run Services (always live, scale to zero at idle ≈ $0):
  blueforecast-api        → reads GCS bucket on every request (TTL cache 5–60 min)
  blueforecast-dashboard  → Next.js frontend, calls API

GCS Bucket: bluebikes-demand-predictor-data
  ├── processed/stations/stations.parquet          (station metadata)
  ├── processed/stations/station_id_mapping.parquet (ID bridge, written by pipeline)
  ├── processed/features/hourly_demand_by_station.parquet
  ├── processed/features/feature_matrix.parquet
  ├── processed/predictions/latest/predictions.parquet
  ├── processed/models/approved/metadata.json      (current model metrics)
  ├── processed/models/{run_id}/bias_report.json
  ├── processed/models/{run_id}/drift_report.json
  ├── processed/models/{run_id}/validation_summary.json
  └── processed/pipeline-status/current.json
```

**Key design principle:** The API reads GCS on every request (with TTL cache). When the ML pipeline runs and writes new files to GCS, the dashboard automatically reflects them — no redeployment needed.

---

## Deployment Pipeline — What's Done

### CI/CD: `.github/workflows/deploy_dashboard.yml`
- Triggers on push to `main` or `deployment-kickstart-sruthilaya` when `dashboard/**` files change
- Job 1: builds both Docker images, tags with git SHA, pushes to Artifact Registry
- Job 2: deploys API first, gets its URL, deploys frontend with that URL baked in, updates API with dashboard URL for CORS
- `NEXT_PUBLIC_API_URL` is baked at **build time** (Next.js requirement) using `--build-arg`
- The Cloud Run URL for the API is hardcoded in the build arg: `https://blueforecast-api-mem5htpgca-ue.a.run.app`

**TODO before final submission:** Remove `deployment-kickstart-sruthilaya` from workflow triggers — keep only `main`.

### API: `dashboard/api/main.py`
FastAPI app reading from GCS via `gcs_client.py` (TTL in-memory cache).

| Endpoint | GCS Path | Cache TTL | Status |
|---|---|---|---|
| `GET /api/health` | — | — | ✅ Live |
| `GET /api/stations` | `processed/stations/stations.parquet` | 60 min | ✅ Live |
| `GET /api/predictions` | `processed/predictions/latest/predictions.parquet` | 5 min | ✅ Live |
| `GET /api/metrics/latest` | `processed/models/approved/metadata.json` | 5 min | ✅ Live |
| `GET /api/station-mapping` | `processed/stations/station_id_mapping.parquet` | 60 min | ⚠️ 503 until pipeline re-runs |
| `GET /api/bias-report` | `processed/models/{run_id}/bias_report.json` | 10 min | ✅ Live |
| `GET /api/drift-report` | `processed/models/{run_id}/drift_report.json` | 10 min | ✅ Live |
| `GET /api/pipeline-status` | `processed/pipeline-status/current.json` | 30 sec | ✅ Live |
| `GET /api/validation` | `processed/models/{run_id}/validation_summary.json` | 10 min | ✅ Live |

CORS is dynamic: reads `DASHBOARD_URL` env var injected at Cloud Run deploy time, so the frontend URL is never hardcoded.

### GCS Client: `dashboard/api/gcs_client.py`
- Singleton `gcs` object shared across all requests
- TTL-based in-memory cache (no Redis, not persistent across restarts — fine for demo)
- If GCS is unavailable (credentials missing), `gcs.available = False` and all endpoints return 503

### Data Pipeline: `Data-Pipeline/src/data_processing/feature_engineering.py`
- Modified `_build_station_lookup()` to capture `gbfs_station_id` (GBFS UUID), `station_name`, `lat`, `lon` in addition to `capacity`
- Now saves `processed/stations/station_id_mapping.parquet` to GCS after feature engineering runs
- This file bridges the two ID systems used across the project (see Station ID section below)

---

## Dashboard Pages — Live vs Demo Status

The TopBar shows a global green "Live data" / amber "Demo data" indicator based on `/api/health`.

### Per-Page Data Status

| Page | Route | Data Source | Live? | DataBadge? | Notes |
|---|---|---|---|---|---|
| Overview | `/overview` | `getLatestMetrics`, `getStations`, `getBiasReport`, `getDriftReport`, `getPipelineStatus` | ✅ Mostly live | ✅ Yes | `getModelMetrics` (trend chart), `getDemandHeatmap`, and `getStationStatuses` are **still mock**. `getBiasReport`/`getDriftReport` are live but `isLive` not tracked for them — badge only reflects metrics/pipeline/stations |
| Stations | `/stations` | `getStations`, `getPredictions` | ✅ Live | ❌ No badge | Data is real from GCS; DataBadge not added yet |
| Forecasts | `/forecasts` | `getStations`, `getPredictions`, `getStationMapping` | ✅ Live | ❌ No badge | Per-station filtering works once `station_id_mapping.parquet` exists in GCS; until then shows network-wide predictions |
| Rebalancing | `/rebalancing` | `getStations`, `getPredictions` (live) + `mockStationStatuses`, `mockRebalancingRoutes` (mock) | ⚠️ Partial | ✅ Yes | Station/prediction data is live; risk levels and route suggestions are derived from mock statuses. Routes are labeled "AI-Suggested — not dispatched" |
| Performance | `/performance` | `getLatestMetrics`, `getModelMetrics` | ⚠️ Partial | ❌ No badge | `getLatestMetrics` is live (GCS); `getModelMetrics` trend history is **mock** |
| Features | `/features` | `getFeatureImportance` | ❌ Mock only | ❌ No badge | No API endpoint for SHAP values — all mock data |
| Bias | `/bias` | `getBiasReport` | ✅ Live | ❌ No badge | Reads real `bias_report.json` from GCS; no `isLive` tracking or badge |
| Drift | `/drift` | `getDriftReport` | ✅ Live | ❌ No badge | Reads real `drift_report.json` from GCS; no `isLive` tracking or badge |
| Pipeline | `/pipeline` | `getPipelineStatus` | ✅ Live | ❌ No badge | Reads `current.json` from GCS; no badge |

### Summary: What is actually Mock data right now

1. **`getModelMetrics()`** — returns `mockModelMetrics` always. Used for trend charts on Overview and Performance. Fix: add a GCS path that stores historical run metadata and serve it from a new `/api/metrics/history` endpoint.
2. **`getFeatureImportance()`** — returns `mockFeatureImportance` always. Fix: SHAP values need to be computed during training and saved to GCS.
3. **`getDemandHeatmap()`** — returns `mockDemandHeatmap` always. Used on Overview page.
4. **`getStationStatuses()`** — returns `mockStationStatuses` always. Used on Overview page. (Rebalancing derives its own statuses from real predictions.)

---

## Dashboard Consistency Issues — Pending Fixes

These pages are missing polish that others already have:

### Missing DataBadge (amber/green live indicator) on:
- `/stations` — shows real data but no badge to tell the user
- `/forecasts` — shows real data but no badge
- `/performance` — partially real, no badge; user can't tell what's live
- `/features` — entirely mock, no badge; user might think it's real
- `/bias` — real data, no badge
- `/drift` — real data, no badge
- `/pipeline` — real data, no badge

**Fix:** Import `DataBadge` and track `isLive` in each page (same pattern as Overview and Rebalancing). The `getLatestMetrics`, `getPredictions`, `getPipelineStatus`, `getBiasReport`, `getDriftReport` functions all already return `{ data, isLive }` — just need to wire it to a badge in the UI.

### Performance page — metric history is mock
The RMSE trend line over time is fake. Real data would need historical run metadata stored in GCS.

### Features page — entirely mock
SHAP feature importances are hard-coded. Real fix: compute SHAP during training, save to `processed/models/{run_id}/feature_importance.json`, add `/api/feature-importance` endpoint.

### Stations page — no demand color legend on map
The map pins use color to show demand levels but there's no legend explaining what green/yellow/red means. Forecasts page has demand labels (High/Moderate/Quiet) — Stations should match.

### Forecasts page — per-station filtering pending pipeline re-run
The mapping works in code but `station_id_mapping.parquet` doesn't exist in GCS yet. Until the feature engineering DAG runs again, all stations show the same network-wide predictions. After the DAG runs, it will be fully per-station.

---

## The Station ID Problem (Explained)

Two different ID systems exist in this project:

| Source | ID format | Example |
|---|---|---|
| Trip data / predictions | Operational (A-series) | `A32015` |
| GBFS station metadata | UUID | `abc123-def456-...` |

The `stations.parquet` uses GBFS UUIDs. The `predictions.parquet` uses A-series IDs. They can't be joined directly.

**Solution implemented:**
- `feature_engineering.py` now resolves names + coordinates to match A-series → GBFS, saves the lookup to `processed/stations/station_id_mapping.parquet`
- API serves it at `/api/station-mapping`
- Forecasts page fetches it and uses it to filter predictions per selected station

**This only activates after the next feature engineering DAG run.**

---

## What Is NOT Done (Needs Teammate Work)

### 1. Edge Deployment
Not implemented at all. Options to consider:
- **ONNX export** of the trained XGBoost model — enables running inference without Python/GCS
- **Docker image for edge** — stripped-down container with just the model + FastAPI, no GCS dependency
- Could deploy to a Raspberry Pi, a local server, or even a browser via ONNX.js
- Relevant files: model is saved in MLflow format under `processed/models/{run_id}/`; need to add an ONNX export step to the training pipeline

### 2. Retraining Trigger
No automated retraining implemented. What's needed:
- A Cloud Scheduler job or Airflow sensor that fires when drift is detected (`overall_drift_detected: true` in `drift_report.json`)
- Or a manual trigger: a Cloud Run Job / Cloud Function that runs `airflow dags trigger model_pipeline`
- The drift detection logic is already in the pipeline — just needs something to act on it

**Rough implementation path:**
```
Cloud Scheduler (daily) 
  → Cloud Function reads drift_report.json
  → If drift detected: call Airflow REST API to trigger model_pipeline DAG
  → New model trains, promotes to approved/, writes new predictions
  → Dashboard reflects new model automatically (no redeploy needed)
```

### 3. Cloud Monitoring / Alerting
No Google Cloud Monitoring dashboards or alerts set up. For the rubric:
- Cloud Run emits logs automatically to Cloud Logging — can query them
- To add alerts: go to Cloud Monitoring → create alert on `run.googleapis.com/request_count` with 5xx filter
- Uptime check: Cloud Monitoring → Uptime Checks → point at `/api/health`

### 4. Historical Metrics API
`getModelMetrics()` returns mock data. Real implementation:
- After each training run, append metrics to a `processed/models/history.json` in GCS
- Add `/api/metrics/history` endpoint
- Wire it into Performance and Overview trend charts

### 5. Feature Importance API
`getFeatureImportance()` returns mock data. Real implementation:
- Compute SHAP values during training (XGBoost supports `model.get_score()` natively)
- Save to `processed/models/{run_id}/feature_importance.json`
- Add `/api/feature-importance` endpoint

---

## Environment Setup for Local Dev

```bash
# Copy and fill in your values
cp dashboard/.env.example dashboard/.env

# .env must contain:
GOOGLE_APPLICATION_CREDENTIALS=/path/to/your/gcloud/adc.json
GCLOUD_CONFIG_DIR=/path/to/.config/gcloud   # Windows: C:/Users/YourName/.config/gcloud
GOOGLE_CLOUD_PROJECT=bluebikes-demand-predictor

# Run locally
cd dashboard
docker compose up
# API: http://localhost:8000
# Dashboard: http://localhost:3000
```

**Windows note:** Use forward slashes in `GCLOUD_CONFIG_DIR`. The `docker-compose.yaml` uses `${GCLOUD_CONFIG_DIR:-~/.config/gcloud}` so it falls back correctly on Mac/Linux.

## GCP Secrets (GitHub Actions)

| Secret Name | What It Is |
|---|---|
| `GCP_SA_KEY_JSON` | Service account JSON key for `github-deploy-sa` |
| `GCP_PROJECT_ID` | `bluebikes-demand-predictor` |

**NEVER commit the service account JSON file to the repo.** Save it to Desktop, paste into GitHub Secrets, delete immediately.

## Artifact Registry Cleanup (TODO)
Images accumulate with every push. Add a cleanup policy to keep only the last 5:
```bash
gcloud artifacts repositories set-cleanup-policies blueforecast \
  --project=bluebikes-demand-predictor \
  --location=us-east1 \
  --policy='[{"name":"keep-5","action":{"type":"Keep"},"mostRecentVersions":{"packageNameFilter":".*","keepCount":5}}]'
```

---

## Live URLs

| Service | URL |
|---|---|
| API | `https://blueforecast-api-mem5htpgca-ue.a.run.app` |
| Dashboard | Check Cloud Run console for `blueforecast-dashboard` URL |
| Health check | `https://blueforecast-api-mem5htpgca-ue.a.run.app/api/health` |
