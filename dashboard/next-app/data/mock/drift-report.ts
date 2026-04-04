import type { DriftReport } from "@/types";

/**
 * All 30 features used by the model, for drift score generation.
 */
const ALL_FEATURES = [
  "demand_lag_168h", "demand_lag_1h", "rolling_avg_24h", "rolling_avg_6h",
  "demand_lag_24h", "hour_of_day", "temperature_c", "capacity",
  "day_of_week", "is_weekend", "rolling_avg_3h", "feels_like_c",
  "hour_sin", "hour_cos", "precipitation_mm", "humidity_pct",
  "month", "wind_speed_kmh", "dow_sin", "dow_cos",
  "is_holiday", "month_sin", "month_cos", "is_cold",
  "is_hot", "is_precipitation", "year", "start_station_id",
  "rolling_avg_12h", "demand_lag_3h",
] as const;

// ----- Stable scenario: no drift detected -----

const stableDriftScores: Record<string, number> = {};
const stableSeed = 42;
ALL_FEATURES.forEach((f, i) => {
  // Deterministic low KL values between 0.02 and 0.08
  stableDriftScores[f] = Math.round((0.02 + ((stableSeed + i * 17) % 60) / 1000) * 10000) / 10000;
});

export const mockDriftStable: DriftReport = {
  overall_drift_detected: false,
  feature_drift: {
    drift_scores: stableDriftScores,
    max_drift: Math.max(...Object.values(stableDriftScores)),
    drifted_features: [],
    drift_detected: false,
    threshold: 0.10,
  },
  performance_drift: {
    baseline_mae: 0.6507,
    current_mae: 0.68,
    mae_increase_pct: 4.49,
    drift_detected: false,
    threshold_pct: 20.0,
  },
  target_drift: {
    target_kl_divergence: 0.032,
    drift_detected: false,
    threshold: 0.10,
    reference_mean: 0.962,
    current_mean: 0.978,
  },
  recommendation: "No action needed. All drift indicators are within acceptable thresholds.",
};

// ----- Alert scenario: drift detected -----

const alertDriftScores: Record<string, number> = {};
ALL_FEATURES.forEach((f, i) => {
  // Most features have moderate drift
  alertDriftScores[f] = Math.round((0.04 + ((stableSeed + i * 13) % 50) / 1000) * 10000) / 10000;
});
// Override specific features with high KL divergence to trigger drift
alertDriftScores["temperature_c"] = 0.18;
alertDriftScores["precipitation_mm"] = 0.15;
alertDriftScores["demand_lag_1h"] = 0.12;
alertDriftScores["feels_like_c"] = 0.11;

const alertDriftedFeatures = Object.entries(alertDriftScores)
  .filter(([, v]) => v >= 0.10)
  .sort(([, a], [, b]) => b - a)
  .map(([k]) => k);

export const mockDriftAlert: DriftReport = {
  overall_drift_detected: true,
  feature_drift: {
    drift_scores: alertDriftScores,
    max_drift: 0.18,
    drifted_features: alertDriftedFeatures,
    drift_detected: true,
    threshold: 0.10,
  },
  performance_drift: {
    baseline_mae: 0.6507,
    current_mae: 0.8134,
    mae_increase_pct: 25.01,
    drift_detected: true,
    threshold_pct: 20.0,
  },
  target_drift: {
    target_kl_divergence: 0.14,
    drift_detected: true,
    threshold: 0.10,
    reference_mean: 0.962,
    current_mean: 1.241,
  },
  recommendation:
    "Retraining recommended. Significant drift detected in weather features (temperature_c, precipitation_mm) " +
    "and demand lag signals. MAE has increased by 25% beyond the baseline. " +
    "Consider collecting fresh data and retraining the model.",
};
