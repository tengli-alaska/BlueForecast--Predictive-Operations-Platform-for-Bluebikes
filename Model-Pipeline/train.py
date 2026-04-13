"""
BlueForecast training runner.

QUICK_CHECK = True  → 5% sample, ~30 sec, validates the full plumbing end-to-end
QUICK_CHECK = False → full 5.8M row training run, ~10–20 min on CPU

Set via environment variable:  QUICK_CHECK=True python train.py
Or edit the toggle below.
"""

import logging
import os
import sys

sys.path.insert(0, "src")
logging.basicConfig(level=logging.INFO, format="%(name)s — %(message)s")

# ── Toggle here ──────────────────────────────────────────────────────────────
QUICK_CHECK = os.getenv("QUICK_CHECK", "False").lower() in ("true", "1", "yes")
SAMPLE_FRAC = 0.05   # fraction used when QUICK_CHECK=True
RUN_OPTUNA  = os.getenv("RUN_OPTUNA", "False").lower() in ("true", "1", "yes")
# ─────────────────────────────────────────────────────────────────────────────

from model_pipeline.data_loader import load_feature_matrix, get_X_y, FEATURE_COLS
from model_pipeline.splitter import temporal_split
from model_pipeline.trainer import run_training_pipeline, DEFAULT_PARAMS

# 1. Load (data_loader now handles LabelEncoder + saves to GCS)
df, version_hash, _le = load_feature_matrix()

# 2. Split
train_df, val_df, test_df = temporal_split(df)

# 3. Optionally sample for quick check
if QUICK_CHECK:
    train_df = train_df.sample(frac=SAMPLE_FRAC, random_state=42)
    val_df   = val_df.sample(frac=SAMPLE_FRAC, random_state=42)
    print(f"\n[QUICK_CHECK] Sampled {SAMPLE_FRAC*100:.0f}% -> "
          f"train={len(train_df):,} rows | val={len(val_df):,} rows\n")

# 4. Extract X/y
X_train, y_train = get_X_y(train_df)
X_val,   y_val   = get_X_y(val_df)

# 5. Configure params
params = dict(DEFAULT_PARAMS)
if QUICK_CHECK:
    params["n_estimators"] = 50
    params["early_stopping_rounds"] = 10

# 6. Train + log to MLflow
forecaster, run_id = run_training_pipeline(
    X_train, y_train,
    X_val,   y_val,
    feature_cols=FEATURE_COLS,
    dataset_version_hash=version_hash,
    params=params,
    run_optuna=RUN_OPTUNA,
    optuna_n_trials=10 if QUICK_CHECK else 30,
    optuna_sample_frac=0.50 if QUICK_CHECK else 0.20,
)

print(f"\n{'='*60}")
print(f"Run ID:    {run_id}")
print(f"Mode:      {'QUICK_CHECK (5% sample)' if QUICK_CHECK else 'FULL TRAINING'}")
print(f"Optuna:    {'ON' if RUN_OPTUNA else 'OFF'}")
print(f"MLflow UI: http://localhost:5000  (run: mlflow ui)")
print(f"{'='*60}\n")