export const COLORS = {
  blue: "#3b82f6",
  green: "#22c55e",
  yellow: "#eab308",
  red: "#ef4444",
  orange: "#f97316",
  purple: "#a855f7",
  cyan: "#06b6d4",
  pink: "#ec4899",
  bgPrimary: "#0a0e17",
  bgSecondary: "#111827",
  bgTertiary: "#1f2937",
  textPrimary: "#f1f5f9",
  textSecondary: "#94a3b8",
  border: "#1e293b",
} as const;

export const CHART_COLORS = [
  "#3b82f6",
  "#22c55e",
  "#eab308",
  "#ef4444",
  "#a855f7",
  "#06b6d4",
  "#f97316",
  "#ec4899",
];

export const BOSTON_CENTER = { lat: 42.3601, lng: -71.0589 };

export const THRESHOLDS = {
  max_test_rmse: 2.5,
  min_test_r2: 0.5,
  max_test_mae: 1.5,
  bias_disparity: 5.0,
  drift_kl: 0.1,
  drift_performance_pct: 20.0,
  drift_target_kl: 0.15,
} as const;
