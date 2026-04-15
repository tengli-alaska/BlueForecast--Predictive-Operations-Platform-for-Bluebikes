import type { CostAnalysis } from "@/types";

// Cost estimates based on actual repo specs + GCP public pricing (us-east1):
//
// Cloud Run: $0.00002400/vCPU-sec, $0.00000250/GB-sec, scale-to-zero
//   Assuming ~8hrs/day active (ops team hours), 1 CPU, 0.5GB
//   = ~$4–12/mo per service depending on traffic
//
// GCS Standard: $0.020/GB/mo storage + $0.004/10k ops
//   Estimated data: raw CSVs + processed parquet + MLflow artifacts ~50–150 GB
//   = ~$1–3/mo
//
// Artifact Registry: $0.10/GB/mo after 0.5 GB free
//   Two Docker images ~2–4 GB total = ~$0.15–0.35/mo
//
// Cloud Dataproc: n1-standard-4 = $0.0475/hr per node (VM) + $0.010/vCPU-hr (Dataproc fee)
//   3 nodes, idle-delete 1hr — runs only during pipeline (~15 min data + 25–75 min training)
//   ~2–4 pipeline runs/mo = ~$0.50–2/mo
//
// Cloud Logging: first 50 GB/mo free; minimal for 2 Cloud Run services
//   = ~$0/mo
//
// Total est: ~$10–30/mo under normal ops-team usage

// Expansion estimate — SF Bay Wheels (Lyft):
//   ~800 stations vs Boston 534 = ~1.5× station count
//   Data volume scales roughly with stations + trip density
//   SF has higher trip density than Boston → est ~1.6–1.8× Boston data volume
//   Marginal cost = additional GCS storage (~80–200 GB more) + longer training runs
//   (~35–40 min extra on Dataproc for larger feature matrix)
//   Cloud Run + Artifact Registry: same images, negligible marginal cost
//   Marginal storage: ~$2–4/mo | Marginal compute: ~$2–6/mo
//   Total marginal: ~$4–10/mo on top of Boston baseline

export const mockCostAnalysis: CostAnalysis = {
  est_total_monthly_low_usd: 10,
  est_total_monthly_high_usd: 30,
  boston_context: "534 stations · 8.2M station-hour rows · 32 features · Apr 2023–Dec 2024",
  expansion: [
    {
      city: "San Francisco",
      operator: "Bay Wheels (Lyft)",
      stations: 800,
      trips_annual_est: "~4–5M trips/yr",
      marginal_storage_gb: "+80–200 GB",
      marginal_training_min: "+35–40 min per run",
      est_marginal_monthly_low_usd: 4,
      est_marginal_monthly_high_usd: 10,
      notes: "~1.5× more stations than Boston · higher trip density · same pipeline, larger feature matrix · Cloud Run scales automatically",
    },
  ],
  services: [
    {
      name: "Cloud Run — API",
      id: "blueforecast-api",
      region: "us-east1",
      memory: "512Mi",
      cpu: "1",
      min_instances: 0,
      max_instances: 3,
      note: "Scales to zero at idle · ~8 hrs/day active",
      est_monthly_low_usd: 3,
      est_monthly_high_usd: 10,
    },
    {
      name: "Cloud Run — Dashboard",
      id: "blueforecast-dashboard",
      region: "us-east1",
      memory: "512Mi",
      cpu: "1",
      min_instances: 0,
      max_instances: 3,
      note: "Scales to zero at idle · ~8 hrs/day active",
      est_monthly_low_usd: 3,
      est_monthly_high_usd: 10,
    },
    {
      name: "Cloud Storage (GCS)",
      id: "bluebikes-demand-predictor-data",
      region: "us-east1",
      memory: null,
      cpu: null,
      min_instances: null,
      max_instances: null,
      note: "Raw, processed, features, predictions, MLflow artifacts · est. 50–150 GB",
      est_monthly_low_usd: 1,
      est_monthly_high_usd: 3,
    },
    {
      name: "Artifact Registry",
      id: "us-east1-docker.pkg.dev/blueforecast",
      region: "us-east1",
      memory: null,
      cpu: null,
      min_instances: null,
      max_instances: null,
      note: "API + Dashboard Docker images · est. 2–4 GB",
      est_monthly_low_usd: 0,
      est_monthly_high_usd: 1,
    },
    {
      name: "Cloud Dataproc",
      id: "bluebikes-processing-cluster",
      region: "us-east1",
      memory: "15 GB × 3 nodes",
      cpu: "4 vCPU × 3 nodes",
      min_instances: null,
      max_instances: null,
      note: "1 master + 2 workers (n1-standard-4) · idle-delete 1hr · runs per pipeline trigger",
      est_monthly_low_usd: 1,
      est_monthly_high_usd: 5,
    },
    {
      name: "Cloud Logging",
      id: "auto (Cloud Run)",
      region: "us-east1",
      memory: null,
      cpu: null,
      min_instances: null,
      max_instances: null,
      note: "Automatic from Cloud Run · first 50 GB/mo free",
      est_monthly_low_usd: 0,
      est_monthly_high_usd: 1,
    },
  ],
  training_durations: [
    { mode: "Data pipeline (both years)", duration: "~15 min", est_cost_usd_low: 0.10, est_cost_usd_high: 0.20 },
    { mode: "Fast run (no HPO, no OAT)", duration: "~25 min", est_cost_usd_low: 0.18, est_cost_usd_high: 0.35 },
    { mode: "Full OAT sweep", duration: "~45 min", est_cost_usd_low: 0.32, est_cost_usd_high: 0.60 },
    { mode: "Full Optuna HPO + OAT", duration: "~75 min", est_cost_usd_low: 0.54, est_cost_usd_high: 1.00 },
  ],
};
