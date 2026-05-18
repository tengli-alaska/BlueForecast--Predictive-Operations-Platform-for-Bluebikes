#!/usr/bin/env bash
set -euo pipefail

: "${API_URL:?API_URL is required}"

echo "=== Verifying API health ==="
curl -sf "${API_URL}/api/health"

if [[ -n "${DASHBOARD_URL:-}" ]]; then
  echo "=== Deployment Complete ==="
  echo "API:       ${API_URL}"
  echo "Dashboard: ${DASHBOARD_URL}"
fi
