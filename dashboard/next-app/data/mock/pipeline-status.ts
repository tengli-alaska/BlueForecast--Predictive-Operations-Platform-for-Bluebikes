import type { PipelineStatus } from "@/types";

export const mockPipelineStatus: PipelineStatus = {
  dag_run_id: "bluebikes_pipeline_2024-12-15T06:00:00+00:00",
  overall_status: "success",
  started_at: "2024-12-15T06:00:00Z",
  updated_at: "2024-12-15T06:47:32Z",
  tasks: {
    validate_data_input: {
      status: "success",
      started_at: "2024-12-15T06:00:12Z",
      completed_at: "2024-12-15T06:03:45Z",
    },
    train_and_evaluate: {
      status: "success",
      started_at: "2024-12-15T06:03:48Z",
      completed_at: "2024-12-15T06:31:22Z",
    },
    detect_bias_and_sensitivity: {
      status: "success",
      started_at: "2024-12-15T06:31:25Z",
      completed_at: "2024-12-15T06:39:14Z",
    },
    register_and_predict: {
      status: "success",
      started_at: "2024-12-15T06:39:17Z",
      completed_at: "2024-12-15T06:47:32Z",
    },
  },
  metrics: {
    val_rmse: 1.6131,
    test_rmse: 1.2858,
    bias_status: "PASSED",
    registry_version: 3,
  },
};
