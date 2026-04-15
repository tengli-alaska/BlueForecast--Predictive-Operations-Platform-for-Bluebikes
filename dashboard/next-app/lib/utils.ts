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
  // Group predictions by station_id
  const demandByStation: Record<string, number[]> = {};
  for (const p of predictions) {
    if (!demandByStation[p.station_id]) demandByStation[p.station_id] = [];
    demandByStation[p.station_id].push(p.predicted_demand);
  }

  // Compute network-wide avg demand per hour per station
  const allDemands = Object.values(demandByStation).flat();
  const networkAvg = allDemands.length > 0
    ? allDemands.reduce((a, b) => a + b, 0) / allDemands.length
    : 1;
  const criticalThreshold = networkAvg * 2.0;
  const lowThreshold = networkAvg * 1.3;
  const surplusThreshold = networkAvg * 0.4;

  // Build capacity lookup from stations (keyed by station_id)
  const capacityById: Record<string, number> = {};
  for (const s of stations) capacityById[s.station_id] = s.capacity;

  // Derive statuses from prediction station IDs (not station list)
  // This avoids the UUID vs short-ID mismatch between /api/stations and /api/predictions
  const predictionStationIds = Object.keys(demandByStation)
    .sort((a, b) => {
      const avgA = demandByStation[a].reduce((x, y) => x + y, 0) / demandByStation[a].length;
      const avgB = demandByStation[b].reduce((x, y) => x + y, 0) / demandByStation[b].length;
      return avgB - avgA; // sort by demand desc so critical stations come first
    })
    .slice(0, limit);

  return predictionStationIds.map((sid) => {
    const demands = demandByStation[sid];
    const avg = demands.reduce((a, b) => a + b, 0) / demands.length;
    const peak = Math.max(...demands);
    const capacity = capacityById[sid] ?? 20; // fallback capacity

    const fill_pct = Math.min(95, Math.max(5, Math.round(80 - (avg / (networkAvg || 1)) * 35)));
    const current_bikes = Math.round((fill_pct / 100) * capacity);

    let risk_level: StationStatus["risk_level"] = "moderate";
    if (avg >= criticalThreshold || peak >= criticalThreshold * 1.5) risk_level = "critical";
    else if (avg >= lowThreshold) risk_level = "low";
    else if (avg <= surplusThreshold) risk_level = "surplus";

    return {
      station_id: sid,
      current_bikes,
      capacity,
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
