"""
performance_tracker.py
Computes rolling RMSE / MAE metrics from recent predictions stored in GCS.
Called by monitoring_dag.py → _performance task.
"""

import json
import logging
from datetime import datetime, timedelta

import gcsfs
import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

GCS_BUCKET   = "bluebikes-demand-predictor-data"
PREDICTIONS_PATH = f"gs://{GCS_BUCKET}/processed/predictions"
METRICS_PATH     = f"gs://{GCS_BUCKET}/processed/reports/performance_latest.json"


def _load_predictions(days: int = 7) -> pd.DataFrame:
    """Load recent prediction logs from GCS."""
    fs  = gcsfs.GCSFileSystem()
    cutoff = datetime.utcnow() - timedelta(days=days)
    dfs = []

    try:
        files = fs.glob(f"{PREDICTIONS_PATH}/*.parquet")
        for f in files:
            try:
                df = pd.read_parquet(f"gs://{f}")
                if "timestamp" in df.columns:
                    df["timestamp"] = pd.to_datetime(df["timestamp"])
                    df = df[df["timestamp"] >= cutoff]
                dfs.append(df)
            except Exception as e:
                log.warning(f"Could not read {f}: {e}")
    except Exception as e:
        log.warning(f"Could not list prediction files: {e}")

    if not dfs:
        log.warning("No prediction files found — returning empty DataFrame")
        return pd.DataFrame()

    return pd.concat(dfs, ignore_index=True)


def _rmse(actual: pd.Series, predicted: pd.Series) -> float:
    return float(np.sqrt(((actual - predicted) ** 2).mean()))


def _mae(actual: pd.Series, predicted: pd.Series) -> float:
    return float((actual - predicted).abs().mean())


def compute_rolling_rmse(days: int = 7) -> dict:
    """
    Compute rolling RMSE, MAE, and prediction count over the past N days.
    Returns a dict that gets pushed to XCom in the monitoring DAG.
    """
    df = _load_predictions(days=days)

    if df.empty or "actual_demand" not in df.columns or "predicted_demand" not in df.columns:
        log.warning("No valid prediction data found for performance tracking")
        return {
            "status":       "no_data",
            "rmse_7d":      None,
            "mae_7d":       None,
            "sample_count": 0,
            "run_at":       datetime.utcnow().isoformat(),
        }

    valid = df.dropna(subset=["actual_demand", "predicted_demand"])

    if len(valid) < 50:
        log.warning(f"Insufficient samples for metrics: {len(valid)}")
        return {
            "status":       "insufficient_data",
            "rmse_7d":      None,
            "mae_7d":       None,
            "sample_count": len(valid),
            "run_at":       datetime.utcnow().isoformat(),
        }

    rmse = _rmse(valid["actual_demand"], valid["predicted_demand"])
    mae  = _mae(valid["actual_demand"],  valid["predicted_demand"])

    # Per-day breakdown
    daily = {}
    if "timestamp" in valid.columns:
        valid = valid.copy()
        valid["date"] = valid["timestamp"].dt.date
        for date, grp in valid.groupby("date"):
            if len(grp) >= 10:
                daily[str(date)] = {
                    "rmse":  round(_rmse(grp["actual_demand"], grp["predicted_demand"]), 4),
                    "mae":   round(_mae(grp["actual_demand"],  grp["predicted_demand"]), 4),
                    "count": len(grp),
                }

    result = {
        "status":       "ok",
        "rmse_7d":      round(rmse, 4),
        "mae_7d":       round(mae,  4),
        "sample_count": len(valid),
        "daily":        daily,
        "run_at":       datetime.utcnow().isoformat(),
    }

    # Save to GCS
    try:
        fs = gcsfs.GCSFileSystem()
        with fs.open(METRICS_PATH, "w") as f:
            json.dump(result, f, indent=2)
        log.info(f"Performance metrics saved: RMSE={rmse:.4f}, MAE={mae:.4f}, n={len(valid)}")
    except Exception as e:
        log.error(f"Failed to save performance metrics to GCS: {e}")

    return result


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    metrics = compute_rolling_rmse(days=7)
    print(json.dumps(metrics, indent=2))
