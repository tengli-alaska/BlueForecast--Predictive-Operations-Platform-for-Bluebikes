# BlueForecast — Edge Deployment

Lightweight edge deployment of the BlueForecast demand forecasting model. Converts the trained XGBoost model to ONNX format and serves predictions via a self-contained Docker container with **zero cloud dependencies** at runtime.

---

## Overview

The edge deployment enables BlueForecast's demand predictions to run on resource-constrained devices (Raspberry Pi, edge servers, IoT gateways) without requiring access to GCS, MLflow, or any cloud service. The entire inference stack fits in a ~200MB Docker image.

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
| Runtime dependency | xgboost, mlflow, GCS | onnxruntime only |
| Inference framework | Python xgboost | ONNX Runtime (C++) |
| Cloud dependency | MLflow tracking server | None |
| Deployment size | ~500MB+ with dependencies | ~200MB Docker image |
| Inference speed | Good | Faster (optimized C++ backend) |

The conversion process validates that ONNX predictions match XGBoost predictions within a tolerance of 0.01 MAE.

---

## Prerequisites

- Python 3.10+
- Docker & Docker Compose
- Google Cloud SDK (`gcloud`) — only needed for model export, not runtime
- Access to the `gs://bluebikes-demand-predictor-data` GCS bucket — only for export

---

## Step-by-Step Replication

### 1. Clone and navigate

```bash
git clone https://github.com/tengli-alaska/BlueForecast--Predictive-Operations-Platform-for-Bluebikes.git
cd BlueForecast--Predictive-Operations-Platform-for-Bluebikes/edge-deployment
```

### 2. Install export dependencies

These are needed only once, on your dev machine, to convert the model:

```bash
pip install xgboost mlflow onnxruntime onnxmltools skl2onnx numpy
```

### 3. Export the model to ONNX

The export script pulls the champion model from MLflow and converts it:

```bash
# If using local MLflow (mlruns/ directory):
python export_to_onnx.py

# If using Docker MLflow server:
set MLFLOW_TRACKING_URI=http://localhost:5000   # Windows
export MLFLOW_TRACKING_URI=http://localhost:5000 # Mac/Linux
python export_to_onnx.py

# Or specify a specific run ID:
python export_to_onnx.py --run-id 7a8b836caadb47b29215eeeb1c440734
```

This produces:
- `model/blueforecast.onnx` — the optimized ONNX model
- `model/model_metadata.json` — feature names, metrics, validation results

### 4. Build the Docker image

```bash
docker build -t blueforecast-edge .
```

### 5. Run the container

```bash
# Using docker compose:
docker compose up

# Or directly:
docker run -p 8080:8080 blueforecast-edge
```

### 6. Verify the deployment

```bash
# Health check
curl http://localhost:8080/health

# Model info
curl http://localhost:8080/model-info

# Test prediction
curl -X POST http://localhost:8080/predict \
  -H "Content-Type: application/json" \
  -d '{
    "start_station_id": 100,
    "capacity": 19,
    "hour_of_day": 8,
    "day_of_week": 1,
    "month": 6,
    "year": 2024,
    "is_weekend": 0,
    "is_holiday": 0,
    "temperature_c": 22.5,
    "precipitation_mm": 0.0,
    "wind_speed_kmh": 12.0,
    "humidity_pct": 65.0,
    "feels_like_c": 21.0,
    "is_cold": 0,
    "is_hot": 0,
    "is_precipitation": 0,
    "demand_lag_1h": 5.0,
    "demand_lag_24h": 8.0,
    "demand_lag_168h": 7.0,
    "rolling_avg_3h": 4.5,
    "rolling_avg_6h": 5.2,
    "rolling_avg_24h": 6.1
  }'
```

### 7. Run tests

```bash
pip install pytest httpx
pytest tests/test_inference.py -v
```

Expected: 25+ tests covering feature schema, cyclical encoding, request conversion, ONNX model validation, API endpoints, and metadata validation.

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
├── export_to_onnx.py       # Model export: MLflow XGBoost → ONNX
├── inference_server.py     # FastAPI inference server (no cloud deps)
├── config.yaml             # Configuration and model metadata
├── model/                  # ONNX model output directory
│   ├── blueforecast.onnx         # Exported ONNX model (after running export)
│   └── model_metadata.json       # Feature schema + metrics (after running export)
├── tests/
│   └── test_inference.py   # 25+ unit tests
└── README.md               # This file
```

---

## Connection to CI/CD

The edge deployment integrates with the existing GitHub Actions CI/CD pipeline. When a new model version is pushed and approved in MLflow:
1. The export script can be triggered to generate a new ONNX model
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

## Training Metrics (Champion Model)

| Metric | Value |
|--------|-------|
| Test RMSE | 1.2865 |
| Test MAE | 0.6510 |
| Test R² | 0.7022 |
| Validation Status | PASSED |
| Bias Status | PASSED |
| Run ID | 7a8b836caadb47b29215eeeb1c440734 |
