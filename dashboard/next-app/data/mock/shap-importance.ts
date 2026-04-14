import type { FeatureImportance } from "@/types";

export const mockFeatureImportance: FeatureImportance[] = [
  // --- Top 5 from real SHAP data ---
  { feature: "demand_lag_168h",  shap_value: 0.319,  xgboost_gain: 0.1842, category: "lag" },
  { feature: "demand_lag_1h",    shap_value: 0.265,  xgboost_gain: 0.2105, category: "lag" },
  { feature: "rolling_avg_24h",  shap_value: 0.142,  xgboost_gain: 0.1354, category: "rolling" },
  { feature: "rolling_avg_6h",   shap_value: 0.089,  xgboost_gain: 0.0987, category: "rolling" },
  { feature: "demand_lag_24h",   shap_value: 0.072,  xgboost_gain: 0.0812, category: "lag" },

  // --- Remaining 25 features, ranked by decreasing SHAP ---
  { feature: "hour_of_day",      shap_value: 0.058,  xgboost_gain: 0.0645, category: "time" },
  { feature: "temperature_c",    shap_value: 0.049,  xgboost_gain: 0.0521, category: "weather" },
  { feature: "capacity",         shap_value: 0.042,  xgboost_gain: 0.0389, category: "station" },
  { feature: "day_of_week",      shap_value: 0.036,  xgboost_gain: 0.0312, category: "time" },
  { feature: "is_weekend",       shap_value: 0.031,  xgboost_gain: 0.0284, category: "time" },
  { feature: "rolling_avg_3h",   shap_value: 0.028,  xgboost_gain: 0.0253, category: "rolling" },
  { feature: "feels_like_c",     shap_value: 0.025,  xgboost_gain: 0.0231, category: "weather" },
  { feature: "hour_sin",         shap_value: 0.022,  xgboost_gain: 0.0198, category: "time" },
  { feature: "hour_cos",         shap_value: 0.020,  xgboost_gain: 0.0185, category: "time" },
  { feature: "precipitation_mm", shap_value: 0.018,  xgboost_gain: 0.0162, category: "weather" },
  { feature: "humidity_pct",     shap_value: 0.015,  xgboost_gain: 0.0148, category: "weather" },
  { feature: "month",            shap_value: 0.013,  xgboost_gain: 0.0131, category: "time" },
  { feature: "wind_speed_kmh",   shap_value: 0.011,  xgboost_gain: 0.0118, category: "weather" },
  { feature: "dow_sin",          shap_value: 0.0095, xgboost_gain: 0.0102, category: "time" },
  { feature: "dow_cos",          shap_value: 0.0082, xgboost_gain: 0.0091, category: "time" },
  { feature: "is_holiday",       shap_value: 0.0071, xgboost_gain: 0.0078, category: "time" },
  { feature: "month_sin",        shap_value: 0.0063, xgboost_gain: 0.0065, category: "time" },
  { feature: "month_cos",        shap_value: 0.0055, xgboost_gain: 0.0058, category: "time" },
  { feature: "is_cold",          shap_value: 0.0048, xgboost_gain: 0.0051, category: "weather" },
  { feature: "is_hot",           shap_value: 0.0042, xgboost_gain: 0.0044, category: "weather" },
  { feature: "is_precipitation", shap_value: 0.0036, xgboost_gain: 0.0039, category: "weather" },
  { feature: "year",             shap_value: 0.0031, xgboost_gain: 0.0033, category: "time" },
  { feature: "start_station_id", shap_value: 0.0025, xgboost_gain: 0.0028, category: "station" },
  { feature: "rolling_avg_12h",  shap_value: 0.0019, xgboost_gain: 0.0021, category: "rolling" },
  { feature: "demand_lag_3h",    shap_value: 0.0014, xgboost_gain: 0.0015, category: "lag" },
];
