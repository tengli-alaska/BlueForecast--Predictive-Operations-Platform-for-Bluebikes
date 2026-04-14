import os, json, time, io, logging
from typing import Any, Optional
from google.cloud import storage
import pandas as pd

logger = logging.getLogger("blueforecast.gcs")

BUCKET_NAME = os.getenv("GCS_BUCKET", "bluebikes-demand-predictor-data")


class CacheEntry:
    def __init__(self, data: Any, ttl: int):
        self.data = data
        self.expires_at = time.time() + ttl

    def is_expired(self) -> bool:
        return time.time() > self.expires_at


class GCSClient:
    def __init__(self):
        try:
            self._client = storage.Client()
            self._bucket = self._client.bucket(BUCKET_NAME)
            self._available = True
            logger.info(f"GCS connected to bucket: {BUCKET_NAME}")
        except Exception as e:
            self._client = None
            self._bucket = None
            self._available = False
            logger.warning(f"GCS unavailable: {e}. Using fallback data.")

        self._cache: dict[str, CacheEntry] = {}

    @property
    def available(self) -> bool:
        return self._available

    def _get_cached(self, key: str) -> Optional[Any]:
        entry = self._cache.get(key)
        if entry and not entry.is_expired():
            return entry.data
        return None

    def _set_cache(self, key: str, data: Any, ttl: int):
        self._cache[key] = CacheEntry(data, ttl)

    def read_json(self, path: str, ttl: int = 300) -> Optional[dict]:
        cached = self._get_cached(path)
        if cached is not None:
            return cached

        if not self._available:
            return None

        try:
            blob = self._bucket.blob(path)
            text = blob.download_as_text()
            data = json.loads(text)
            self._set_cache(path, data, ttl)
            return data
        except Exception as e:
            logger.error(f"Failed to read {path}: {e}")
            return None

    def read_parquet(self, path: str, ttl: int = 300) -> Optional[pd.DataFrame]:
        cached = self._get_cached(path)
        if cached is not None:
            return cached

        if not self._available:
            return None

        try:
            blob = self._bucket.blob(path)
            bytes_data = blob.download_as_bytes()
            df = pd.read_parquet(io.BytesIO(bytes_data))
            self._set_cache(path, df, ttl)
            return df
        except Exception as e:
            logger.error(f"Failed to read {path}: {e}")
            return None

    def list_blobs(self, prefix: str) -> list[str]:
        if not self._available:
            return []
        try:
            return [b.name for b in self._bucket.list_blobs(prefix=prefix)]
        except Exception:
            return []

    def get_approved_metadata(self, ttl: int = 300) -> Optional[dict]:
        return self.read_json("processed/models/approved/metadata.json", ttl)

    def get_run_id(self) -> Optional[str]:
        meta = self.get_approved_metadata()
        return meta.get("run_id") if meta else None


# Singleton
gcs = GCSClient()
