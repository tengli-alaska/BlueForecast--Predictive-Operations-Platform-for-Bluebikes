#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"

if [[ -z "${ACTION}" ]]; then
  echo "Usage: $0 <build-push|deploy>"
  exit 1
fi

: "${PROJECT_ID:?PROJECT_ID is required}"
: "${REGION:?REGION is required}"
: "${REGISTRY:?REGISTRY is required}"
: "${REPO:?REPO is required}"
: "${API_SERVICE:?API_SERVICE is required}"
: "${DASHBOARD_SERVICE:?DASHBOARD_SERVICE is required}"
: "${IMAGE_TAG:?IMAGE_TAG is required}"

API_IMAGE="${REGISTRY}/${PROJECT_ID}/${REPO}/${API_SERVICE}:${IMAGE_TAG}"
DASHBOARD_IMAGE="${REGISTRY}/${PROJECT_ID}/${REPO}/${DASHBOARD_SERVICE}:${IMAGE_TAG}"

case "${ACTION}" in
  build-push)
    gcloud auth configure-docker "${REGISTRY}" --quiet

    docker build -t "${API_IMAGE}" dashboard/api
    docker push "${API_IMAGE}"

    docker build -t "${DASHBOARD_IMAGE}" dashboard/next-app
    docker push "${DASHBOARD_IMAGE}"

    echo "API_IMAGE=${API_IMAGE}" >> "${GITHUB_ENV:-/dev/null}"
    echo "DASHBOARD_IMAGE=${DASHBOARD_IMAGE}" >> "${GITHUB_ENV:-/dev/null}"
    ;;

  deploy)
    gcloud run deploy "${API_SERVICE}" \
      --image="${API_IMAGE}" \
      --platform=managed \
      --region="${REGION}" \
      --allow-unauthenticated \
      --memory=512Mi \
      --cpu=1 \
      --min-instances=0 \
      --max-instances=3 \
      --port=8000 \
      --set-env-vars="GCS_BUCKET=bluebikes-demand-predictor-data,GOOGLE_CLOUD_PROJECT=${PROJECT_ID}" \
      --quiet

    API_URL="$(gcloud run services describe "${API_SERVICE}" \
      --region="${REGION}" \
      --format='value(status.url)')"
    echo "API_URL=${API_URL}" >> "${GITHUB_ENV:-/dev/null}"
    echo "API deployed at: ${API_URL}"

    gcloud run deploy "${DASHBOARD_SERVICE}" \
      --image="${DASHBOARD_IMAGE}" \
      --platform=managed \
      --region="${REGION}" \
      --allow-unauthenticated \
      --memory=512Mi \
      --cpu=1 \
      --min-instances=0 \
      --max-instances=3 \
      --set-env-vars="API_BASE_URL=${API_URL}" \
      --quiet

    DASHBOARD_URL="$(gcloud run services describe "${DASHBOARD_SERVICE}" \
      --region="${REGION}" \
      --format='value(status.url)')"
    echo "DASHBOARD_URL=${DASHBOARD_URL}" >> "${GITHUB_ENV:-/dev/null}"
    echo "Dashboard deployed at: ${DASHBOARD_URL}"

    gcloud run services update "${API_SERVICE}" \
      --region="${REGION}" \
      --update-env-vars="DASHBOARD_URL=${DASHBOARD_URL}" \
      --quiet
    ;;

  *)
    echo "Unknown action: ${ACTION}"
    exit 1
    ;;
esac
