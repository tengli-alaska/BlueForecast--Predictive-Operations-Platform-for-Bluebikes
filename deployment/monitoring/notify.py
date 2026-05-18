"""
notify.py
Sends Slack and/or email notifications when:
  - Data drift is detected
  - Concept drift is detected
  - Retraining is triggered
  - A new model is promoted to production
  - Model performance degrades below threshold

Set these environment variables (add to GitHub Actions secrets):
  SLACK_WEBHOOK_URL  — Slack incoming webhook URL
  NOTIFY_EMAIL       — recipient email address (optional)
  SMTP_HOST          — SMTP server host (optional)
  SMTP_PORT          — SMTP server port (optional, default 587)
  SMTP_USER          — SMTP username (optional)
  SMTP_PASS          — SMTP password (optional)
"""

import json
import logging
import os
import smtplib
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import requests

log = logging.getLogger(__name__)

SLACK_WEBHOOK_URL = os.getenv("SLACK_WEBHOOK_URL", "")
NOTIFY_EMAIL      = os.getenv("NOTIFY_EMAIL", "")
SMTP_HOST         = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT         = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER         = os.getenv("SMTP_USER", "")
SMTP_PASS         = os.getenv("SMTP_PASS", "")

PROJECT_NAME = "BlueForecast — Bluebikes MLOps"


# ─── Slack ────────────────────────────────────────────────────────────────────

def _slack_color(event_type: str) -> str:
    return {
        "drift":    "#FF9F0A",
        "retrain":  "#0057FF",
        "promote":  "#34C759",
        "degraded": "#FF3B30",
        "ok":       "#34C759",
    }.get(event_type, "#888888")


def send_slack(title: str, message: str, event_type: str = "ok", fields: dict = None) -> bool:
    """Send a Slack notification via incoming webhook."""
    if not SLACK_WEBHOOK_URL:
        log.warning("SLACK_WEBHOOK_URL not set — skipping Slack notification")
        return False

    attachment_fields = []
    if fields:
        for k, v in fields.items():
            attachment_fields.append({"title": k, "value": str(v), "short": True})

    payload = {
        "attachments": [{
            "color":    _slack_color(event_type),
            "title":    f"🚲 {PROJECT_NAME} | {title}",
            "text":     message,
            "fields":   attachment_fields,
            "footer":   "BlueForecast Monitoring",
            "ts":       int(datetime.utcnow().timestamp()),
        }]
    }

    try:
        resp = requests.post(SLACK_WEBHOOK_URL, json=payload, timeout=10)
        resp.raise_for_status()
        log.info(f"Slack notification sent: {title}")
        return True
    except Exception as e:
        log.error(f"Slack notification failed: {e}")
        return False


# ─── Email ────────────────────────────────────────────────────────────────────

def send_email(subject: str, body: str) -> bool:
    """Send an email notification via SMTP."""
    if not NOTIFY_EMAIL or not SMTP_USER or not SMTP_PASS:
        log.warning("Email config incomplete — skipping email notification")
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"[BlueForecast] {subject}"
        msg["From"]    = SMTP_USER
        msg["To"]      = NOTIFY_EMAIL

        html = f"""
        <html><body style="font-family:sans-serif; color:#0A0E1A; padding:20px;">
          <h2 style="color:#0057FF;">🚲 {PROJECT_NAME}</h2>
          <h3>{subject}</h3>
          <pre style="background:#F2F5FB; padding:14px; border-radius:8px;
                      font-size:13px; line-height:1.6;">{body}</pre>
          <p style="color:#6B7594; font-size:12px;">
            Sent by BlueForecast Monitoring · {datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")}
          </p>
        </body></html>
        """
        msg.attach(MIMEText(body, "plain"))
        msg.attach(MIMEText(html, "html"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_USER, NOTIFY_EMAIL, msg.as_string())

        log.info(f"Email sent to {NOTIFY_EMAIL}: {subject}")
        return True
    except Exception as e:
        log.error(f"Email notification failed: {e}")
        return False


# ─── High-level notification functions ────────────────────────────────────────

def notify_drift_detected(drift_report: dict):
    """Called when data or concept drift is detected."""
    data_drift    = drift_report.get("data_drift", {})
    concept_drift = drift_report.get("concept_drift", {})

    lines = ["Drift detected in BlueForecast model monitoring.\n"]

    if data_drift.get("drifted"):
        share = data_drift.get("drift_share", 0)
        cols  = data_drift.get("drifted_cols", 0)
        lines.append(f"• Data Drift: {cols} features drifted ({share:.0%} of features)")

    if concept_drift.get("drifted"):
        inc      = concept_drift.get("relative_increase", 0)
        new_rmse = concept_drift.get("recent_rmse", "N/A")
        train    = concept_drift.get("training_rmse", "N/A")
        lines.append(f"• Concept Drift: RMSE increased by {inc:.0%}")
        lines.append(f"  Training RMSE: {train} → Recent RMSE: {new_rmse}")

    message = "\n".join(lines)

    send_slack(
        title="⚠️ Drift Detected — Retraining May Be Triggered",
        message=message,
        event_type="drift",
        fields={
            "Data Drift":    f"{data_drift.get('drift_share', 0):.0%} features drifted" if data_drift.get("drifted") else "None",
            "Concept Drift": f"RMSE +{concept_drift.get('relative_increase', 0):.0%}" if concept_drift.get("drifted") else "None",
            "Detected At":   drift_report.get("date", datetime.utcnow().strftime("%Y-%m-%d")),
        }
    )
    send_email("⚠️ Drift Detected", message)


def notify_retrain_triggered(reason: str, run_id: str = ""):
    """Called when auto-retraining is triggered."""
    message = (
        f"Automatic retraining has been triggered.\n\n"
        f"Reason: {reason}\n"
        f"Run ID: {run_id or 'N/A'}\n"
        f"Time:   {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}\n\n"
        f"The pipeline will pull latest data, retrain XGBoost, validate, and promote if better."
    )
    send_slack(
        title="🔄 Retraining Triggered",
        message=message,
        event_type="retrain",
        fields={"Reason": reason, "Run ID": run_id or "auto"}
    )
    send_email("🔄 Retraining Triggered", message)


def notify_model_promoted(new_rmse: float, old_rmse: float):
    """Called when a new model is promoted to production."""
    improvement = ((old_rmse - new_rmse) / old_rmse) * 100
    message = (
        f"A new XGBoost model has been promoted to production.\n\n"
        f"Previous RMSE: {old_rmse:.4f}\n"
        f"New RMSE:      {new_rmse:.4f}\n"
        f"Improvement:   {improvement:.1f}%\n"
        f"Promoted At:   {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}"
    )
    send_slack(
        title="✅ New Model Promoted to Production",
        message=message,
        event_type="promote",
        fields={
            "Old RMSE":    f"{old_rmse:.4f}",
            "New RMSE":    f"{new_rmse:.4f}",
            "Improvement": f"{improvement:.1f}%",
        }
    )
    send_email("✅ New Model Promoted to Production", message)


def notify_retrain_skipped(new_rmse: float, old_rmse: float):
    """Called when retraining ran but new model was not better."""
    message = (
        f"Retraining completed but new model did NOT improve performance.\n\n"
        f"Production RMSE: {old_rmse:.4f}\n"
        f"New Model RMSE:  {new_rmse:.4f}\n"
        f"Decision:        Keeping existing production model.\n"
        f"Checked At:      {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}"
    )
    send_slack(
        title="ℹ️ Retraining Complete — Model Not Promoted",
        message=message,
        event_type="ok",
        fields={
            "Production RMSE": f"{old_rmse:.4f}",
            "New Model RMSE":  f"{new_rmse:.4f}",
            "Decision":        "Keep existing model",
        }
    )
    send_email("ℹ️ Retraining Complete — Model Not Promoted", message)


def notify_performance_degraded(rmse_7d: float, baseline_rmse: float):
    """Called when rolling 7-day RMSE exceeds threshold."""
    ratio = rmse_7d / baseline_rmse
    message = (
        f"Model performance has degraded beyond the alert threshold.\n\n"
        f"7-Day Rolling RMSE: {rmse_7d:.4f}\n"
        f"Baseline RMSE:      {baseline_rmse:.4f}\n"
        f"Ratio:              {ratio:.2f}x (threshold: 1.5x)\n"
        f"Detected At:        {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}"
    )
    send_slack(
        title="🚨 Model Performance Degraded",
        message=message,
        event_type="degraded",
        fields={
            "7d RMSE":   f"{rmse_7d:.4f}",
            "Baseline":  f"{baseline_rmse:.4f}",
            "Ratio":     f"{ratio:.2f}x",
        }
    )
    send_email("🚨 Model Performance Degraded", message)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    # Test with a dummy drift report
    test_report = {
        "date": datetime.utcnow().strftime("%Y-%m-%d"),
        "data_drift":    {"drifted": True,  "drift_share": 0.35, "drifted_cols": 8},
        "concept_drift": {"drifted": True,  "relative_increase": 0.32,
                          "recent_rmse": 4.1, "training_rmse": 3.4},
    }
    notify_drift_detected(test_report)
    notify_retrain_triggered("data_drift, concept_drift", run_id="auto_20241218_030000")
    notify_model_promoted(new_rmse=3.1, old_rmse=3.4)
