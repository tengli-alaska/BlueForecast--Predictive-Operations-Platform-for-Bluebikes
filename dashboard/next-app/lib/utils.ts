import type { Station, Prediction, StationStatus } from "@/types";

export function formatNumber(value: number, decimals = 2): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatPercent(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatHour(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export function getDemandColor(demand: number): string {
  if (demand >= 5) return "#ef4444";
  if (demand >= 3) return "#f97316";
  if (demand >= 1.5) return "#eab308";
  if (demand >= 0.5) return "#22c55e";
  return "#3b82f6";
}

export function getStatusColor(status: string): string {
  switch (status) {
    case "success":
    case "PASSED":
      return "#22c55e";
    case "running":
    case "in_progress":
      return "#3b82f6";
    case "failed":
    case "FAILED":
      return "#ef4444";
    case "pending":
      return "#94a3b8";
    default:
      return "#94a3b8";
  }
}

export function clampDemandSize(demand: number, min = 6, max = 20): number {
  return Math.min(max, Math.max(min, demand * 3 + min));
}

// Shared station risk derivation — used by Overview and Rebalancing pages.
// Derives predicted risk from real model predictions. This is NOT live dock
// occupancy; it is demand-forecast-based risk. Label it as such in the UI.
export function deriveStationStatuses(
  stations: Station[],
  predictions: Prediction[],
  limit = 60,
): StationStatus[] {
  const demandByStation: Record<string, number[]> = {};
  for (const p of predictions) {
    if (!demandByStation[p.station_id]) demandByStation[p.station_id] = [];
    demandByStation[p.station_id].push(p.predicted_demand);
  }

  // Compute network-wide avg demand to set thresholds relative to real data
  const allDemands = Object.values(demandByStation).flat();
  const networkAvg = allDemands.length > 0
    ? allDemands.reduce((a, b) => a + b, 0) / allDemands.length
    : 1;
  // Thresholds: top 15% = critical, top 35% = low, bottom 15% = surplus
  const criticalThreshold = networkAvg * 2.0;
  const lowThreshold = networkAvg * 1.3;
  const surplusThreshold = networkAvg * 0.4;

  return stations.slice(0, limit).map((s) => {
    const demands = demandByStation[s.station_id] ?? [];
    const avg = demands.length > 0 ? demands.reduce((a, b) => a + b, 0) / demands.length : 0;
    const peak = demands.length > 0 ? Math.max(...demands) : 0;

    // fill_pct: high demand = low fill (bikes being taken), low demand = high fill
    const fill_pct = Math.min(95, Math.max(5, Math.round(80 - (avg / (networkAvg || 1)) * 35)));
    const current_bikes = Math.round((fill_pct / 100) * s.capacity);

    let risk_level: StationStatus["risk_level"] = "moderate";
    if (avg >= criticalThreshold || peak >= criticalThreshold * 1.5) risk_level = "critical";
    else if (avg >= lowThreshold) risk_level = "low";
    else if (avg <= surplusThreshold) risk_level = "surplus";

    return {
      station_id: s.station_id,
      current_bikes,
      capacity: s.capacity,
      fill_pct,
      predicted_demand_1h: parseFloat(avg.toFixed(1)),
      predicted_demand_6h: parseFloat((avg * 6).toFixed(1)),
      risk_level,
      net_flow_1h:
        risk_level === "critical" ? -Math.ceil(avg)
        : risk_level === "surplus" ? Math.ceil(avg * 0.5)
        : 0,
    };
  });
}
