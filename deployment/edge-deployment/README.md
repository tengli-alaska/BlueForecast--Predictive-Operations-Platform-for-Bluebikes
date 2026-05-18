# BlueForecast — Edge Deployment

Lightweight edge deployment of the BlueForecast demand forecasting model. Converts the trained XGBoost model to ONNX format and serves predictions via a self-contained Docker container with **zero cloud dependencies** at runtime.

---

## Overview

The edge deployment enables BlueForecast's demand predictions to run on resource-constrained devices (Raspberry Pi, edge servers, IoT gateways) without requiring access to GCS, MLflow, or any cloud service. The entire inference stack fits in a single Docker image.

**Architecture:**
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
│  │         │                                │    │
│  │  ┌──────────────┐                        │    │
│  │  │ blueforecast │                        │    │
│  │  │    .onnx     │                        │    │
│  │  └──────────────┘                        │    │
│  └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

---

## Model Optimization

The XGBoost model is converted to ONNX (Open Neural Network Exchange) format for edge deployment:

| Aspect | XGBoost (Original) | ONNX (Edge) |
|--------|-------------------|-------------|
| File format | `.ubj` binary | `.onnx` |
| File size | 1.28 MB | 1.02 MB |
| Runtime dependency | xgboost, mlflow, GCS | onnxruntime only |
| Inference framework | Python xgboost | ONNX Runtime (C++ backend) |
| Cloud dependency | MLflow + GCS | None |
| Inference latency | ~5ms | **2.8ms** |

The ONNX conversion is validated automatically — predictions are compared between XGBoost and ONNX outputs with a max accepted difference of 0.01. Our validation result: **Max diff: 0.000001 (PASSED)**.

---

## Model Features (29 total)

The model uses 29 input features across 6 categories:

| Category | Features |
|----------|----------|
| **Station** | `start_station_id`, `capacity` |
| **Time** | `hour_of_day`, `day_of_week`, `month`, `year`, `is_weekend`, `is_holiday` |
| **Weather** | `temperature_c`, `precipitation_mm`, `wind_speed_kmh`, `humidity_pct`, `feels_like_c`, `weather_code`, `is_cold`, `is_hot`, `is_precipitation` |
| **Lag** | `demand_lag_1h`, `demand_lag_24h`, `demand_lag_168h` |
| **Rolling** | `rolling_avg_3h`, `rolling_avg_6h`, `rolling_avg_24h` |
| **Cyclical** | `hour_sin`, `hour_cos`, `dow_sin`, `dow_cos`, `month_sin`, `month_cos` |

Cyclical features are auto-computed by the inference server if not provided in the request.

---

## Prerequisites

- Python 3.10+
- Docker & Docker Compose
- Google Cloud SDK (`gcloud`) — only needed for model download, not runtime
- Access to `gs://bluebikes-demand-predictor-data` GCS bucket — only for initial setup

---

## Step-by-Step Replication

### 1. Clone and navigate

```bash
git clone https://github.com/tengli-alaska/BlueForecast--Predictive-Operations-Platform-for-Bluebikes.git
cd BlueForecast--Predictive-Operations-Platform-for-Bluebikes
git checkout feature/edge-deployment-chitra
cd edge-deployment
```

### 2. Install export dependencies

These are needed only once, on your dev machine, to convert the model:

```bash
pip install xgboost mlflow onnxruntime onnxmltools skl2onnx numpy fastapi uvicorn
```

### 3. Download the trained model from GCS

```bash
gsutil cp gs://bluebikes-demand-predictor-data/mlflow-artifacts/1/models/m-f014a08eca0c4a1494dcb2d3079a14f9/artifacts/model.ubj model/model.ubj
```

### 4. Export the model to ONNX

```bash
python export_to_onnx.py
```

Expected output:
```
Loading XGBoost model from model/model.ubj...
Converting to ONNX (num_features=29)...
ONNX conversion complete.
ONNX model saved: model/blueforecast.onnx
Validating ONNX model...
Validation — Max diff: 0.000001 | Mean diff: 0.000000
ONNX validation PASSED.
============================================================
EXPORT COMPLETE
  Source:     model/model.ubj (1.28 MB)
  ONNX:       model/blueforecast.onnx (1.02 MB)
  Validation: PASSED
============================================================
```

This produces:
- `model/blueforecast.onnx` — the optimized ONNX model
- `model/model_metadata.json` — feature names, metrics, validation results

### 5. Build and run the Docker container

```bash
# Using docker compose:
docker compose up --build

# Or directly:
docker run -p 8080:8080 edge-deployment-edge-inference:latest
```

### 6. Verify the deployment

Health check:
```bash
# Linux/Mac
curl http://localhost:8080/health

# Windows PowerShell
Invoke-RestMethod http://localhost:8080/health
```

Expected response:
```json
{
  "status": "healthy",
  "model_loaded": true,
  "model_format": "ONNX",
  "uptime_seconds": 10.5
}
```

Test prediction:
```bash
# Windows PowerShell
$body = @{
    start_station_id = 100; capacity = 19; hour_of_day = 8
    day_of_week = 1; month = 6; year = 2024
    is_weekend = 0; is_holiday = 0
    temperature_c = 22.5; precipitation_mm = 0.0
    wind_speed_kmh = 12.0; humidity_pct = 65.0
    feels_like_c = 21.0; weather_code = 0
    is_cold = 0; is_hot = 0; is_precipitation = 0
    demand_lag_1h = 5.0; demand_lag_24h = 8.0
    demand_lag_168h = 7.0; rolling_avg_3h = 4.5
    rolling_avg_6h = 5.2; rolling_avg_24h = 6.1
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri http://localhost:8080/predict -ContentType "application/json" -Body $body
```

Expected response:
```json
{
  "station_id": 100,
  "predicted_demand": 1.236,
  "prediction_timestamp": "2026-04-13T06:37:50.936357",
  "inference_time_ms": 2.8
}
```

### 7. Run tests

```bash
pip install pytest httpx
pytest tests/test_inference.py -v
```

Expected: **18 passed** covering feature schema, cyclical encoding, request conversion, ONNX model validation, and metadata validation.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check (model loaded, uptime) |
| GET | `/model-info` | Model metadata (run_id, metrics, validation) |
| POST | `/predict` | Single station-hour prediction |
| POST | `/predict/batch` | Batch prediction (multiple stations) |

---

## File Structure

```
edge-deployment/
├── Dockerfile              # Lightweight Docker image (python:3.11-slim)
├── docker-compose.yaml     # Container orchestration with resource limits
├── requirements.txt        # Runtime dependencies (onnxruntime, fastapi)
├── export_to_onnx.py       # Model export: XGBoost .ubj → ONNX
├── inference_server.py     # FastAPI inference server (no cloud deps)
├── config.yaml             # Configuration and model metadata
├── model/
│   ├── model.ubj                 # Source XGBoost model (from GCS)
│   ├── blueforecast.onnx         # Exported ONNX model
│   └── model_metadata.json       # Feature schema + metrics
├── tests/
│   └── test_inference.py   # 18 unit tests
└── README.md               # This file
```

---

## Docker Resource Limits

The container is configured for edge-friendly deployment:

| Resource | Limit |
|----------|-------|
| Memory | 512 MB |
| CPU | 1 core |
| Health check | Every 30s |
| Auto-restart | On failure |

---

## Connection to CI/CD

The edge deployment integrates with the existing GitHub Actions CI/CD pipeline:
1. When a new model version is approved in MLflow, the export script generates a new ONNX model
2. The Docker image is rebuilt with the updated model
3. The new image is deployed to edge devices

---

## Monitoring

The `/health` endpoint returns:
- `status`: healthy/unhealthy
- `model_loaded`: whether ONNX model is loaded
- `model_format`: ONNX
- `uptime_seconds`: server uptime

This endpoint is used by Docker's built-in HEALTHCHECK and can be monitored by external tools (Prometheus, Google Cloud Monitoring uptime checks).

---

## Training Metrics (Source Model)

| Metric | Value |
|--------|-------|
| Test RMSE | 1.2865 |
| Test MAE | 0.6510 |
| Test R² | 0.7022 |
| Validation Status | PASSED |
| Bias Status | PASSED |

---

## Edge vs Cloud Comparison

| Aspect | Cloud (Sruthilaya) | Edge (Chitra) |
|--------|-------------------|---------------|
| Deployment target | GCP Cloud Run | Docker on edge device |
| Model format | XGBoost via MLflow | ONNX Runtime |
| Data source | Live GCS reads | Self-contained |
| Scaling | Auto-scale 2–10 instances | Single instance |
| Internet required | Yes | No |
| Use case | Operations dashboard | Field devices, offline stations |
