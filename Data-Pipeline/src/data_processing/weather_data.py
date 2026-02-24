"""
BlueForecast Weather Data
Fetches historical hourly weather for Boston from Open-Meteo API
and uploads to GCS as parquet.

Source: https://archive-api.open-meteo.com/v1/archive (free, no key needed)
Period: Apr 2023 - Dec 2024 (matching cleaned trip data)
Output: ~15,384 hourly records with temp, precip, wind, humidity, weather code
"""

import io
import logging
import time
import requests
import pandas as pd
from google.cloud import storage

logger = logging.getLogger("bluebikes_pipeline.weather_data")
logger.setLevel(logging.INFO)

BUCKET = "bluebikes-demand-predictor-data"
BOSTON_LAT = 42.3601
BOSTON_LON = -71.0589

# Quarterly batches to avoid API limits
DATE_RANGES = [
    ("2023-04-01", "2023-06-30"),
    ("2023-07-01", "2023-09-30"),
    ("2023-10-01", "2023-12-31"),
    ("2024-01-01", "2024-03-31"),
    ("2024-04-01", "2024-06-30"),
    ("2024-07-01", "2024-09-30"),
    ("2024-10-01", "2024-12-31"),
]


def _fetch_weather_batch(start_date, end_date):
    """Fetch hourly weather data from Open-Meteo for a date range."""
    url = (
        f"https://archive-api.open-meteo.com/v1/archive?"
        f"latitude={BOSTON_LAT}&longitude={BOSTON_LON}"
        f"&start_date={start_date}&end_date={end_date}"
        f"&hourly=temperature_2m,precipitation,windspeed_10m,relativehumidity_2m,weathercode"
        f"&timezone=America/New_York"
    )
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    data = resp.json()

    df = pd.DataFrame({
        "datetime": pd.to_datetime(data["hourly"]["time"]),
        "temperature_c": data["hourly"]["temperature_2m"],
        "precipitation_mm": data["hourly"]["precipitation"],
        "wind_speed_kmh": data["hourly"]["windspeed_10m"],
        "humidity_pct": data["hourly"]["relativehumidity_2m"],
        "weather_code": data["hourly"]["weathercode"],
    })
    return df


def _add_derived_features(df):
    """Add time components and categorical weather features."""
    df["date"] = df["datetime"].dt.date
    df["hour"] = df["datetime"].dt.hour
    df["day_of_week"] = df["datetime"].dt.dayofweek
    df["month"] = df["datetime"].dt.month
    df["year"] = df["datetime"].dt.year
    df["is_precipitation"] = (df["precipitation_mm"] > 0).astype(int)
    df["is_cold"] = (df["temperature_c"] < 10).astype(int)
    df["is_hot"] = (df["temperature_c"] > 25).astype(int)
    df["feels_like_c"] = df["temperature_c"] - (df["wind_speed_kmh"] * 0.2)
    return df


def process_weather_data(**kwargs):
    """
    Airflow-callable: fetch historical weather from Open-Meteo, upload parquet to GCS.
    Writes to: gs://BUCKET/processed/weather/weather_hourly.parquet
    """
    frames = []
    for i, (start, end) in enumerate(DATE_RANGES, 1):
        logger.info("[%d/%d] Fetching %s to %s", i, len(DATE_RANGES), start, end)
        df = _fetch_weather_batch(start, end)
        logger.info("  Got %d hourly records", len(df))
        frames.append(df)
        time.sleep(0.5)  # polite delay

    df_weather = pd.concat(frames, ignore_index=True)
    logger.info("Total weather records: %d", len(df_weather))
    logger.info("Missing values: %s", df_weather.isnull().sum().to_dict())

    # Add derived features
    df_weather = _add_derived_features(df_weather)
    logger.info("Added derived features. Columns: %d", len(df_weather.columns))

    # Log summary
    logger.info("Temp range: %.1f°C to %.1f°C (mean %.1f°C)",
                df_weather["temperature_c"].min(),
                df_weather["temperature_c"].max(),
                df_weather["temperature_c"].mean())
    rainy = (df_weather["precipitation_mm"] > 0).sum()
    logger.info("Rainy hours: %d (%.1f%%)", rainy, rainy / len(df_weather) * 100)

    # Upload to GCS
    client = storage.Client()
    bucket = client.bucket(BUCKET)

    # Convert date column to string for parquet compatibility
    df_weather["date"] = df_weather["date"].astype(str)

    buf = io.BytesIO()
    df_weather.to_parquet(buf, index=False)
    buf.seek(0)

    out_path = "processed/weather/weather_hourly.parquet"
    bucket.blob(out_path).upload_from_file(buf, content_type="application/octet-stream")
    logger.info("Uploaded gs://%s/%s (%d rows)", BUCKET, out_path, len(df_weather))

    return f"Weather data: {len(df_weather)} hourly records uploaded"