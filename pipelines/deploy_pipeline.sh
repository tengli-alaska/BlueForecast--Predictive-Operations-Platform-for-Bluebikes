#!/bin/bash
set -e
PROJECT_ID="bluebikes-demand-predictor"
REGION="us-east1"
BUCKET="bluebikes-demand-predictor-data"
SERVICE_ACCOUNT="data-pipeline-sa@${PROJECT_ID}.iam.gserviceaccount.com"
WORKFLOW_NAME="bluebikes-data-pipeline"
SCHEDULER_JOB_NAME="bluebikes-pipeline-trigger"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"
JOBS_DIR="${PROJECT_ROOT}/jobs"

echo "================================================================"
echo "  BlueForecast Data Pipeline - Deployment"
echo "================================================================"

echo "Step 1: Setting project and region..."
gcloud config set project ${PROJECT_ID} --quiet
gcloud config set compute/region ${REGION} --quiet
echo "✓ Project and region configured"

echo "Step 2: Enabling required APIs..."
gcloud services enable dataproc.googleapis.com workflows.googleapis.com workflowexecutions.googleapis.com cloudscheduler.googleapis.com --quiet
echo "✓ All APIs enabled"

echo "Step 3: Granting IAM permissions..."
for ROLE in roles/storage.objectAdmin roles/dataproc.editor roles/dataproc.worker roles/workflows.invoker roles/iam.serviceAccountUser roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding ${PROJECT_ID} --member="serviceAccount:${SERVICE_ACCOUNT}" --role="${ROLE}" --quiet > /dev/null 2>&1
done
PROJECT_NUMBER=$(gcloud projects describe ${PROJECT_ID} --format="value(projectNumber)")
WORKFLOWS_SA="service-${PROJECT_NUMBER}@gcp-sa-workflows.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding ${PROJECT_ID} --member="serviceAccount:${WORKFLOWS_SA}" --role="roles/dataproc.editor" --quiet > /dev/null 2>&1
gcloud projects add-iam-policy-binding ${PROJECT_ID} --member="serviceAccount:${WORKFLOWS_SA}" --role="roles/iam.serviceAccountUser" --quiet > /dev/null 2>&1
echo "✓ All IAM permissions granted"

echo "Step 4: Uploading PySpark jobs to GCS..."
gsutil cp "${JOBS_DIR}/production_cleaning_pipeline.py" "gs://${BUCKET}/jobs/production_cleaning_pipeline.py"
gsutil cp "${JOBS_DIR}/production_demand_aggregation.py" "gs://${BUCKET}/jobs/production_demand_aggregation.py"
gsutil cp "${JOBS_DIR}/production_feature_engineering.py" "gs://${BUCKET}/jobs/production_feature_engineering.py"
echo "✓ All PySpark jobs uploaded"

echo "Step 5: Deploying Cloud Workflow..."
gcloud workflows deploy ${WORKFLOW_NAME} --location=${REGION} --source="${SCRIPT_DIR}/workflow.yaml" --service-account="${SERVICE_ACCOUNT}" --quiet
echo "✓ Workflow deployed: ${WORKFLOW_NAME}"

echo "Step 6: Setting up Cloud Scheduler..."
gcloud scheduler jobs delete ${SCHEDULER_JOB_NAME} --location=${REGION} --quiet 2>/dev/null || true
WORKFLOW_URI="https://workflowexecutions.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/workflows/${WORKFLOW_NAME}/executions"
gcloud scheduler jobs create http ${SCHEDULER_JOB_NAME} --location=${REGION} --schedule="0 7 1 1,4,7,10 *" --time-zone="America/New_York" --uri="${WORKFLOW_URI}" --http-method=POST --body="{}" --oauth-service-account-email="${SERVICE_ACCOUNT}" --quiet
echo "✓ Scheduler created (quarterly: 1st of Jan, Apr, Jul, Oct at 2AM EST)"

echo ""
echo "================================================================"
echo "  DEPLOYMENT COMPLETE!"
echo "================================================================"
echo "  ✓ PySpark jobs → gs://${BUCKET}/jobs/"
echo "  ✓ Cloud Workflow: ${WORKFLOW_NAME}"
echo "  ✓ Cloud Scheduler: ${SCHEDULER_JOB_NAME}"
echo ""
echo "  Run manually:  gcloud workflows run ${WORKFLOW_NAME} --location=${REGION}"
echo "  Check status:  gcloud workflows executions list ${WORKFLOW_NAME} --location=${REGION}"
echo "  View batches:  gcloud dataproc batches list --region=${REGION}"
echo "================================================================"
