import type {
  Station,
  Prediction,
  ModelMetrics,
  FeatureImportance,
  BiasReport,
  DriftReport,
  PipelineStatus,
  StationStatus,
  RebalancingRoute,
  DemandHeatmapEntry,
  CostAnalysis,
} from "@/types";

import { mockStations } from "./mock/stations";
import { mockPredictions } from "./mock/predictions";
import { mockModelMetrics } from "./mock/model-metrics";
import { mockFeatureImportance } from "./mock/shap-importance";
import { mockBiasReport } from "./mock/bias-report";
import { mockDriftStable, mockDriftAlert } from "./mock/drift-report";
import { mockPipelineStatus } from "./mock/pipeline-status";
import { mockStationStatuses, mockRebalancingRoutes, mockDemandHeatmap } from "./mock/rebalancing";
import { mockCostAnalysis } from "./mock/cost-analysis";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchJson<T>(path: string, fallback: T): Promise<any> {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } catch {
    return null;
  }
}

export async function getStations(): Promise<{ data: Station[]; isLive: boolean }> {
  const raw = await fetchJson("/api/stations", null);
  if (Array.isArray(raw) && raw.length > 0) return { data: raw, isLive: true };
  return { data: mockStations, isLive: false };
}

export async function getPredictions(stationId?: string): Promise<{ data: Prediction[]; isLive: boolean }> {
  const url = stationId ? `/api/predictions?station_id=${stationId}` : "/api/predictions";
  const raw = await fetchJson(url, null);
  if (Array.isArray(raw) && raw.length > 0) return { data: raw, isLive: true };
  const mock = stationId ? mockPredictions.filter(p => p.station_id === stationId) : mockPredictions;
  return { data: mock, isLive: false };
}

export async function getModelMetrics(): Promise<ModelMetrics[]> {
  return mockModelMetrics;
}

export async function getLatestMetrics(): Promise<{ data: ModelMetrics; isLive: boolean }> {
  const raw = await fetchJson("/api/metrics/latest", null);
  if (raw && raw.run_id) {
    return {
      isLive: true,
      data: {
        run_id: raw.run_id,
        model_type: raw.model_type || "XGBoostForecaster",
        val_rmse: raw.val_rmse ?? 0,
        val_mae: raw.val_mae ?? (raw.val_rmse ? raw.val_rmse * 0.5 : 0),
        val_r2: raw.val_r2 ?? raw.test_r2 ?? 0,
        test_rmse: raw.test_rmse ?? 0,
        test_mae: raw.test_mae ?? (raw.test_rmse ? raw.test_rmse * 0.5 : 0),
        test_r2: raw.test_r2 ?? 0,
        best_iteration: raw.best_iteration ?? 0,
        validation_status: raw.validation_status ?? "PASSED",
        trained_at: raw.promoted_at ?? new Date().toISOString(),
        thresholds: { max_test_rmse: 2.5, min_test_r2: 0.5, max_test_mae: 1.5 },
      } as ModelMetrics,
    };
  }
  return { data: mockModelMetrics[mockModelMetrics.length - 1], isLive: false };
}

export async function getFeatureImportance(): Promise<{ data: FeatureImportance[]; isLive: boolean }> {
  const raw = await fetchJson("/api/feature-importance", null);
  if (raw && raw.shap_mean_abs && raw.xgboost_gain) {
    const CATEGORY_MAP: Record<string, FeatureImportance["category"]> = {
      demand_lag_1h: "lag", demand_lag_24h: "lag", demand_lag_168h: "lag",
      rolling_avg_3h: "rolling", rolling_avg_6h: "rolling", rolling_avg_24h: "rolling",
      temperature_c: "weather", precipitation_mm: "weather", wind_speed_kmh: "weather",
      humidity_pct: "weather", feels_like_c: "weather", weather_code: "weather",
      is_cold: "weather", is_hot: "weather", is_precipitation: "weather",
      hour_of_day: "time", day_of_week: "time", month: "time", year: "time",
      is_weekend: "time", is_holiday: "time", hour_sin: "time", hour_cos: "time",
      dow_sin: "time", dow_cos: "time", month_sin: "time", month_cos: "time",
      start_station_id: "station", capacity: "station",
    };
    const features: FeatureImportance[] = Object.entries(raw.shap_mean_abs as Record<string, number>)
      .map(([feature, shap_value]) => ({
        feature,
        shap_value,
        xgboost_gain: (raw.xgboost_gain as Record<string, number>)[feature] ?? 0,
        category: CATEGORY_MAP[feature] ?? "time",
      }))
      .sort((a, b) => b.shap_value - a.shap_value);
    return { data: features, isLive: true };
  }
  return { data: mockFeatureImportance, isLive: false };
}

/**
 * Normalize API bias report (dimensions dict) to dashboard format (slices array).
 * API format: { dimensions: { time_of_day: { groups: { night: { rmse, mae, count } }, disparity_ratio, ... } }, violations: [] }
 * Dashboard format: { slices: [{ slice_name, groups: [{ group, count, ... }], disparity_ratio, flags }], total_rows, total_flags }
 */
export async function getBiasReport(): Promise<BiasReport> {
  const data = await fetchJson("/api/bias-report", null);
  if (data && data.dimensions) {
    const slices = Object.entries(data.dimensions).map(([name, dim]: [string, any]) => {
      const groups = Object.entries(dim.groups || {}).map(([groupName, g]: [string, any]) => ({
        group: groupName,
        count: g.count ?? 0,
        representation_pct: 0,
        mean_demand: g.mae ?? 0,
        median_demand: 0,
        zero_demand_pct: 0,
      }));
      const totalCount = groups.reduce((s, g) => s + g.count, 0);
      groups.forEach(g => { g.representation_pct = totalCount > 0 ? Math.round((g.count / totalCount) * 10000) / 100 : 0; });

      const flags: string[] = [];
      if (dim.status === "FAILED") flags.push(`${name}: disparity ratio ${dim.disparity_ratio}× exceeds threshold ${dim.threshold}×`);

      return {
        slice_name: name,
        groups,
        disparity_ratio: dim.disparity_ratio ?? 1,
        flags,
      };
    });

    return {
      total_rows: data.test_rows ?? 0,
      slices,
      total_flags: (data.violations ?? []).length,
    };
  }
  return mockBiasReport;
}

/**
 * Normalize API drift report to dashboard format.
 * API format already matches closely, but we ensure all fields exist.
 */
export async function getDriftReport(scenario?: "stable" | "alert"): Promise<DriftReport> {
  const data = await fetchJson("/api/drift-report", null);
  if (data && typeof data.overall_drift_detected !== "undefined") {
    return {
      overall_drift_detected: data.overall_drift_detected ?? false,
      feature_drift: {
        drift_scores: data.feature_drift?.drift_scores ?? {},
        max_drift: data.feature_drift?.max_drift ?? 0,
        drifted_features: data.feature_drift?.drifted_features ?? [],
        drift_detected: data.feature_drift?.drift_detected ?? false,
        threshold: data.feature_drift?.threshold ?? 0.1,
      },
      performance_drift: {
        baseline_mae: data.performance_drift?.baseline_mae ?? 0,
        current_mae: data.performance_drift?.current_mae ?? 0,
        mae_increase_pct: data.performance_drift?.mae_increase_pct ?? 0,
        drift_detected: data.performance_drift?.drift_detected ?? false,
        threshold_pct: data.performance_drift?.threshold_pct ?? 20,
      },
      target_drift: {
        target_kl_divergence: data.target_drift?.target_kl_divergence ?? 0,
        drift_detected: data.target_drift?.drift_detected ?? false,
        threshold: data.target_drift?.threshold ?? 0.15,
        reference_mean: data.target_drift?.reference_mean ?? 0,
        current_mean: data.target_drift?.current_mean ?? 0,
      },
      recommendation: data.recommendation ?? "No data available",
    };
  }
  return scenario === "alert" ? mockDriftAlert : mockDriftStable;
}

export async function getPipelineStatus(): Promise<{ data: PipelineStatus; isLive: boolean }> {
  const raw = await fetchJson("/api/pipeline-status", null);
  if (raw && raw.tasks) return { data: raw, isLive: true };
  return { data: mockPipelineStatus, isLive: false };
}

/**
 * Fetch the station ID mapping produced by the feature engineering pipeline.
 * Maps A32xxx operational IDs (used in predictions) → GBFS UUIDs (used in stations).
 * Returns null entries if the pipeline hasn't run yet (fallback: skip per-station filtering).
 */
export async function getStationMapping(): Promise<{ start_station_id: string; gbfs_station_id: string | null }[]> {
  const raw = await fetchJson("/api/station-mapping", null);
  if (Array.isArray(raw) && raw.length > 0) return raw;
  return [];
}

export async function getStationStatuses(): Promise<StationStatus[]> {
  return mockStationStatuses;
}

export async function getRebalancingRoutes(): Promise<RebalancingRoute[]> {
  return mockRebalancingRoutes;
}

export async function getDemandHeatmap(): Promise<DemandHeatmapEntry[]> {
  return mockDemandHeatmap;
}

export async function getCostAnalysis(): Promise<CostAnalysis> {
  return mockCostAnalysis;
}
