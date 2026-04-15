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
  // Percentile thresholds computed below from sorted station avgs
  const criticalThreshold = networkAvg * 2.0; // fallback only
  const lowThreshold = networkAvg * 1.3;
  const surplusThreshold = networkAvg * 0.4;

  // Build capacity lookup from stations (keyed by station_id)
  const capacityById: Record<string, number> = {};
  for (const s of stations) capacityById[s.station_id] = s.capacity;

  // Compute per-station averages to determine percentile thresholds
  const stationAvgs = Object.entries(demandByStation).map(([sid, demands]) => ({
    sid,
    avg: demands.reduce((a, b) => a + b, 0) / demands.length,
  }));
  const sortedAvgs = [...stationAvgs].sort((a, b) => a.avg - b.avg);
  const p85 = sortedAvgs[Math.floor(sortedAvgs.length * 0.85)]?.avg ?? criticalThreshold;
  const p65 = sortedAvgs[Math.floor(sortedAvgs.length * 0.65)]?.avg ?? lowThreshold;
  const p15 = sortedAvgs[Math.floor(sortedAvgs.length * 0.15)]?.avg ?? surplusThreshold;

  // Take all prediction station IDs (not pre-sorted by demand)
  const predictionStationIds = Object.keys(demandByStation).slice(0, limit);

  return predictionStationIds.map((sid) => {
    const demands = demandByStation[sid];
    const avg = demands.reduce((a, b) => a + b, 0) / demands.length;
    const peak = Math.max(...demands);
    const capacity = capacityById[sid] ?? 20; // fallback capacity

    const fill_pct = Math.min(95, Math.max(5, Math.round(80 - (avg / (networkAvg || 1)) * 35)));
    const current_bikes = Math.round((fill_pct / 100) * capacity);

    // Use percentile thresholds: top 15% = critical, 65th-85th = low, bottom 15% = surplus
    let risk_level: StationStatus["risk_level"] = "moderate";
    if (avg >= p85) risk_level = "critical";
    else if (avg >= p65) risk_level = "low";
    else if (avg <= p15) risk_level = "surplus";

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
