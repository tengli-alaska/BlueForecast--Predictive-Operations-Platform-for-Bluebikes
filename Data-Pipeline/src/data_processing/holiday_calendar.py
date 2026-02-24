"""
BlueForecast Holiday Calendar
Generates US Federal Holiday calendar for 2023-2024 and uploads to GCS as parquet.

Based on 04_holiday_calendar.ipynb:
- 24 holidays across 2023-2024 (12 per year)
- Includes Patriots Day (MA-specific) for Boston context
- Categorized by type: federal_observance, major_holiday, summer_holiday,
  boston_special, federal_holiday
- Output: parquet with columns [date, holiday, year, holiday_type, is_holiday]
- Writes to: gs://BUCKET/data/contextual/us_holidays_2023_2024.parquet
"""

import io
import logging
import pandas as pd
from google.cloud import storage

logger = logging.getLogger("bluebikes_pipeline.holiday_calendar")
logger.setLevel(logging.INFO)

BUCKET = "bluebikes-demand-predictor-data"

# ── Holiday data (matches notebook 04 exactly) ──────────────────────────────
HOLIDAYS_2023_2024 = [
    # 2023
    {"date": "2023-01-01", "holiday": "New Year's Day", "year": 2023},
    {"date": "2023-01-16", "holiday": "Martin Luther King Jr. Day", "year": 2023},
    {"date": "2023-02-20", "holiday": "Presidents Day", "year": 2023},
    {"date": "2023-04-17", "holiday": "Patriots Day (MA)", "year": 2023},
    {"date": "2023-05-29", "holiday": "Memorial Day", "year": 2023},
    {"date": "2023-06-19", "holiday": "Juneteenth", "year": 2023},
    {"date": "2023-07-04", "holiday": "Independence Day", "year": 2023},
    {"date": "2023-09-04", "holiday": "Labor Day", "year": 2023},
    {"date": "2023-10-09", "holiday": "Columbus Day", "year": 2023},
    {"date": "2023-11-10", "holiday": "Veterans Day", "year": 2023},
    {"date": "2023-11-23", "holiday": "Thanksgiving", "year": 2023},
    {"date": "2023-12-25", "holiday": "Christmas", "year": 2023},
    # 2024
    {"date": "2024-01-01", "holiday": "New Year's Day", "year": 2024},
    {"date": "2024-01-15", "holiday": "Martin Luther King Jr. Day", "year": 2024},
    {"date": "2024-02-19", "holiday": "Presidents Day", "year": 2024},
    {"date": "2024-04-15", "holiday": "Patriots Day (MA)", "year": 2024},
    {"date": "2024-05-27", "holiday": "Memorial Day", "year": 2024},
    {"date": "2024-06-19", "holiday": "Juneteenth", "year": 2024},
    {"date": "2024-07-04", "holiday": "Independence Day", "year": 2024},
    {"date": "2024-09-02", "holiday": "Labor Day", "year": 2024},
    {"date": "2024-10-14", "holiday": "Columbus Day", "year": 2024},
    {"date": "2024-11-11", "holiday": "Veterans Day", "year": 2024},
    {"date": "2024-11-28", "holiday": "Thanksgiving", "year": 2024},
    {"date": "2024-12-25", "holiday": "Christmas", "year": 2024},
]


def _categorize_holiday(name):
    """
    Categorize holiday by type — exact logic from notebook 04 cell 2.
    Note: the notebook function checks 'Day' in name first, which catches
    Memorial Day and Labor Day as federal_observance (not summer_holiday).
    The elif for summer_holiday only triggers for Independence Day.
    Patriots Day hits 'Day' first → federal_observance (not boston_special).
    This matches the notebook output: 16 federal_observance, 4 major, 2 summer, 2 federal.
    """
    if "Day" in name and "Independence" not in name:
        return "federal_observance"
    elif name in ["Thanksgiving", "Christmas"]:
        return "major_holiday"
    elif name in ["Independence Day", "Memorial Day", "Labor Day"]:
        return "summer_holiday"
    elif "Patriots Day" in name:
        return "boston_special"
    else:
        return "federal_holiday"


def process_holiday_calendar(**kwargs):
    """
    Airflow-callable: generate holiday calendar DataFrame and upload to GCS.
    Reads: nothing (static data)
    Writes to: gs://BUCKET/data/contextual/us_holidays_2023_2024.parquet
    """
    logger.info("Creating US Federal Holiday calendar for 2023-2024...")

    # Build DataFrame — matches notebook cell 1
    df = pd.DataFrame(HOLIDAYS_2023_2024)
    df["date"] = pd.to_datetime(df["date"])

    logger.info("Created calendar with %d holidays", len(df))

    # Add holiday type categories — matches notebook cell 2
    df["holiday_type"] = df["holiday"].apply(_categorize_holiday)
    df["is_holiday"] = 1

    logger.info("Holiday categories:\n%s", df.groupby("holiday_type").size().to_string())

    # Upload to GCS as parquet — matches notebook cell 3 output path
    client = storage.Client()
    bucket = client.bucket(BUCKET)

    buf = io.BytesIO()
    df.to_parquet(buf, index=False)
    buf.seek(0)

    out_path = "data/contextual/us_holidays_2023_2024.parquet"
    blob = bucket.blob(out_path)
    blob.upload_from_file(buf, content_type="application/octet-stream")

    logger.info("Uploaded gs://%s/%s (%d holidays)", BUCKET, out_path, len(df))
    return f"Holiday calendar: {len(df)} holidays uploaded to gs://{BUCKET}/{out_path}"