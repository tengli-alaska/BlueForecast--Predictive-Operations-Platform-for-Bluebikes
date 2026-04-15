import type { CostAnalysis } from "@/types";

// Only data verifiable from the repo:
// - Cloud Run: blueforecast-api + blueforecast-dashboard (512Mi, 1 CPU, 0–3 instances, scale-to-zero)
// - GCS bucket: bluebikes-demand-predictor-data
// - Artifact Registry: us-east1-docker.pkg.dev/blueforecast
// - Dataproc: 1x master + 2x worker n1-standard-4, idle-delete 1hr
// - Training durations from Model-Pipeline/README.md

export const mockCostAnalysis: CostAnalysis = {
  services: [
    {
      name: "Cloud Run — API",
      id: "blueforecast-api",
      region: "us-east1",
      memory: "512Mi",
      cpu: "1",
      min_instances: 0,
      max_instances: 3,
      note: "Scales to zero at idle",
    },
    {
      name: "Cloud Run — Dashboard",
      id: "blueforecast-dashboard",
      region: "us-east1",
      memory: "512Mi",
      cpu: "1",
      min_instances: 0,
      max_instances: 3,
      note: "Scales to zero at idle",
    },
    {
      name: "Cloud Storage (GCS)",
      id: "bluebikes-demand-predictor-data",
      region: "us-east1",
      memory: null,
      cpu: null,
      min_instances: null,
      max_instances: null,
      note: "Raw, processed, features, predictions, MLflow artifacts",
    },
    {
      name: "Artifact Registry",
      id: "us-east1-docker.pkg.dev/blueforecast",
      region: "us-east1",
      memory: null,
      cpu: null,
      min_instances: null,
      max_instances: null,
      note: "Docker images for API and Dashboard",
    },
    {
      name: "Cloud Dataproc",
      id: "bluebikes-processing-cluster",
      region: "us-east1",
      memory: "15 GB × 3 nodes",
      cpu: "4 vCPU × 3 nodes",
      min_instances: null,
      max_instances: null,
      note: "1 master + 2 workers (n1-standard-4), idle-delete 1hr",
    },
    {
      name: "Cloud Logging",
      id: "auto (Cloud Run)",
      region: "us-east1",
      memory: null,
      cpu: null,
      min_instances: null,
      max_instances: null,
      note: "Automatic from Cloud Run services",
    },
  ],
  training_durations: [
    { mode: "Fast run (no HPO, no OAT sweep)", duration: "~25 min" },
    { mode: "Full OAT sweep", duration: "~45 min" },
    { mode: "Full Optuna HPO + OAT", duration: "~75 min" },
    { mode: "Data pipeline (both years)", duration: "~15 min" },
  ],
};
