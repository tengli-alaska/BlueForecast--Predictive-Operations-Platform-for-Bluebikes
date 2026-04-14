#!/usr/bin/env bash
set -euo pipefail

: "${API_SERVICE:?API_SERVICE is required}"
: "${REGION:?REGION is required}"
: "${REFRESH_TOKEN:?REFRESH_TOKEN is required}"

gcloud run services update "${API_SERVICE}" \
  --region="${REGION}" \
  --update-env-vars="MODEL_REFRESHED_AT=${REFRESH_TOKEN}" \
  --quiet
