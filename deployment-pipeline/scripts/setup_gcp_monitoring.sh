#!/usr/bin/env bash
# =============================================================================
# BlueForecast — GCP Cloud Monitoring Setup
# =============================================================================
# Creates:
#   1. Uptime check   — alerts if the Cloud Run API /health stops responding
#   2. Log-based alert — alerts if ERROR-level logs appear in the API service
#
# Safe to run multiple times (checks for existing resources before creating).
#
# Usage:
#   export PROJECT_ID="your-gcp-project-id"
#   export NOTIFICATION_EMAIL="your-email@example.com"   # optional
#   bash deployment-pipeline/scripts/setup_gcp_monitoring.sh
# =============================================================================
set -euo pipefail

: "${PROJECT_ID:?PROJECT_ID is required}"

REGION="us-east1"
API_SERVICE="blueforecast-api"
UPTIME_CHECK_NAME="blueforecast-api-health"
ALERT_POLICY_NAME="blueforecast-api-errors"
NOTIFICATION_EMAIL="${NOTIFICATION_EMAIL:-}"

echo "=== BlueForecast GCP Monitoring Setup ==="
echo "Project:  ${PROJECT_ID}"
echo "Service:  ${API_SERVICE}"
echo "Region:   ${REGION}"
echo ""

# ── Fetch the live API URL from Cloud Run ─────────────────────────────────────
echo "--- Fetching API URL from Cloud Run..."
API_URL="$(gcloud run services describe "${API_SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format='value(status.url)' 2>/dev/null || true)"

if [[ -z "${API_URL}" ]]; then
  echo "ERROR: Could not fetch URL for service '${API_SERVICE}'."
  echo "       Ensure the service is deployed before running this script."
  exit 1
fi

API_HOST="${API_URL#https://}"
echo "API URL: ${API_URL}"
echo ""

# ── Enable required GCP APIs ─────────────────────────────────────────────────
echo "--- Enabling monitoring APIs..."
gcloud services enable monitoring.googleapis.com --project="${PROJECT_ID}" --quiet
gcloud services enable logging.googleapis.com    --project="${PROJECT_ID}" --quiet

# ── 1. Uptime Check ───────────────────────────────────────────────────────────
echo ""
echo "--- Setting up uptime check: '${UPTIME_CHECK_NAME}'..."

EXISTING_UPTIME=$(gcloud monitoring uptime list-configs \
  --project="${PROJECT_ID}" \
  --format="value(displayName)" 2>/dev/null | grep -x "${UPTIME_CHECK_NAME}" || true)

if [[ -n "${EXISTING_UPTIME}" ]]; then
  echo "    Uptime check '${UPTIME_CHECK_NAME}' already exists — skipping."
else
  gcloud monitoring uptime create "${UPTIME_CHECK_NAME}" \
    --project="${PROJECT_ID}" \
    --protocol=HTTPS \
    --host="${API_HOST}" \
    --path="/api/health" \
    --check-interval=5m \
    --timeout=10s \
    --regions=USA \
    --quiet
  echo "    Uptime check created. Checks /api/health every 5 minutes."
fi

# ── 2. Notification Channel (email) ──────────────────────────────────────────
CHANNEL_ID=""
if [[ -n "${NOTIFICATION_EMAIL}" ]]; then
  echo ""
  echo "--- Setting up email notification channel for: ${NOTIFICATION_EMAIL}..."

  EXISTING_CHANNEL=$(gcloud alpha monitoring channels list \
    --project="${PROJECT_ID}" \
    --format="value(name)" \
    --filter="type=email AND labels.email_address=${NOTIFICATION_EMAIL}" \
    2>/dev/null | head -1 || true)

  if [[ -n "${EXISTING_CHANNEL}" ]]; then
    CHANNEL_ID="${EXISTING_CHANNEL}"
    echo "    Notification channel already exists — reusing."
  else
    CHANNEL_ID=$(gcloud alpha monitoring channels create \
      --project="${PROJECT_ID}" \
      --display-name="BlueForecast Alerts" \
      --type=email \
      --channel-labels="email_address=${NOTIFICATION_EMAIL}" \
      --format="value(name)" \
      --quiet)
    echo "    Notification channel created: ${CHANNEL_ID}"
  fi
fi

# ── 3. Log-based Alert — ERROR logs in API service ────────────────────────────
echo ""
echo "--- Setting up log-based alert: '${ALERT_POLICY_NAME}'..."

EXISTING_ALERT=$(gcloud alpha monitoring policies list \
  --project="${PROJECT_ID}" \
  --format="value(displayName)" 2>/dev/null | grep -x "${ALERT_POLICY_NAME}" || true)

if [[ -n "${EXISTING_ALERT}" ]]; then
  echo "    Alert policy '${ALERT_POLICY_NAME}' already exists — skipping."
else
  # Build notification channels array for the policy
  CHANNELS_JSON="[]"
  if [[ -n "${CHANNEL_ID}" ]]; then
    CHANNELS_JSON="[\"${CHANNEL_ID}\"]"
  fi

  # Write policy JSON to a temp file
  POLICY_FILE="$(mktemp /tmp/blueforecast_alert_XXXXXX.json)"
  cat > "${POLICY_FILE}" <<POLICY
{
  "displayName": "${ALERT_POLICY_NAME}",
  "conditions": [
    {
      "displayName": "ERROR logs in blueforecast-api",
      "conditionMatchedLog": {
        "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${API_SERVICE}\" AND severity>=ERROR",
        "labelExtractors": {}
      }
    }
  ],
  "alertStrategy": {
    "notificationRateLimit": {
      "period": "3600s"
    }
  },
  "combiner": "OR",
  "enabled": true,
  "notificationChannels": ${CHANNELS_JSON}
}
POLICY

  gcloud alpha monitoring policies create \
    --project="${PROJECT_ID}" \
    --policy-from-file="${POLICY_FILE}" \
    --quiet

  rm -f "${POLICY_FILE}"
  echo "    Alert policy created. Fires on any ERROR log in ${API_SERVICE}."
  echo "    Alert rate-limited to once per hour to prevent spam."
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "=== Monitoring Setup Complete ==="
echo ""
echo "  Uptime check:   Pings ${API_URL}/api/health every 5 minutes"
echo "  Log alert:      Fires on ERROR-level logs in ${API_SERVICE}"
if [[ -n "${NOTIFICATION_EMAIL}" ]]; then
echo "  Notifications:  Email → ${NOTIFICATION_EMAIL}"
else
echo "  Notifications:  No email configured (set NOTIFICATION_EMAIL to enable)"
fi
echo ""
echo "  View in GCP Console:"
echo "  https://console.cloud.google.com/monitoring/uptime?project=${PROJECT_ID}"
echo "  https://console.cloud.google.com/monitoring/alerting?project=${PROJECT_ID}"
