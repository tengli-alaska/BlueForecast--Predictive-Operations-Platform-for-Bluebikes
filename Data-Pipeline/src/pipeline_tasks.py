"""
BlueForecast Pipeline Tasks
Callable functions for each stage of the data pipeline.
Each function delegates to its dedicated module.
"""

import logging

logger = logging.getLogger("bluebikes_pipeline")
logger.setLevel(logging.INFO)

BUCKET = "bluebikes-demand-predictor-data"


def download_raw_data(**kwargs):
    """Download raw Bluebikes trip data from source to GCS."""
    logger.info("STUB: download_raw_data — fetching raw CSV files to gs://%s/raw/", BUCKET)
    # TODO: Replace with logic from data acquisition
    return "download_raw_data complete"


def clean_data(**kwargs):
    """
    Clean raw trip data — dedup, null removal, duration filter,
    text standardization.
    Reads:  gs://BUCKET/raw/historical/{year}/csv/*.csv
    Writes: gs://BUCKET/processed/cleaned/year={year}/cleaned.parquet
    """
    from src.data_processing.data_cleaning import clean_data as _clean
    return _clean(**kwargs)


def process_station_metadata(**kwargs):
    """
    Fetch current Bluebikes station info from GBFS API.
    Writes: gs://BUCKET/metadata/stations/stations.parquet
    """
    from src.data_processing.station_metadata import process_station_metadata as _run
    return _run(**kwargs)


def process_weather_data(**kwargs):
    """
    Fetch historical hourly weather for Boston from Open-Meteo API.
    Writes: gs://BUCKET/data/weather/weather_hourly_2023_2024.parquet
    """
    from src.data_processing.weather_data import process_weather_data as _run
    return _run(**kwargs)


def process_holiday_calendar(**kwargs):
    """
    Generate US Federal Holiday calendar for 2023-2024, including
    Patriots Day (MA-specific). 24 holidays total.
    Writes: gs://BUCKET/data/contextual/us_holidays_2023_2024.parquet
    """
    from src.data_processing.holiday_calendar import process_holiday_calendar as _run
    return _run(**kwargs)


def aggregate_demand(**kwargs):
    """
    Convert 7.88M cleaned trips → hourly pickup counts per station.
    Converts UTC → Eastern Time, builds complete 534-station × 15,384-hour
    grid, fills zero-demand slots (68.6% sparsity).
    Reads:  gs://BUCKET/processed/cleaned/year=*/cleaned.parquet
    Writes: gs://BUCKET/processed/features/hourly_demand_by_station.parquet
    """
    from src.data_processing.aggregate_demand import aggregate_demand as _run
    return _run(**kwargs)


def run_feature_engineering(**kwargs):
    """
    Join hourly demand with weather, station metadata, and holidays.
    Adds lag features (1h, 24h, 168h), rolling averages (3h, 6h, 24h),
    and cyclical time encodings. Output: 8.2M rows × 32 columns, zero nulls.
    Reads:  gs://BUCKET/processed/features/hourly_demand_by_station.parquet
            gs://BUCKET/data/weather/weather_hourly_2023_2024.parquet
            gs://BUCKET/metadata/stations/stations.parquet
            gs://BUCKET/data/contextual/us_holidays_2023_2024.parquet
    Writes: gs://BUCKET/processed/features/feature_matrix.parquet
    """
    from src.data_processing.feature_engineering import feature_engineering as _run
    return _run(**kwargs)


def validate_schema(**kwargs):
    """Validate feature matrix schema, types, ranges, and quality constraints."""
    from src.data_processing.schema_validation import validate_schema as _run
    return _run(**kwargs)


def detect_bias(**kwargs):
    """Run bias detection via data slicing on final dataset."""
    from src.data_processing.bias_detection import detect_bias as _run
    return _run(**kwargs)