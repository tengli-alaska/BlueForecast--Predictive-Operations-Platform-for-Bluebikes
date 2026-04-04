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
