"""
Leakage-safe temporal train / validation / test split for BlueForecast.

Why temporal and not random:
  This is a time-series forecasting problem. Random splitting allows the model
  to train on future rows and be tested on past rows, which inflates every metric.
  Temporal splitting mirrors real production conditions — the model only ever sees
  data that existed at the moment of prediction.

Split windows (chronological, non-overlapping):
  train : hour < 2024-07-01          (~71% of rows — ~15 months)
  val   : 2024-07-01 ≤ hour < 2024-10-01  (~14% of rows — 3 months)
  test  : hour ≥ 2024-10-01          (~14% of rows — 3 months)

No leakage concern from pre-computed lags:
  All lag and rolling features are already materialized in the parquet by the data
  pipeline. Splitting just slices rows — it never recomputes lags across the split
  boundary. Val row for 2024-07-01 has demand_lag_168h = demand at 2024-06-24,
  which is correctly sourced from the training period.
"""

import logging

import pandas as pd

logger = logging.getLogger("model_pipeline.splitter")
logger.setLevel(logging.INFO)

TRAIN_END   = pd.Timestamp("2024-07-01")   # exclusive upper bound for train
VAL_END     = pd.Timestamp("2024-10-01")   # exclusive upper bound for val
# test = everything from VAL_END onwards


def temporal_split(
    df: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Apply a chronological train / val / test split.

    Parameters
    ----------
    df : pd.DataFrame
        Full feature matrix from load_feature_matrix(). Must contain an 'hour'
        column of dtype datetime64[ns].

    Returns
    -------
    train_df, val_df, test_df : pd.DataFrame
        Three non-overlapping subsets. Each retains all original columns so the
        caller can apply get_X_y() independently on each split.
    """
    if "hour" not in df.columns:
        raise ValueError("DataFrame must contain an 'hour' column for temporal splitting.")

    # Enforce chronological order — the parquet should already be sorted, but
    # we never assume upstream sort order in a model pipeline.
    df = df.sort_values("hour").reset_index(drop=True)

    train_df = df[df["hour"] <  TRAIN_END].copy()
    val_df   = df[(df["hour"] >= TRAIN_END) & (df["hour"] < VAL_END)].copy()
    test_df  = df[df["hour"] >= VAL_END].copy()

    _log_split_summary(train_df, val_df, test_df, total=len(df))
    _check_station_coverage(train_df, val_df, test_df)

    return train_df, val_df, test_df


def _log_split_summary(
    train_df: pd.DataFrame,
    val_df:   pd.DataFrame,
    test_df:  pd.DataFrame,
    total:    int,
) -> None:
    """Log row counts, percentages, and date ranges for each split."""
    for name, split in [("TRAIN", train_df), ("VAL", val_df), ("TEST", test_df)]:
        pct = 100 * len(split) / total
        logger.info(
            "%s | rows: %s (%.1f%%) | %s → %s",
            name,
            f"{len(split):,}",
            pct,
            split["hour"].min().date(),
            split["hour"].max().date(),
        )

    row_sum = len(train_df) + len(val_df) + len(test_df)
    if row_sum != total:
        raise RuntimeError(
            f"Split integrity check failed: {row_sum:,} rows after split ≠ {total:,} total rows. "
            "Check for overlapping or missing rows in the split boundaries."
        )
    logger.info("Split integrity check passed: all %s rows accounted for.", f"{total:,}")


def _check_station_coverage(
    train_df: pd.DataFrame,
    val_df:   pd.DataFrame,
    test_df:  pd.DataFrame,
) -> None:
    """
    Warn if val or test contain stations not seen in training.

    This is not an error — Bluebikes adds stations over time, and XGBoost will
    produce predictions for unseen station IDs using numeric extrapolation. But it
    is important to document because the model has no historical signal for new
    stations; their predictions will be less reliable.
    """
    train_stations = set(train_df["start_station_id"].unique())
    val_stations   = set(val_df["start_station_id"].unique())
    test_stations  = set(test_df["start_station_id"].unique())

    new_in_val  = val_stations  - train_stations
    new_in_test = test_stations - train_stations

    if new_in_val:
        logger.warning(
            "%d station(s) appear in VAL but not in TRAIN. "
            "Model has no direct signal for these — predictions will rely on "
            "feature extrapolation only. Station IDs: %s",
            len(new_in_val),
            sorted(new_in_val)[:10],  # truncate if many
        )
    if new_in_test:
        logger.warning(
            "%d station(s) appear in TEST but not in TRAIN. Station IDs: %s",
            len(new_in_test),
            sorted(new_in_test)[:10],
        )

    if not new_in_val and not new_in_test:
        logger.info(
            "Station coverage check passed: all val/test stations seen in training. "
            "Train: %d | Val: %d | Test: %d unique stations.",
            len(train_stations), len(val_stations), len(test_stations),
        )
