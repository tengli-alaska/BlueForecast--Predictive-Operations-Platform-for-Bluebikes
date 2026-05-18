"""
BlueForecast Station Metadata
Fetches current Bluebikes station information from the GBFS API
and uploads to GCS as parquet.

Source: https://gbfs.bluebikes.com/gbfs/en/station_information.json
Output: ~595 stations with id, name, lat/lon, capacity, region, etc.
"""

import io
import logging
import requests
import pandas as pd
from datetime import datetime
from google.cloud import storage

logger = logging.getLogger("bluebikes_pipeline.station_metadata")
logger.setLevel(logging.INFO)

BUCKET = "bluebikes-demand-predictor-data"
GBFS_URL = "https://gbfs.bluebikes.com/gbfs/en/station_information.json"


def process_station_metadata(**kwargs):
    """
    Airflow-callable: fetch station metadata from GBFS API, upload parquet to GCS.
    Writes to: gs://BUCKET/processed/stations/stations.parquet
    """
    # 1. Fetch from API
    logger.info("Fetching station metadata from %s", GBFS_URL)
    resp = requests.get(GBFS_URL, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    stations = data["data"]["stations"]
    logger.info("Received %d stations from API", len(stations))

    # 2. Extract key fields into DataFrame
    records = []
    for s in stations:
        records.append({
            "station_id": s.get("station_id"),
            "station_name": s.get("name"),
            "lat": s.get("lat"),
            "lon": s.get("lon"),
            "capacity": s.get("capacity"),
            "region_id": s.get("region_id"),
            "rental_methods": ",".join(s.get("rental_methods", [])),
            "has_kiosk": s.get("has_kiosk"),
        })

    df = pd.DataFrame(records)
    df["fetched_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # 3. Log summary stats
    logger.info("Stations: %d | Total capacity: %d | Avg capacity: %.1f",
                len(df), df["capacity"].sum(), df["capacity"].mean())
    logger.info("Missing region_id: %d", df["region_id"].isna().sum())

    # 4. Upload parquet to GCS
    client = storage.Client()
    bucket = client.bucket(BUCKET)

    buf = io.BytesIO()
    df.to_parquet(buf, index=False)
    buf.seek(0)

    out_path = "processed/stations/stations.parquet"
    bucket.blob(out_path).upload_from_file(buf, content_type="application/octet-stream")
    logger.info("Uploaded gs://%s/%s (%d rows)", BUCKET, out_path, len(df))

    return f"Station metadata: {len(df)} stations uploaded"