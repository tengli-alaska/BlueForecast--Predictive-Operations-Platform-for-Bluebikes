export interface Station {
  station_id: string;
  station_name: string;
  lat: number;
  lon: number;
  capacity: number;
  has_kiosk: boolean;
}

export interface Prediction {
  station_id: string;
  forecast_hour: string;
  predicted_demand: number;
  peak_demand?: number;
  model_version: number;
  generated_at: string;
}

export interface ModelMetrics {
  run_id: string;
  model_type: string;
  val_rmse: number;
  val_mae: number;
  val_r2: number;
  test_rmse: number;
  test_mae: number;
  test_r2: number;
  best_iteration: number;
  validation_status: "PASSED" | "FAILED";
  trained_at: string;
  thresholds: {
    max_test_rmse: number;
    min_test_r2: number;
    max_test_mae: number;
  };
}

export interface FeatureImportance {
  feature: string;
  shap_value: number;
  xgboost_gain: number;
  category: "lag" | "rolling" | "weather" | "time" | "station";
}

export interface BiasGroup {
  group: string;
  count: number;
  representation_pct: number;
  mean_demand: number;
  median_demand: number;
  zero_demand_pct: number;
}

export interface BiasSlice {
  slice_name: string;
  groups: BiasGroup[];
  disparity_ratio: number;
  flags: string[];
}

export interface BiasReport {
  total_rows: number;
  slices: BiasSlice[];
  total_flags: number;
}

export interface DriftReport {
  overall_drift_detected: boolean;
  feature_drift: {
    drift_scores: Record<string, number>;
    max_drift: number;
    drifted_features: string[];
    drift_detected: boolean;
    threshold: number;
  };
  performance_drift: {
    baseline_mae: number;
    current_mae: number;
    mae_increase_pct: number;
    drift_detected: boolean;
    threshold_pct: number;
  };
  target_drift: {
    target_kl_divergence: number;
    drift_detected: boolean;
    threshold: number;
    reference_mean: number;
    current_mean: number;
  };
  recommendation: string;
}

export interface TaskStatus {
  status: "pending" | "running" | "success" | "failed";
  started_at?: string;
  completed_at?: string;
}

export interface PipelineStatus {
  dag_run_id: string;
  overall_status: "running" | "success" | "failed";
  started_at: string;
  updated_at: string;
  tasks: Record<string, TaskStatus>;
  metrics: {
    val_rmse: number | null;
    test_rmse: number | null;
    bias_status: string | null;
    registry_version: number | null;
  };
}

export type NavItem = {
  label: string;
  href: string;
  icon: string;
};

export interface StationStatus {
  station_id: string;
  current_bikes: number;
  capacity: number;
  fill_pct: number;
  predicted_demand_1h: number;
  predicted_demand_6h: number;
  risk_level: "critical" | "low" | "moderate" | "surplus";
  net_flow_1h: number; // positive = bikes arriving, negative = leaving
}

export interface RebalancingRoute {
  route_id: string;
  truck_id: string;
  stops: RebalancingStop[];
  total_distance_km: number;
  estimated_duration_min: number;
  bikes_moved: number;
  status: "active" | "planned" | "completed";
}

export interface RebalancingStop {
  station_id: string;
  station_name: string;
  lat: number;
  lon: number;
  action: "pickup" | "dropoff";
  bikes: number;
  order: number;
}

export interface DemandHeatmapEntry {
  hour: number;
  day: string;
  demand: number;
}

export interface InfraService {
  name: string;
  id: string;
  region: string;
  memory: string | null;
  cpu: string | null;
  min_instances: number | null;
  max_instances: number | null;
  note: string;
  est_monthly_low_usd: number;
  est_monthly_high_usd: number;
}

export interface TrainingDuration {
  mode: string;
  duration: string;
  est_cost_usd_low: number;
  est_cost_usd_high: number;
}

export interface ExpansionCity {
  city: string;
  operator: string;
  stations: number;
  trips_annual_est: string;
  marginal_storage_gb: string;
  marginal_training_min: string;
  est_marginal_monthly_low_usd: number;
  est_marginal_monthly_high_usd: number;
  notes: string;
}

export interface CostAnalysis {
  services: InfraService[];
  training_durations: TrainingDuration[];
  est_total_monthly_low_usd: number;
  est_total_monthly_high_usd: number;
  boston_context: string;
  expansion: ExpansionCity[];
}
