# BlueForecast - Data Pipeline

**End-to-end Airflow data pipeline for Bluebikes demand prediction**

**Status:** All 9 tasks pass | 8,214,522 rows × 32 columns | 2023 + 2024 year data

---

## Pipeline DAG

```
download_raw_data
    └── clean_data
            ├── process_station_metadata ──┐
            ├── process_weather_data     ──┼── aggregate_demand
            └── process_holiday_calendar ──┘        └── run_feature_engineering
                                                            └── validate_schema
                                                                    └── detect_bias
```

**9 tasks** | **Parallel enrichment** (stations, weather, holidays run concurrently) | **Logging-based alerts** on every task

---

## Quick Start

### Prerequisites
- Python 3.10+
- Docker & Docker Compose
- Google Cloud SDK with access to `gs://bluebikes-demand-predictor-data`
- DVC (`pip install dvc[gs]`)

### 1. Clone and install

```bash
git clone https://github.com/tengli-alaska/BlueForecast--Predictive-Operations-Platform-for-Bluebikes.git
cd BlueForecast--Predictive-Operations-Platform-for-Bluebikes/Data-Pipeline
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure GCP credentials

```bash
gcloud auth application-default login
```

### 3. Start Airflow

```bash
docker compose up -d
# Airflow UI: http://localhost:8081
# Credentials: admin / admin
```

### 4. Run the pipeline

In the Airflow UI → find `bluebikes_data_pipeline` → click **Trigger DAG**.

Full run takes ~20–25 minutes (both years).

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

## Folder Structure

```
Data-Pipeline/
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
│   └── test_pipeline.py               # 35 unit tests
├── data/
│   ├── raw/
│   └── processed/
├── logs/                               # Airflow logs (auto-generated)
├── dvc.yaml                            # DVC pipeline definition
├── .dvc/                               # DVC configuration
├── docker-compose.yaml                 # Airflow + PostgreSQL
├── requirements.txt                    # Python dependencies
└── README.md                           # This file
```

---

## Data Sources

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
│   │   ├── 2023/csv/                     ← 9 monthly CSVs (Apr–Dec)
│   │   └── 2024/csv/                     ← 12 monthly CSVs (Jan–Dec)
│   ├── contextual/
│   └── metadata/
├── processed/
│   ├── cleaned/
│   │   ├── year=2023/cleaned.parquet     ← 3.16M rows (98.6% retained)
│   │   └── year=2024/cleaned.parquet     ← 4.72M rows (99.4% retained)
│   ├── stations/stations.parquet         ← ~595 stations
│   ├── weather/weather_hourly.parquet    ← ~15K hourly records
│   ├── features/
│   │   ├── hourly_demand_by_station.parquet  ← 8.2M station-hour rows
│   │   └── feature_matrix.parquet        ← 8.2M rows × 32 cols (ML-ready)
│   └── reports/
│       └── bias_report.json              ← Bias detection output
└── data/
    └── contextual/
        └── us_holidays_2023_2024.parquet
```

---

## Pipeline Stages

### Stage 1  Data Acquisition (`download_raw_data`)
Downloads raw BlueBikes trip CSVs from GCS. Supports CSV and ZIP formats with automatic fallback.

### Stage 2  Data Cleaning (`clean_data`)
Removes duplicates (by ride_id), null critical fields, duration outliers (<1 min or >24 hours). Standardizes text, adds derived time columns. Retention: ~99%.

### Stage 3  Parallel Enrichment (optimized)
Three tasks run concurrently:
- **Station metadata** — GBFS API (~595 stations with capacity)
- **Weather data** — Open-Meteo API (temperature, precipitation, wind, humidity)
- **Holiday calendar** — 24 US Federal holidays including Patriots Day (MA)

### Stage 4  Aggregate Demand (`aggregate_demand`)
Converts 7.88M trips → hourly pickup counts per station. UTC → Eastern Time. Complete 534-station × 15,383-hour grid with zero-demand fill (68.6% sparsity). Memory-optimized with selective column loading and downcasted dtypes.

### Stage 5  Feature Engineering (`run_feature_engineering`)
Joins all sources. Adds lag features (1h, 24h, 168h), rolling averages (3h, 6h, 24h), cyclical time encodings (sin/cos). Station capacity resolved via name match (491) + coordinate match (38) + median fill (5). Output: 8,214,522 rows × 32 columns, zero nulls.

### Stage 6  Schema Validation (`validate_schema`)
Automated data quality gate:
- Column presence and data types
- Value ranges (demand ≥ 0, temp -40°C to 50°C, hour 0–23)
- Zero null enforcement
- No duplicate (station, hour) pairs
- Minimum row count check
- **Pipeline fails on any violation**

### Stage 7  Bias Detection (`detect_bias`)
Data slicing across 6 dimensions with disparity ratios:

| Slice | Disparity Ratio | Flags |
|-------|----------------|-------|
| Time of day (peak/off-peak/night) | 2.21x | — |
| Day type (weekday/weekend/holiday) | 1.41x | — |
| Season (spring/summer/fall/winter) | 2.44x | — |
| Station capacity (low/mid/high) | 10.21x | ⚠ High disparity, low_cap underrepresented |
| Precipitation (dry/rainy) | 1.19x | — |
| Temperature (cold/mild/hot) | 3.12x | — |

---

## Bias Mitigation

### Detected Biases
1. **Station capacity disparity (10.21x)** — High-capacity stations get 10x more demand than low-capacity
2. **Low-capacity underrepresentation (0.37%)** — Only 2 stations in the low-cap bucket
3. **Seasonal imbalance** — Winter has 19% of data vs summer 28.7%
4. **Temperature effect** — Cold conditions show 3x less demand than hot

### Mitigation Steps
1. **Zero-demand fill** — Complete station × hour grid ensures all time slots represented
2. **Cyclical time encodings** — sin/cos preserves circular relationships (hour 23 ≈ hour 0)
3. **Lag features (1h, 24h, 168h)** — Captures recurring patterns across time scales
4. **Weather as explicit features** — Model learns weather-dependent demand patterns
5. **Station capacity as feature** — Enables demand predictions relative to station size
6. **Bias monitoring** — JSON report saved to GCS, trackable over time

---

## Anomaly Detection & Alerts

- **Logging-based alert callbacks** on every task (failure + success)
- **Schema validation** acts as automated anomaly gate — pipeline stops on bad data
- Alerts log: task ID, execution date, exception, log URL

---

## Pipeline Flow Optimization

Identified via Airflow Gantt chart:
- **Parallel execution** — Stations, weather, holidays run concurrently after cleaning
- **Memory optimization** — Column-selective loading, `gc.collect()`, int8/int16/int32 dtypes
- **Selective reads** — Only required columns loaded during aggregation and station lookup

---

## Testing

35 unit tests covering all modules:

```
TestDataCleaning (7)       — dedup, nulls, duration, text, edge cases
TestHolidayCalendar (8)    — count, dates, categories, duplicates
TestAggregateDemand (4)    — groupby, zero-fill, grid, time features
TestFeatureEngineering (6) — lags, rolling avg, cyclical encoding, holidays
TestSchemaValidation (6)   — columns, nulls, ranges, duplicates
TestBiasDetection (4)      — disparity ratios, underrepresentation, slicing
```

```bash
pytest tests/test_pipeline.py -v
```

---

## Data Versioning (DVC)

```bash
dvc remote list
# gcs_remote    gs://bluebikes-demand-predictor-data
```

`dvc.yaml` defines full pipeline with stage dependencies:
- `dvc repro`  reproduce end-to-end
- `dvc push` / `dvc pull`  sync with GCS
- Git tracks code, DVC tracks data

---

## Error Handling

- `RuntimeError` with descriptive messages when inputs missing
- Airflow retries: 1 attempt, 5-minute delay
- Alert callbacks on every failure with full context
- Schema validation halts pipeline on quality issues
- ZIP fallback for compressed raw files

---

## Known Issues & Fixes

| Issue | Fix |
|-------|-----|
| Raw path mismatch (`raw/historical/` vs `raw/trips/`) | Updated paths in `data_cleaning.py` |
| `aggregate_demand` OOM (return code -9) | Column-selective loading, `gc.collect()`, int8/16 dtypes |
| `feature_engineering` OOM on 8.2M rows | Free DataFrames after joins, selective column reads |
| Missing `scipy` in Docker | Added to docker-compose pip install |
| Weather nulls at date range edges (2,136 rows) | Forward-fill + back-fill after join |
| `is_precipitation/is_cold/is_hot` dtype float after fill | Schema updated to accept `numeric` |
| Alert callback logging bug (repeated message) | Simplified to single-line format string |

---

## Feature Matrix (ML Ready Output)

| Feature Group | Columns |
|---------------|---------|
| **Target** | `demand_count` |
| **Lag** | `demand_lag_1h`, `demand_lag_24h`, `demand_lag_168h` |
| **Rolling** | `rolling_avg_3h`, `rolling_avg_6h`, `rolling_avg_24h` |
| **Weather** | `temperature_c`, `precipitation_mm`, `wind_speed_kmh`, `humidity_pct`, `feels_like_c`, `is_cold`, `is_hot`, `is_precipitation` |
| **Time** | `hour_of_day`, `day_of_week`, `month`, `year`, `is_weekend`, `is_holiday` |
| **Cyclical** | `hour_sin`, `hour_cos`, `dow_sin`, `dow_cos`, `month_sin`, `month_cos` |
| **Station** | `start_station_id`, `capacity` |

8,214,522 rows × 32 columns | Zero nulls | Ready for model training

---

## Reproducibility

1. Clone repo → `cd Data-Pipeline`
2. `pip install -r requirements.txt`
3. `gcloud auth application-default login`
4. `docker compose up -d`
5. Trigger DAG in Airflow UI (http://localhost:8081)
6. Verify: `pytest tests/test_pipeline.py -v` (35 passed)
7. `dvc pull` to fetch data, or `dvc repro` to regenerate
