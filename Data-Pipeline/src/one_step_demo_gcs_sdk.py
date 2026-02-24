import io
import pandas as pd
from google.cloud import storage

BUCKET = "bluebikes-demand-predictor-data"

def demo_csv_to_parquet_gcs_sdk() -> str:
    client = storage.Client()
    bucket = client.bucket(BUCKET)

    # Input: one month CSV
    in_blob = bucket.blob("raw/historical/2024/csv/202401-bluebikes-tripdata.csv")
    if not in_blob.exists():
        raise FileNotFoundError("Input CSV not found: raw/historical/2024/csv/202401-bluebikes-tripdata.csv")

    # Download and read
    data = in_blob.download_as_bytes()
    df = pd.read_csv(io.BytesIO(data))

    if df.empty:
        raise ValueError("Read 0 rows from input CSV")

    # Keep small for first success
    df = df.head(20000)

    # Write parquet to memory then upload
    out_buf = io.BytesIO()
    df.to_parquet(out_buf, index=False)
    out_buf.seek(0)

    out_path = "airflow_demo/output/202401_sample.parquet"
    out_blob = bucket.blob(out_path)
    out_blob.upload_from_file(out_buf, content_type="application/octet-stream")

    return f"Wrote {len(df)} rows to gs://{BUCKET}/{out_path}"
