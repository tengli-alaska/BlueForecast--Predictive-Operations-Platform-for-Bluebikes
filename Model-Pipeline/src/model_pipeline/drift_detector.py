"""
Drift detection for production model monitoring.

Detects:
1. Feature distribution drift (KL divergence)
2. Prediction performance drift (MAE trend)
3. Concept drift (target distribution shift)
"""

import logging
import numpy as np
import pandas as pd
from scipy.stats import entropy
from typing import Dict, Any

logger = logging.getLogger("model_pipeline.drift_detector")
logger.setLevel(logging.INFO)


def compute_kl_divergence(
    reference_data: np.ndarray,
    current_data: np.ndarray,
    bins: int = 20
) -> float:
    """
    Compute KL divergence between reference and current distributions.
    
    Higher values indicate more drift.
    Threshold recommendation: > 0.1 for alert
    """
    hist_range = (
        min(reference_data.min(), current_data.min()),
        max(reference_data.max(), current_data.max())
    )
    
    ref_hist, bin_edges = np.histogram(
        reference_data, bins=bins, range=hist_range, density=True
    )
    curr_hist, _ = np.histogram(
        current_data, bins=bin_edges, density=True
    )
    
    epsilon = 1e-10
    ref_prob = (ref_hist + epsilon) / (ref_hist + epsilon).sum()
    curr_prob = (curr_hist + epsilon) / (curr_hist + epsilon).sum()
    
    return float(entropy(curr_prob, ref_prob))


def detect_feature_drift(
    reference_features: pd.DataFrame,
    current_features: pd.DataFrame,
    threshold: float = 0.1
) -> Dict[str, Any]:
    """
    Detect drift in feature distributions using KL divergence.
    
    Returns dict with per-feature scores and overall alert status.
    """
    drift_scores = {}
    drifted_features = []
    
    for col in reference_features.columns:
        if col not in current_features.columns:
            logger.warning(f"Feature '{col}' missing in current data")
            continue
            
        kl_div = compute_kl_divergence(
            reference_features[col].values,
            current_features[col].values
        )
        drift_scores[col] = kl_div
        
        if kl_div > threshold:
            drifted_features.append(col)
            logger.warning(
                f"Drift detected in '{col}': KL={kl_div:.4f}"
            )
    
    return {
        "drift_scores": drift_scores,
        "max_drift": max(drift_scores.values()) if drift_scores else 0.0,
        "drifted_features": drifted_features,
        "drift_detected": len(drifted_features) > 0,
        "threshold": threshold
    }


def detect_performance_drift(
    historical_errors: np.ndarray,
    current_errors: np.ndarray,
    threshold_pct: float = 20.0
) -> Dict[str, Any]:
    """
    Detect performance degradation via MAE comparison.
    
    Alert if current MAE increases by > threshold_pct.
    """
    baseline_mae = float(np.mean(historical_errors))
    current_mae = float(np.mean(current_errors))
    
    mae_increase_pct = (
        ((current_mae - baseline_mae) / baseline_mae) * 100
        if baseline_mae > 0 else 0.0
    )
    
    drift_detected = mae_increase_pct > threshold_pct
    
    if drift_detected:
        logger.warning(
            f"Performance drift: MAE +{mae_increase_pct:.1f}% "
            f"(baseline={baseline_mae:.4f}, current={current_mae:.4f})"
        )
    
    return {
        "baseline_mae": baseline_mae,
        "current_mae": current_mae,
        "mae_increase_pct": mae_increase_pct,
        "drift_detected": drift_detected,
        "threshold_pct": threshold_pct
    }


def detect_target_drift(
    reference_target: np.ndarray,
    current_target: np.ndarray,
    threshold: float = 0.15
) -> Dict[str, Any]:
    """
    Detect concept drift in target distribution.
    """
    kl_div = compute_kl_divergence(
        reference_target, current_target, bins=30
    )
    
    drift_detected = kl_div > threshold
    
    if drift_detected:
        logger.warning(
            f"Target drift: KL={kl_div:.4f} (threshold={threshold})"
        )
    
    return {
        "target_kl_divergence": kl_div,
        "drift_detected": drift_detected,
        "threshold": threshold,
        "reference_mean": float(np.mean(reference_target)),
        "current_mean": float(np.mean(current_target)),
        "reference_std": float(np.std(reference_target)),
        "current_std": float(np.std(current_target))
    }


def run_drift_detection_pipeline(
    reference_features: pd.DataFrame,
    reference_target: np.ndarray,
    reference_errors: np.ndarray,
    current_features: pd.DataFrame,
    current_target: np.ndarray,
    current_errors: np.ndarray
) -> Dict[str, Any]:
    """
    Complete drift detection pipeline.
    
    Parameters
    ----------
    reference_features : pd.DataFrame
        Training set features
    reference_target : np.ndarray
        Training set target values
    reference_errors : np.ndarray
        Validation set absolute errors
    current_features : pd.DataFrame
        Production features (recent window)
    current_target : np.ndarray
        Production target values (if available)
    current_errors : np.ndarray
        Production absolute errors
        
    Returns
    -------
    dict
        Comprehensive drift report for MLflow logging
    """
    logger.info("Starting drift detection pipeline...")
    
    feature_drift = detect_feature_drift(
        reference_features, current_features
    )
    
    performance_drift = detect_performance_drift(
        reference_errors, current_errors
    )
    
    target_drift = detect_target_drift(
        reference_target, current_target
    )
    
    overall_drift_detected = (
        feature_drift["drift_detected"] or
        performance_drift["drift_detected"] or
        target_drift["drift_detected"]
    )
    
    report = {
        "overall_drift_detected": overall_drift_detected,
        "feature_drift": feature_drift,
        "performance_drift": performance_drift,
        "target_drift": target_drift,
        "recommendation": (
            "RETRAIN MODEL" if overall_drift_detected 
            else "Model is stable"
        )
    }
    
    if overall_drift_detected:
        logger.error(
            "⚠️  DRIFT ALERT: Model retraining recommended"
        )
    else:
        logger.info("✓ No significant drift detected")
    
    return report


# Example usage for Airflow task
def drift_detection_task(
    train_features_path: str,
    train_target_path: str,
    val_errors_path: str,
    prod_features_path: str,
    prod_target_path: str,
    prod_errors_path: str
) -> Dict[str, Any]:
    """
    Airflow task wrapper for drift detection.
    
    Load data from GCS paths and run drift pipeline.
    """
    import pandas as pd
    
    # Load reference data
    train_X = pd.read_parquet(train_features_path)
    train_y = pd.read_parquet(train_target_path).values.ravel()
    val_errors = pd.read_parquet(val_errors_path).values.ravel()
    
    # Load production data
    prod_X = pd.read_parquet(prod_features_path)
    prod_y = pd.read_parquet(prod_target_path).values.ravel()
    prod_errors = pd.read_parquet(prod_errors_path).values.ravel()
    
    # Run drift detection
    report = run_drift_detection_pipeline(
        train_X, train_y, val_errors,
        prod_X, prod_y, prod_errors
    )
    
    logger.info(f"Drift report: {report}")
    
    return report
