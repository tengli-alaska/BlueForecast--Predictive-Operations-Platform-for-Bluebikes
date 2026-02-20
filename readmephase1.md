# BlueForecast — Predictive Operations Platform for Bluebikes
## Data Pipeline README — `bluebikes_pipeline` DAG

**Last Updated:** February 20, 2026  
**Status:** Phase 1 + Phase 2 Complete ✅  
**Backfill:** 2023 (Apr–Dec) + 2024 (Jan–Dec) fully processed ✅

---

## What This Pipeline Does

This is the **data pipeline DAG** (`bluebikes_pipeline`) for the BlueForecast MLOps system. Its sole responsibility is to take raw input data and produce a clean, validated, feature-engineered dataset ready for ML model training.

It is intentionally separate from the ML training pipeline (`bluebikes_ml_pipeline`, Phase 3) because data processing and model training have different failure modes, schedules, and owners. You can rerun data cleaning without retraining the model, and vice versa.

---

## Pipeline Architecture

### Full DAG Graph

```
create_cluster (ephemeral e2-standard-2)
    └── raw_ingestion
            └── validate_raw_schema
                    └── cleaning_job
                            ├── ingest_stations ──┐
                            ├── ingest_weather  ──┼── demand_aggregation
                            └── ingest_holidays ──┘        └── feature_engineering
                                                                    └── delete_cluster [ALL_DONE]
```

### Design Decisions and Reasoning

**Why ephemeral clusters?**  
A persistent cluster running 24/7 costs ~$150/month minimum. An ephemeral `e2-standard-2` cluster costs ~$0.08/hour. For a pipeline that runs occasionally, ephemeral clusters are the only budget-safe choice. The cluster is created at the start of every DAG run and deleted at the end — even if tasks fail (`trigger_rule=ALL_DONE`).

**Why single-node?**  
The data volume (2 years of Bluebikes trips, ~5M rows) fits comfortably on a single node. Multi-node clusters add orchestration overhead and cost without benefit at this scale.

**Why linear dependencies for trips, parallel for reference data?**  
Trips must flow sequentially: raw CSV → schema-enforced Parquet → validated → cleaned. Each step depends on the previous one's output. Reference data (stations, weather, holidays) is independent of trips and independent of each other, so they run in parallel after cleaning to save time. All three must complete before aggregation because aggregation joins against them.

**Why Parquet at every stage?**  
Parquet is columnar, compressed, and splittable. CSV is none of those things. Converting to Parquet at the earliest stage (`raw_enforced/`) means every downstream job reads faster, uses less memory, and costs less to run.

**Why no `inferSchema`?**  
`inferSchema=True` scans the entire dataset before processing, doubling read time. It also guesses wrong on edge cases (e.g., station IDs that look like integers). Every job uses explicit schemas.

**Why skip logic in every job?**  
Every Spark job checks if its output already exists before doing any work. If it does, it exits immediately with `[SKIP]`. This means re-running the pipeline after a partial failure only processes what's missing — not the entire dataset. Pass `--force` to override and reprocess.

**Why separate DAGs for data, features, and ML?**  
- `bluebikes_pipeline` — data ingestion, cleaning, reference data, aggregation, feature engineering
- `bluebikes_ml_pipeline` (Phase 3) — model training, evaluation, registry
- Separate DAGs can be triggered, retried, and scheduled independently
- A data bug shouldn't require retraining the model
- An ML experiment shouldn't require reprocessing raw data

---

## Infrastructure

| Component | Value |
|---|---|
| GCP Project | `bluebikes-demand-predictor` |
| Region | `us-central1` |
| Zone | `us-central1-a` |
| Cluster type | Single-node, `e2-standard-2`, 50GB pd-standard |
| Dataproc image | `2.1-debian11` |
| Cluster name | `bb-{ds_nodash}-{try_number}` (unique per run) |
| GCS Bucket | `bluebikes-demand-predictor-data` |
| Airflow version | 2.9.3 |
| Airflow connection | `google_cloud_dataproc` (type: `google_cloud_platform`) |
| GCP Auth | Application Default Credentials via `GOOGLE_APPLICATION_CREDENTIALS` |

---

## GCS Data Layout

```
gs://bluebikes-demand-predictor-data/
│
├── raw/                               ← SOURCE DATA (do not modify)
│   ├── trips/
│   │   ├── 2023/
│   │   │   ├── 202302-bluebikes-tripdata.zip
│   │   │   ├── ...
│   │   │   └── csv/                   ← Extracted CSVs
│   │   └── 2024/
│   │       ├── 202401-bluebikes-tripdata.zip
│   │       ├── ...
│   │       └── csv/                   ← Extracted CSVs
│   ├── contextual/
│   │   ├── weather/
│   │   │   └── weather_hourly_2023_2024.csv
│   │   └── holiday/
│   │       └── us_holidays_2023_2024.csv
│   └── metadata/
│       └── stations/
│           ├── stations.csv
│           ├── station_capacity_lookup.csv
│           └── station_capacity_lookup.parquet
│
├── raw_enforced/                      ← STAGE 1: Schema-enforced Parquet
│   └── trips/
│       ├── year=2023/
│       │   ├── month=4/ ... month=12/
│       └── year=2024/
│           ├── month=1/ ... month=12/
│
├── cleaned/                           ← STAGE 2: Cleaned trips
│   └── trips/
│       ├── year=2023/
│       │   ├── month=04/ ... month=12/
│       └── year=2024/
│           ├── month=01/ ... month=12/
│
├── processed/                         ← STAGE 3: Reference data
│   ├── stations/
│   │   └── stations.parquet/
│   ├── weather/
│   │   └── weather_hourly.parquet/
│   └── holidays/
│       └── holidays.parquet/
│
├── aggregated/                        ← STAGE 4: Hourly demand grid
│   └── demand/
│       ├── year=2023/
│       │   ├── month=04/ ... month=12/
│       └── year=2024/
│           ├── month=01/ ... month=12/
│
├── features/                          ← STAGE 5: ML feature matrix
│   └── feature_matrix/
│       ├── year=2023/
│       └── year=2024/
│
├── logs/
│   └── validate_raw_schema/
│       └── {run_date}/report.json     ← Schema validation reports
│
└── jobs/                              ← Spark scripts
    ├── raw_ingestion.py
    ├── validate_raw_schema.py
    ├── production_cleaning_pipeline.py
    ├── ingest_stations.py
    ├── ingest_weather.py
    ├── ingest_holidays.py
    ├── production_demand_aggregation.py
    └── production_feature_engineering.py
```

---

## Spark Jobs Reference

### 1. `raw_ingestion.py`
- **What it does:** Reads raw trip CSVs, enforces explicit schema, adds timestamp columns, writes Parquet partitioned by year/month
- **Input:** `raw/trips/{year}/csv/*.csv`
- **Output:** `raw_enforced/trips/year={y}/month={m}/`
- **Skip logic:** Skips if `raw_enforced/trips/year={year}/_SUCCESS` exists
- **Args:** `--year`, `--bucket`, `--force`

### 2. `validate_raw_schema.py`
- **What it does:** Reads raw_enforced Parquet, checks schema has expected 15+ fields, checks minimum row count, writes JSON report
- **Input:** `raw_enforced/trips/`
- **Output:** `logs/validate_raw_schema/{run_date}/report.json`
- **Fails job** if validation does not pass
- **Args:** `--bucket`, `--run_date`

### 3. `production_cleaning_pipeline.py`
- **What it does:** Per-month cleaning — deduplication, null filtering, trip duration bounds (60s–86400s), timestamp parsing, derived time features
- **Input:** `raw_enforced/trips/year={y}/month={m}/`
- **Output:** `cleaned/trips/year={y}/month={m}/`
- **Skip logic:** Per-month skip if `_SUCCESS` exists
- **Args:** `--mode` (incremental/backfill/demo), `--start_yyyymm`, `--end_yyyymm`, `--bucket`, `--run_id`, `--force`

### 4. `ingest_stations.py`
- **What it does:** Reads raw stations CSV, enforces schema, deduplicates by station_id, writes Parquet
- **Input:** `raw/metadata/stations/stations.csv`
- **Output:** `processed/stations/stations.parquet/`
- **Skip logic:** Skips if output `_SUCCESS` exists
- **Args:** `--bucket`, `--force`

### 5. `ingest_weather.py`
- **What it does:** Reads raw weather CSV, enforces schema, deduplicates by datetime, writes Parquet
- **Input:** `raw/contextual/weather/weather_hourly_2023_2024.csv`
- **Output:** `processed/weather/weather_hourly.parquet/`
- **Skip logic:** Skips if output `_SUCCESS` exists
- **Args:** `--bucket`, `--force`

### 6. `ingest_holidays.py`
- **What it does:** Reads raw holidays CSV, enforces schema, deduplicates by date+holiday, writes Parquet
- **Input:** `raw/contextual/holiday/us_holidays_2023_2024.csv`
- **Output:** `processed/holidays/holidays.parquet/`
- **Skip logic:** Skips if output `_SUCCESS` exists
- **Args:** `--bucket`, `--force`

### 7. `production_demand_aggregation.py`
- **What it does:** Per-month aggregation — converts UTC timestamps to Eastern Time, counts hourly pickups per station, builds complete station×hour grid with zero-fill, adds basic time features, validates demand sum matches trip count
- **Input:** `cleaned/trips/year={y}/month={m}/`
- **Output:** `aggregated/demand/year={y}/month={m}/`
- **Skip logic:** Per-month skip if `_SUCCESS` exists
- **Args:** `--start_yyyymm`, `--end_yyyymm`, `--bucket`, `--run_id`, `--force`

### 8. `production_feature_engineering.py`
- **What it does:** Joins aggregated demand with weather (UTC→ET converted), station capacity, and holidays. Adds lag features (1h, 24h, 168h), rolling averages (3h, 6h, 24h), and cyclical time encodings (sin/cos for hour, day-of-week, month). Processes full year at once for accurate lag features across month boundaries.
- **Input:** `aggregated/demand/year={y}/`, `processed/weather/`, `raw/metadata/stations/station_capacity_lookup.parquet`, `processed/holidays/`
- **Output:** `features/feature_matrix/year={y}/`
- **Skip logic:** Per-year skip if `_SUCCESS` exists
- **Args:** `--year`, `--bucket`, `--run_id`, `--force`

---

## DAG Parameters

| Parameter | Default | Description |
|---|---|---|
| `year` | `2023` | Year for raw ingestion and feature engineering |
| `mode` | `demo` | `demo` (single month), `backfill` (date range), `incremental` (latest month only) |
| `start_yyyymm` | `202304` | Start month for cleaning and aggregation |
| `end_yyyymm` | `202304` | End month for cleaning and aggregation |

---

## How to Run

### Prerequisites
```bash
# Start all services
docker compose up airflow-webserver airflow-scheduler spark spark-worker -d

# Access Airflow UI
http://localhost:8081
# Login: admin / admin
```

### Run Configurations

**Single month test (cheapest — use to verify pipeline works):**
```json
{"year": "2023", "mode": "demo", "start_yyyymm": "202304", "end_yyyymm": "202304"}
```

**Full 2023 backfill:**
```json
{"year": "2023", "mode": "backfill", "start_yyyymm": "202304", "end_yyyymm": "202312"}
```
Note: 2023 data starts in April — there is no January–March data.

**Full 2024 backfill:**
```json
{"year": "2024", "mode": "backfill", "start_yyyymm": "202401", "end_yyyymm": "202412"}
```

**Incremental (new month only):**
```json
{"year": "2024", "mode": "incremental", "start_yyyymm": "202412", "end_yyyymm": "202412"}
```

### Forcing Reprocessing
Each job has a `--force` flag that bypasses skip logic. To force reprocess a specific job, add `--force` to its args in the DAG. This is useful after fixing a bug in a specific stage without rerunning the entire pipeline.

---

## Validation Status

### Data Completeness
| Dataset | Years | Months | Status |
|---|---|---|---|
| raw_enforced/trips | 2023 | 4–12 (9 months) | ✅ |
| raw_enforced/trips | 2024 | 1–12 (12 months) | ✅ |
| cleaned/trips | 2023 | 4–12 (9 months) | ✅ |
| cleaned/trips | 2024 | 1–12 (12 months) | ✅ |
| processed/stations | — | — | ✅ |
| processed/weather | 2023–2024 | — | ✅ |
| processed/holidays | 2023–2024 | — | ✅ |
| aggregated/demand | 2023 | 4–12 | ✅ |
| aggregated/demand | 2024 | 1–12 | ✅ |
| features/feature_matrix | 2023 | Full year | ✅ |
| features/feature_matrix | 2024 | Full year | ✅ |

### Pipeline Checks Passing
| Check | Status |
|---|---|
| GCP credentials (ADC) | ✅ |
| Cluster created + deleted every run | ✅ |
| No inferSchema anywhere | ✅ |
| Schema validation on raw_enforced | ✅ |
| Per-month skip logic working | ✅ |
| Demand sum == trip count validation | ✅ |
| Feature matrix null checks | ✅ |
| Weather UTC→ET timezone conversion | ✅ |
| Lag features accurate (full year processing) | ✅ |

---

## Known Issues Fixed

| Issue | Fix Applied |
|---|---|
| `authorized_user` credentials not supported by keyfile_dict | Use ADC via env var, connection with project only |
| `inferSchema=True` in all jobs | Replaced with explicit schemas everywhere |
| `from config.settings import ...` fails on Dataproc | Hardcoded constants directly in each script |
| Cleaning path used zero-padded month (`month=01`) | Fixed to strip leading zero: `str(int(yyyymm[4:]))` |
| `saveAsTextFile` fails if report path exists | Added `gsutil rm -rf` before writing |
| Old persistent cluster left running | Deleted manually, added `trigger_rule=ALL_DONE` to prevent future leaks |
| Dataproc region was `us-east1` | Fixed to `us-central1` |
| `pi` not available in PySpark 2.1 | Replaced `pi()` with `math.pi` wrapped in `lit()` |
| Weather join produced nulls (UTC vs ET mismatch) | Added `from_utc_timestamp()` on weather datetime before joining |
| `join_stations` defined outside class (indentation bug) | Fixed indentation — method now correctly inside class |
| `station_capacity_lookup` read as CSV instead of Parquet | Fixed `load_stations()` to use `.read.parquet()` |

---

## Next Steps — Phase 3 (ML Pipeline)

The feature matrix at `features/feature_matrix/year={y}/` is now ready for model training.

Planned `bluebikes_ml_pipeline` DAG:
```
create_cluster
    └── prepare_train_test_split
            └── model_training (XGBoost / LightGBM)
                    └── model_evaluation
                            └── model_registry
                                    └── delete_cluster [ALL_DONE]
```

Feature matrix columns available for training:
- **Target:** `demand_count` (hourly pickups per station)
- **Lag features:** `demand_lag_1h`, `demand_lag_24h`, `demand_lag_168h`
- **Rolling averages:** `rolling_avg_3h`, `rolling_avg_6h`, `rolling_avg_24h`
- **Weather:** `temperature_c`, `precipitation_mm`, `wind_speed_kmh`, `humidity_pct`, `feels_like_c`, `is_cold`, `is_hot`, `is_precipitation`
- **Time:** `hour_of_day`, `day_of_week`, `month`, `year`, `is_weekend`, `is_holiday`
- **Cyclical:** `hour_sin`, `hour_cos`, `dow_sin`, `dow_cos`, `month_sin`, `month_cos`
- **Station:** `start_station_id`, `capacity`