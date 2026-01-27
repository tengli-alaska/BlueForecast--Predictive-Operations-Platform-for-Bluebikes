# BlueForecast

**Predictive Operations Platform for Bluebikes**

[![Python 3.9+](https://img.shields.io/badge/python-3.9+-blue.svg)](https://www.python.org/downloads/)

---

## Overview

BlueForecast is an end-to-end MLOps platform that predicts hourly bike demand across 600+ Bluebikes stations in the Boston metropolitan area, enabling operations teams to prevent stockouts and optimize rebalancing decisions.

### The Problem

Bike-sharing systems suffer from spatial demand imbalance—some stations run empty (stockouts) while others overflow. Operations teams currently make rebalancing decisions based on manual reports and real-time dock status, leading to delayed responses, inefficient truck routes, and lost revenue.

### Our Solution

BlueForecast combines real-time demand forecasting, automated drift detection, and intelligent route suggestions into a production-grade operations dashboard. The platform:

- Ingests live station data from GBFS API and weather conditions
- Generates hourly predictions using XGBoost
- Monitors for data and concept drift
- Automatically triggers retraining when model performance degrades
- Delivers actionable insights through an interactive Streamlit dashboard

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         DATA SOURCES                                │
├─────────────────┬──────────────────┬────────────────────────────────┤
│  Bluebikes S3   │    GBFS API      │     OpenWeatherMap API         │
│  (Historical)   │    (Real-time)   │     (Weather)                  │
└────────┬────────┴────────┬─────────┴───────────────┬────────────────┘
         │                 │                         │
         ▼                 ▼                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      FEATURE PIPELINE                               │
│  Lag features • Cyclical encoding • Weather join • Holiday flags    │
└────────────────────────────┬────────────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
       ┌──────────┐   ┌──────────┐   ┌──────────────┐
       │ Training │   │Inference │   │  Monitoring  │
       │ Pipeline │   │   API    │   │   Engine     │
       └──────────┘   └────┬─────┘   └──────┬───────┘
                           │                │
                           ▼                ▼
                    ┌─────────────────────────────┐
                    │    Operations Dashboard     │
                    │  (Streamlit + Mapbox)       │
                    └─────────────────────────────┘
```

---

## Installation

### Prerequisites

- Python 3.9+
- pip
- Docker (optional, for containerized deployment)

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/tengli-alaska/bluebikes-demand-predictor.git
   cd bluebikes-demand-predictor
   ```

2. **Create virtual environment**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and add your API keys:
   ```
   OPENWEATHERMAP_API_KEY=your_api_key_here
   DATABASE_URL=postgresql://user:password@localhost:5432/blueforecast
   ```

---

## Quick Start

### 1. Download Data

```bash
# Download historical trip data (2024)
python src/data_loader.py --download --year 2024

# Fetch current station metadata
python src/data_loader.py --fetch-stations
```

### 2. Feature Engineering

```bash
python src/features.py --input data/raw --output data/processed
```

### 3. Train Model

```bash
python src/model.py --train --config config/config.yaml
```

### 4. Run Inference API

```bash
uvicorn api.app:app --host 0.0.0.0 --port 8000
```

### 5. Launch Dashboard

```bash
streamlit run dashboard/ops_dashboard.py
```

Open http://localhost:8501 to view the operations dashboard.

---

## Project Structure

```
bluebikes-demand-predictor/
├── README.md
├── requirements.txt
├── .env.example
├── .gitignore
│
├── .github/workflows/
│   └── tests.yml                 # CI/CD pipeline
│
├── config/
│   └── config.yaml               # Hyperparameters, thresholds
│
├── data/
│   ├── raw/                      # Original data files
│   └── processed/                # Feature-engineered datasets
│
├── models/                       # Trained models, registry
│
├── src/
│   ├── __init__.py
│   ├── data_loader.py            # Data ingestion
│   ├── features.py               # Feature engineering
│   ├── model.py                  # Training & prediction
│   └── monitoring.py             # Drift detection
│
├── api/
│   ├── app.py                    # FastAPI service
│   └── schemas.py                # Request/response models
│
├── pipelines/
│   ├── training_pipeline.py
│   ├── inference_pipeline.py
│   └── monitoring_pipeline.py
│
├── dashboard/
│   └── ops_dashboard.py          # Streamlit app
│
├── tests/
│   └── test_features.py
│
└── docker/
    ├── Dockerfile
    └── docker-compose.yml
```

---

## API Documentation

### Predict Endpoint

**POST** `/predict`

Request:
```json
{
  "station_id": "67",
  "timestamp": "2024-12-15T08:00:00",
  "temperature": 45.2,
  "precipitation": 0.0,
  "wind_speed": 8.5
}
```

Response:
```json
{
  "station_id": "67",
  "timestamp": "2024-12-15T08:00:00",
  "predicted_demand": 23,
  "stockout_risk": "low",
  "confidence": 0.87
}
```

### Batch Predict

**POST** `/predict/batch`

Returns predictions for all 600+ stations for the next 12 hours.

### Health Check

**GET** `/health`

Returns API status and model version.

---

## Dashboard Features

| Feature | Description |
|---------|-------------|
| **Live Station Map** | Interactive Mapbox view with color-coded stockout/overfill risk |
| **Demand Forecast** | Hourly predictions for selected station (next 12 hours) |
| **High-Risk Stations** | Ranked list of stations needing immediate attention |
| **Rebalancing Routes** | Suggested pickup/dropoff route for rebalancing trucks |
| **Model Health** | Drift metrics, prediction accuracy, last retrain date |

---

## Configuration

### config.yaml

```yaml
model:
  type: xgboost
  n_estimators: 100
  max_depth: 6
  learning_rate: 0.1

features:
  lag_hours: [1, 3, 24, 168]  # 1h, 3h, 24h, 7d
  cyclical_encoding: true
  weather_features: [temperature, precipitation, wind_speed]

monitoring:
  drift_threshold: 0.15       # KL divergence threshold
  mae_increase_threshold: 0.25
  retrain_trigger_days: 14

api:
  gbfs_url: "http://gbfs.bluebikes.com/gbfs/gbfs.json"
  weather_api_key: ${OPENWEATHERMAP_API_KEY}
```

---

## Testing

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=src --cov-report=html

# Run specific test file
pytest tests/test_features.py -v
```

---

## Deployment

### Docker

```bash
# Build image
docker build -t blueforecast:latest -f docker/Dockerfile .

# Run container
docker run -p 8000:8000 -p 8501:8501 --env-file .env blueforecast:latest
```

### Docker Compose

```bash
docker-compose -f docker/docker-compose.yml up
```

### GCP Cloud Run

```bash
# Build and push to GCR
gcloud builds submit --tag gcr.io/PROJECT_ID/blueforecast

# Deploy
gcloud run deploy blueforecast \
  --image gcr.io/PROJECT_ID/blueforecast \
  --platform managed \
  --region us-east1 \
  --allow-unauthenticated
```

---

## Data Sources

| Source | URL |
|--------|-----|
| Bluebikes Historical Trips | https://s3.amazonaws.com/hubway-data/index.html |
| GBFS Real-Time API | http://gbfs.bluebikes.com/gbfs/gbfs.json |
| Station Metadata | https://bluebikes.com/system-data |
| Weather API | https://openweathermap.org/api |

*Trip data provided by Bluebikes under the [Bluebikes Data License Agreement](https://www.bluebikes.com/data-license-agreement).*

---

## Team

- [Team Member 1]
- [Team Member 2]
- [Team Member 3]
- [Team Member 4]
- [Team Member 5]

---

## License


---

## Acknowledgments

- Bluebikes for providing open trip data
- Blue Cross Blue Shield of Massachusetts (Bluebikes sponsor)
- OpenWeatherMap for weather API access
