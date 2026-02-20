import logging

logger = logging.getLogger("bluebikes_pipeline")
logger.setLevel(logging.INFO)

BUCKET = "bluebikes-demand-predictor-data"


def download_raw_data(**kwargs):
    partition = kwargs.get("partition")
    logger.info(f"[download_raw_data] partition={partition}")
    logger.info(f"Reading from: gs://{BUCKET}/raw/trips/{partition}/")
    return "download_raw_data complete"


def clean_data(**kwargs):
    from src.data_processing.data_cleaning import run_cleaning_partition

    partition = kwargs.get("partition")
    bucket = kwargs.get("bucket")

    logger.info(f"[clean_data] partition={partition}")

    return run_cleaning_partition(
        partition=partition,
        bucket=bucket,
    )


def process_station_metadata(**kwargs):
    partition = kwargs.get("partition")
    logger.info(f"[process_station_metadata] partition={partition}")
    logger.info(f"Reading stations from: gs://{BUCKET}/raw/metadata/")
    return "process_station_metadata complete"


def process_weather_data(**kwargs):
    partition = kwargs.get("partition")
    logger.info(f"[process_weather_data] partition={partition}")
    logger.info(f"Reading weather from: gs://{BUCKET}/raw/contextual/weather/")
    return "process_weather_data complete"


def process_holiday_calendar(**kwargs):
    partition = kwargs.get("partition")
    logger.info(f"[process_holiday_calendar] partition={partition}")
    logger.info(f"Reading holidays from: gs://{BUCKET}/raw/contextual/holiday/")
    return "process_holiday_calendar complete"


def aggregate_demand(**kwargs):
    partition = kwargs.get("partition")
    logger.info(f"[aggregate_demand] partition={partition}")
    logger.info(f"Reading clean from: gs://{BUCKET}/clean/trips/{partition}/")
    logger.info(f"Writing aggregated data (temp) for partition={partition}")
    return "aggregate_demand complete"


def run_feature_engineering(**kwargs):
    partition = kwargs.get("partition")
    logger.info(f"[run_feature_engineering] partition={partition}")
    logger.info(f"Writing features to: gs://{BUCKET}/features/trips/{partition}/")
    return "run_feature_engineering complete"


def validate_schema(**kwargs):
    partition = kwargs.get("partition")
    logger.info(f"[validate_schema] partition={partition}")
    logger.info(f"Validating: gs://{BUCKET}/features/trips/{partition}/")
    return "validate_schema complete"


def detect_bias(**kwargs):
    partition = kwargs.get("partition")
    logger.info(f"[detect_bias] partition={partition}")
    logger.info(f"Running bias detection on partition={partition}")
    return "detect_bias complete"