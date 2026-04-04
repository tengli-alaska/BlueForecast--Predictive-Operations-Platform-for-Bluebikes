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
} from "@/types";

import { mockStations } from "./mock/stations";
import { mockPredictions } from "./mock/predictions";
import { mockModelMetrics } from "./mock/model-metrics";
import { mockFeatureImportance } from "./mock/shap-importance";
import { mockBiasReport } from "./mock/bias-report";
import { mockDriftStable, mockDriftAlert } from "./mock/drift-report";
import { mockPipelineStatus } from "./mock/pipeline-status";
import { mockStationStatuses, mockRebalancingRoutes, mockDemandHeatmap } from "./mock/rebalancing";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchJson<T>(path: string, fallback: T): Promise<any> {
  try {
    const res = await fetch(`${API}${path}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } catch {
    return null;
  }
}

export async function getStations(): Promise<Station[]> {
  const data = await fetchJson("/api/stations", null);
  if (Array.isArray(data) && data.length > 0) return data;
  return mockStations;
}

export async function getPredictions(stationId?: string): Promise<Prediction[]> {
  const url = stationId ? `/api/predictions?station_id=${stationId}` : "/api/predictions";
  const data = await fetchJson(url, null);
  if (Array.isArray(data) && data.length > 0) return data;
  return stationId ? mockPredictions.filter(p => p.station_id === stationId) : mockPredictions;
}

export async function getModelMetrics(): Promise<ModelMetrics[]> {
  return mockModelMetrics;
}

export async function getLatestMetrics(): Promise<ModelMetrics> {
  const data = await fetchJson("/api/metrics/latest", null);
  if (data && data.run_id) {
    return {
      run_id: data.run_id,
      model_type: data.model_type || "XGBoostForecaster",
      val_rmse: data.val_rmse ?? 0,
      val_mae: data.val_mae ?? (data.val_rmse ? data.val_rmse * 0.5 : 0),
      val_r2: data.val_r2 ?? data.test_r2 ?? 0,
      test_rmse: data.test_rmse ?? 0,
      test_mae: data.test_mae ?? (data.test_rmse ? data.test_rmse * 0.5 : 0),
      test_r2: data.test_r2 ?? 0,
      best_iteration: data.best_iteration ?? 0,
      validation_status: data.validation_status ?? "PASSED",
      trained_at: data.promoted_at ?? new Date().toISOString(),
      thresholds: { max_test_rmse: 2.5, min_test_r2: 0.5, max_test_mae: 1.5 },
    } as ModelMetrics;
  }
  return mockModelMetrics[mockModelMetrics.length - 1];
}

export async function getFeatureImportance(): Promise<FeatureImportance[]> {
  return mockFeatureImportance;
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

export async function getPipelineStatus(): Promise<PipelineStatus> {
  const data = await fetchJson("/api/pipeline-status", null);
  if (data && data.tasks) return data;
  return mockPipelineStatus;
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
