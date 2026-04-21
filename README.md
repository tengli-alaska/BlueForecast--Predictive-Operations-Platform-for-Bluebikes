# BlueForecast

**Predictive Operations Platform for Bluebikes**

[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)

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
│  Bluebikes S3   │    GBFS API      │      Open-Meteo API            │
│  (Historical)   │    (Real-time)   │      (Weather)                 │
└────────┬────────┴────────┬─────────┴───────────────┬────────────────┘
         │                 │                         │
         ▼                 ▼                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    DATA PIPELINE (Airflow DAG)                       │
│  download → clean → [stations, weather, holidays] → aggregate       │
│  → feature engineering → schema validation → bias detection          │
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

## Data Pipeline

The data pipeline is the foundation of BlueForecast. It transforms raw trip data into a clean, validated, feature-engineered dataset ready for ML model training. Orchestrated by Apache Airflow with data versioning via DVC.

### Pipeline DAG

```
download_raw_data
    └── clean_data
            ├── process_station_metadata ──┐
            ├── process_weather_data     ──┼── aggregate_demand
            └── process_holiday_calendar ──┘        └── run_feature_engineering
                                                            └── validate_schema
                                                                    └── detect_bias
```

**9 tasks** | **Parallel enrichment** for optimized execution | **Logging-based alerts** on every task

### Data Sources

| Source | Type | Records | Coverage |
|--------|------|---------|----------|
| BlueBikes trip data | Historical CSV | ~7.88M trips | Apr 2023 – Dec 2024 |
| Open-Meteo weather | Historical API | ~15K hourly | Apr 2023 – Dec 2024 |
| GBFS station info | Live API | ~595 stations | Current snapshot |
| US Federal holidays | Static | 24 holidays | 2023–2024 |

### GCS Data Layout

```
gs://bluebikes-demand-predictor-data/
├── raw/
│   ├── trips/
│   │   ├── 2023/
│   │   │   ├── *.zip                          ← Raw monthly archives
│   │   │   └── csv/                           ← Extracted CSVs (Apr–Dec)
│   │   └── 2024/
│   │       ├── *.zip
│   │       └── csv/                           ← Extracted CSVs (Jan–Dec)
│   ├── contextual/
│   │   ├── weather/
│   │   └── holiday/
│   └── metadata/
│       └── stations/
├── processed/
│   ├── cleaned/
│   │   ├── year=2023/cleaned.parquet          ← 3.16M rows (98.6% retained)
│   │   └── year=2024/cleaned.parquet          ← 4.72M rows (99.4% retained)
│   ├── stations/stations.parquet              ← ~595 stations
│   ├── weather/weather_hourly.parquet         ← ~15K hourly records
│   ├── features/
│   │   ├── hourly_demand_by_station.parquet   ← 8.2M station-hour rows
│   │   └── feature_matrix.parquet             ← 8.2M rows × 32 columns
│   └── reports/
│       └── bias_report.json                   ← Bias detection results
└── data/
    └── contextual/
        └── us_holidays_2023_2024.parquet      ← 24 holidays
```

### Pipeline Stages

**Stage 1 — Data Acquisition:** Downloads raw BlueBikes trip CSVs from GCS. Supports both CSV and ZIP formats with automatic fallback.

**Stage 2 — Data Cleaning:** Removes duplicates (by ride_id), null critical fields, and duration outliers (<1 min or >24 hours). Standardizes text fields, adds derived time columns. Retention rate: ~99%.

**Stage 3 — Parallel Enrichment (optimized):** Three independent tasks run concurrently:
- Station metadata from GBFS API (~595 stations with capacity)
- Historical hourly weather from Open-Meteo (temperature, precipitation, wind, humidity)
- US Federal holiday calendar including Patriots Day (MA-specific)

**Stage 4 — Aggregate Demand:** Converts 7.88M trips → hourly pickup counts per station. Converts UTC → Eastern Time. Builds complete 534-station × 15,383-hour grid with zero-demand fill (68.6% sparsity).

**Stage 5 — Feature Engineering:** Joins all data sources. Adds lag features (1h, 24h, 168h), rolling averages (3h, 6h, 24h), and cyclical time encodings (sin/cos for hour, day-of-week, month). Station capacity resolved via name match + coordinate match + median fill. Output: ~8.2M rows × 32 columns, zero nulls.

**Stage 6 — Schema Validation:** Automated data quality gate. Checks column presence, data types, value ranges (demand ≥ 0, temperature -40°C to 50°C, hour 0–23), zero nulls, no duplicate (station, hour) pairs, and minimum row count. Pipeline fails if any check fails.

**Stage 7 — Bias Detection:** Analyzes demand disparities across 6 slicing dimensions: time of day, weekday/weekend/holiday, season, station capacity, precipitation, and temperature. Computes disparity ratios and flags underrepresented groups. Outputs JSON report to GCS.

### Bias Detection & Mitigation

**Detected biases:**
1. Peak hours show significantly higher demand than night hours (disparity ratio > 5x)
2. Winter months are underrepresented compared to summer due to seasonal ridership
3. Low-capacity stations have lower mean demand
4. Rainy/cold conditions have different demand patterns and lower representation

**Mitigation steps taken:**
1. **Zero-demand fill** — Complete station × hour grid ensures all time slots are represented, preventing model from only learning high-demand periods
2. **Temporal feature engineering** — Cyclical encodings preserve circular relationships (hour 23 ≈ hour 0). Lag features (1h, 24h, 168h) capture recurring patterns across time scales
3. **Weather conditioning** — Weather features included as explicit model inputs, allowing the model to learn weather-dependent demand rather than treating low-demand weather as noise
4. **Capacity normalization** — Station capacity included as a feature, enabling demand predictions relative to station size
5. **Monitoring** — Bias report saved to GCS and trackable over time to detect representation drift

### Anomaly Detection & Alerts

- Logging-based alert callbacks on every task (failure + success)
- Schema validation acts as automated anomaly gate — pipeline stops on data quality issues
- Alerts include DAG ID, task ID, execution date, exception details, and log URL

### Pipeline Flow Optimization

Identified via Airflow Gantt chart:
- Station metadata, weather, and holidays run in **parallel** (no mutual dependencies)
- Memory optimized: column-selective loading, garbage collection, downcasted dtypes (int8/int16/int32)
- Selective column reads during aggregation to reduce peak memory

### Known Issues & Fixes

| Issue | Fix Applied |
|-------|-------------|
| Raw data path mismatch (`raw/historical/` vs `raw/trips/`) | Updated `data_cleaning.py` paths to `raw/trips/{year}/csv/` |
| `clean_data` succeeded but produced no output | Root cause: raw CSVs were at different path than expected |
| `aggregate_demand` OOM killed (return code -9) | Added column-selective loading, `gc.collect()`, int8/16 dtypes |
| `feature_engineering` failed silently | Missing `scipy` in Docker — added to docker-compose |
| `humidity_pct` and `weather_code` dtype mismatch | Updated schema validation to accept `numeric` (int or float) |
| `SettingWithCopyWarning` in data cleaning | Cosmetic — does not affect output |

---

## Project Structure

```
bluebikes-demand-predictor/
├── dags/
│   └── bluebikes_pipeline.py           # Airflow DAG (9 tasks, alerts, parallel)
├── src/
│   ├── pipeline_tasks.py               # Task delegation layer
│   └── data_processing/
│       ├── data_cleaning.py            # Raw CSV → cleaned parquet
│       ├── station_metadata.py         # GBFS API → station parquet
│       ├── weather_data.py             # Open-Meteo → weather parquet
│       ├── holiday_calendar.py         # Holiday calendar generation
│       ├── aggregate_demand.py         # Trips → hourly station demand grid
│       ├── feature_engineering.py      # Join sources + lag/rolling/cyclical
│       ├── schema_validation.py        # Schema, type, range, null validation
│       └── bias_detection.py           # Data slicing + disparity analysis
├── tests/
│   ├── conftest.py
│   └── test_pipeline.py               # 35 unit tests across all modules
├── config/
│   └── config.yaml
├── data/
│   ├── raw/
│   └── processed/
├── logs/                               # Airflow task logs (auto-generated)
├── models/
├── notebooks/development/
├── dashboard/
├── pipelines/
├── scripts/
├── .dvc/                               # DVC configuration
├── dvc.yaml                            # DVC pipeline definition
├── docker-compose.yaml                 # Airflow + PostgreSQL environment
├── requirements.txt                    # Python dependencies
└── README.md
```

---

## Quick Start

### Prerequisites

- Python 3.10+
- Docker & Docker Compose
- Google Cloud SDK (`gcloud`) with access to GCS bucket
- DVC (`pip install dvc[gs]`)

### 1. Clone and install

```bash
git clone https://github.com/tengli-alaska/BlueForecast--Predictive-Operations-Platform-for-Bluebikes.git
cd BlueForecast--Predictive-Operations-Platform-for-Bluebikes
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure GCP credentials

```bash
gcloud auth application-default login
# Ensure access to gs://bluebikes-demand-predictor-data
```

### 3. Start Airflow

```bash
docker compose up -d
# Airflow UI: http://localhost:8080
# Default credentials: admin / admin
```

### 4. Run the data pipeline

In the Airflow UI → find `bluebikes_data_pipeline` → click **Trigger DAG**.

The pipeline runs 9 tasks in dependency order (~15–20 min for full run).

### 5. Run tests

```bash
pytest tests/test_pipeline.py -v
# Expected: 35 passed
```

### 6. DVC

```bash
dvc remote list              # Verify GCS remote
dvc repro                    # Reproduce pipeline
dvc push                     # Push data to remote
```

---

## Testing

35 unit tests covering all pipeline modules:

```
TestDataCleaning (7)      — dedup, nulls, duration filters, text, edge cases
TestHolidayCalendar (8)   — count, dates, categories, duplicates
TestAggregateDemand (4)   — groupby, zero-fill, grid, time features
TestFeatureEngineering (6) — lags, rolling avg, cyclical encoding, holidays
TestSchemaValidation (6)  — columns, nulls, ranges, duplicates
TestBiasDetection (4)     — disparity ratios, underrepresentation, slicing
```

```bash
pytest tests/test_pipeline.py -v
```

---

## Data Versioning (DVC)

DVC is configured with GCS as the remote storage backend:

```bash
dvc remote list
# gcs_remote    gs://bluebikes-demand-predictor-data
```

`dvc.yaml` defines the full pipeline with stage dependencies, enabling:
- `dvc repro` — reproduce the pipeline end-to-end
- `dvc push` / `dvc pull` — sync data with GCS remote
- Git tracks code + DVC tracks data for full reproducibility

---

## Feature Matrix (ML-Ready Output)

The data pipeline produces a feature matrix at `processed/features/feature_matrix.parquet`:

| Feature Group | Columns |
|---------------|---------|
| **Target** | `demand_count` |
| **Lag features** | `demand_lag_1h`, `demand_lag_24h`, `demand_lag_168h` |
| **Rolling averages** | `rolling_avg_3h`, `rolling_avg_6h`, `rolling_avg_24h` |
| **Weather** | `temperature_c`, `precipitation_mm`, `wind_speed_kmh`, `humidity_pct`, `feels_like_c`, `is_cold`, `is_hot`, `is_precipitation` |
| **Time** | `hour_of_day`, `day_of_week`, `month`, `year`, `is_weekend`, `is_holiday` |
| **Cyclical** | `hour_sin`, `hour_cos`, `dow_sin`, `dow_cos`, `month_sin`, `month_cos` |
| **Station** | `start_station_id`, `capacity` |

~8.2M rows × 32 columns | Zero nulls | Ready for model training

---

## Data Sources

| Source | URL |
|--------|-----|
| Bluebikes Historical Trips | https://s3.amazonaws.com/hubway-data/index.html |
| GBFS Real-Time API | https://gbfs.bluebikes.com/gbfs/en/station_information.json |
| Station Metadata | https://bluebikes.com/system-data |
| Open-Meteo Weather | https://archive-api.open-meteo.com/v1/archive |

*Trip data provided by Bluebikes under the [Bluebikes Data License Agreement](https://www.bluebikes.com/data-license-agreement).*

---

## Error Handling

- Every module raises `RuntimeError` with descriptive messages when inputs are missing
- Airflow retries failed tasks once (`retries=1`, `retry_delay=5min`)
- Logging-based alert callbacks on every task failure with full context
- Schema validation halts the pipeline on data quality issues
- ZIP fallback in data cleaning handles both CSV and compressed raw files

---

## Deployment

The full deployment pipeline (Cloud Run, edge inference, CI/CD, monitoring) is documented in [`deployment-pipeline/README.md`](deployment-pipeline/README.md).

### Quick summary

| Component | Where it runs | How it's deployed |
|-----------|--------------|-------------------|
| FastAPI inference API | GCP Cloud Run | Auto-deployed on push to `main` via GitHub Actions |
| Next.js operations dashboard | GCP Cloud Run | Auto-deployed on push to `main` via GitHub Actions |
| Prediction refresh | GCS | Scheduled every 6h via GitHub Actions cron |
| Model monitoring + retraining | GCP + MLflow | Scheduled weekly; also manual dispatch |
| Edge inference server | Any device | Docker + ONNX, zero cloud dependencies |

### Replication steps (abbreviated)

```bash
# 1. Set up GCP service account and GitHub secrets (one-time)
#    See deployment-pipeline/README.md Section 10 for full commands

# 2. Push to main — dashboard deploys automatically via GitHub Actions

# 3. Verify
gcloud run services list --region=us-east1
curl "$(gcloud run services describe blueforecast-api \
  --region=us-east1 --format='value(status.url)')/api/health"
```

For complete step-by-step instructions including GCP setup, secrets configuration, edge deployment, and validation, see **[deployment-pipeline/README.md → Section 10](deployment-pipeline/README.md#10-step-by-step-replication-guide-fresh-environment)**.

---

## Reproducibility

To replicate the full project on a new machine:

### Data pipeline
1. Clone the repo and install dependencies (`requirements.txt`)
2. Set up GCP credentials (`gcloud auth application-default login`)
3. Start Airflow (`docker compose up -d`)
4. Trigger the DAG from the Airflow UI
5. Verify with `pytest tests/test_pipeline.py -v`
6. Use `dvc pull` to fetch data from GCS, or `dvc repro` to regenerate

### Model training
See [`Model-Pipeline/README.md`](Model-Pipeline/README.md) for training, evaluation, and HPO steps.

### Deployment
See [`deployment-pipeline/README.md`](deployment-pipeline/README.md) for cloud deployment, edge inference, CI/CD, and monitoring replication.

All code, configuration, and pipeline definitions are version-controlled. Data is versioned separately via DVC with GCS remote.

---

## Team

BlueForecast — MLOps Course Project Group 20

---

## Acknowledgments

- Bluebikes for providing open trip data
- Blue Cross Blue Shield of Massachusetts (Bluebikes sponsor)
- Open-Meteo for free weather API access
