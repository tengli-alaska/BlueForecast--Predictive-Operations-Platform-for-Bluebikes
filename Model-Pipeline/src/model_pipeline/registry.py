"""
Model registry push and rollback gate for BlueForecast.

PROMOTION POLICY:
  1. Rollback gate: reject if new val_rmse > current champion val_rmse × 1.10
  2. Register to MLflow Model Registry under 'BlueForecast-Demand'
  3. Stage: Staging (Production requires manual lead approval in MLflow UI)
  4. Champion alias moves to new version; old champion aliased 'previous-champion'
  5. GCS approved pointer updated: processed/models/approved/metadata.json

The GCS pointer is the contract between the model pipeline and all consumers
(dashboard, predictor). Consumers never query MLflow directly — they read the
pointer file and load the model version it references.

ROLLBACK:
  If a future model is rejected by the rollback gate, the champion pointer
  and all aliases remain unchanged. The rejected run is tagged 'rollback-rejected'
  in MLflow for traceability. To force-promote a rejected model, the lead must
  call register_model(..., force_promote=True) — this is logged explicitly.
"""

import json
import logging
import os
import subprocess
from datetime import datetime, timezone

import mlflow
import mlflow.xgboost
from google.cloud import storage
from mlflow.tracking import MlflowClient

logger = logging.getLogger("model_pipeline.registry")
logger.setLevel(logging.INFO)

BUCKET          = "bluebikes-demand-predictor-data"
REGISTRY_NAME   = "BlueForecast-Demand"
ROLLBACK_THRESHOLD = 1.10  # reject if new_rmse > champion_rmse × this


class RegistryPromotionError(Exception):
    """
    Raised when a model fails the rollback gate and cannot be promoted.
    The current champion is untouched when this is raised.
    """


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_commit_sha() -> str:
    """Get current git short SHA. Falls back to env var or 'local-dev'."""
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            stderr=subprocess.DEVNULL,
        ).decode().strip()
    except Exception:
        return os.getenv("GIT_COMMIT_SHA", "local-dev")


def _get_current_champion(client: MlflowClient) -> tuple[str | None, str | None, float | None]:
    """
    Return (champion_run_id, champion_version, champion_val_rmse).
    Returns (None, None, None) if no champion exists yet.
    """
    try:
        champion = client.get_model_version_by_alias(REGISTRY_NAME, "champion")
        val_rmse = float(
            client.get_run(champion.run_id).data.metrics["val_rmse"]
        )
        return champion.run_id, champion.version, val_rmse
    except Exception:
        return None, None, None


def _save_approved_metadata_to_gcs(metadata: dict) -> str:
    """Write approved model pointer to GCS. Returns the GCS URI."""
    gcs_path = "processed/models/approved/metadata.json"
    blob = storage.Client().bucket(BUCKET).blob(gcs_path)
    blob.upload_from_string(
        json.dumps(metadata, indent=2, default=str),
        content_type="application/json",
    )
    uri = f"gs://{BUCKET}/{gcs_path}"
    logger.info("Approved model pointer saved → %s", uri)
    return uri


# ---------------------------------------------------------------------------
# Main public API
# ---------------------------------------------------------------------------

def register_model(
    run_id:               str,
    val_rmse:             float,
    dataset_version_hash: str,
    validation_summary:   dict,
    bias_report:          dict,
    force_promote:        bool = False,
) -> dict:
    """
    Register the approved model in the MLflow Model Registry.

    Applies the rollback gate before touching the registry. If the gate
    passes (or force_promote=True), registers the model, sets champion alias,
    and writes the GCS approved pointer.

    Parameters
    ----------
    run_id                : MLflow run ID of the approved training run
    val_rmse              : val RMSE of this run (for champion comparison)
    dataset_version_hash  : MD5 hash from data_loader
    validation_summary    : dict returned by evaluator.evaluate_model()
    bias_report           : dict returned by bias_detection.detect_model_bias()
    force_promote         : lead override — skips rollback gate (logged explicitly)

    Returns
    -------
    metadata : dict — all registration details (also written to GCS)

    Raises
    ------
    RegistryPromotionError : if rollback gate fails and force_promote=False
    """
    client = MlflowClient()

    # ── Task L: Rollback gate ────────────────────────────────────────────────
    champion_run_id, champion_version, champion_rmse = _get_current_champion(client)

    if champion_rmse is not None and not force_promote:
        ceiling = champion_rmse * ROLLBACK_THRESHOLD
        if val_rmse > ceiling:
            msg = (
                f"Rollback gate blocked promotion.\n"
                f"  New model val_rmse:      {val_rmse:.4f}\n"
                f"  Champion val_rmse:       {champion_rmse:.4f}\n"
                f"  Rejection ceiling (×{ROLLBACK_THRESHOLD}): {ceiling:.4f}\n"
                f"  Current champion run:    {champion_run_id}\n"
                f"  Champion version:        v{champion_version}\n"
                f"Champion retained. To override: call register_model(..., force_promote=True)."
            )
            client.set_tag(run_id, "status",           "rollback-rejected")
            client.set_tag(run_id, "rollback_reason",  msg)
            client.set_tag(run_id, "champion_run_id",  champion_run_id or "none")
            logger.error(msg)
            raise RegistryPromotionError(msg)

        logger.info(
            "Rollback gate PASSED: new %.4f < ceiling %.4f (champion %.4f × %.2f)",
            val_rmse, ceiling, champion_rmse, ROLLBACK_THRESHOLD,
        )

    elif force_promote and champion_rmse is not None:
        logger.warning(
            "FORCE PROMOTE: rollback gate bypassed by lead. "
            "New RMSE %.4f vs champion RMSE %.4f.",
            val_rmse, champion_rmse,
        )
        client.set_tag(run_id, "force_promoted", "true")

    else:
        logger.info("No existing champion — first model, auto-promoting.")

    # ── Register to MLflow Model Registry ───────────────────────────────────
    logger.info("Registering run %s → registry '%s'...", run_id[:8], REGISTRY_NAME)
    model_version_obj = mlflow.register_model(
        model_uri=f"runs:/{run_id}/model",
        name=REGISTRY_NAME,
    )
    version_num = model_version_obj.version
    logger.info("Registered as version %s", version_num)

    # Set human-readable description on the version
    client.update_model_version(
        name=REGISTRY_NAME,
        version=version_num,
        description=(
            f"val_rmse={val_rmse:.4f} | "
            f"bias={bias_report.get('bias_status', 'N/A')} | "
            f"capacity_ratio={bias_report.get('dimensions', {}).get('station_capacity', {}).get('disparity_ratio', 'N/A')}× | "
            f"dataset={dataset_version_hash[:8]}... | "
            f"run={run_id[:8]}..."
        ),
    )

    # Transition to Staging (Production = manual lead approval in MLflow UI)
    client.transition_model_version_stage(
        name=REGISTRY_NAME,
        version=version_num,
        stage="Staging",
        archive_existing_versions=False,  # keep history accessible
    )
    logger.info("Stage: Staging ✓")

    # ── Champion alias management ────────────────────────────────────────────
    # Archive old champion under 'previous-champion' before moving the alias
    if champion_version is not None:
        try:
            client.set_registered_model_alias(
                name=REGISTRY_NAME,
                alias="previous-champion",
                version=champion_version,
            )
            logger.info("Previous champion v%s → alias 'previous-champion'", champion_version)
        except Exception as exc:
            logger.warning("Could not alias previous champion: %s", exc)

    client.set_registered_model_alias(
        name=REGISTRY_NAME,
        alias="champion",
        version=version_num,
    )
    logger.info("Champion alias → v%s ✓", version_num)

    # ── Log registry metadata back to the MLflow run ─────────────────────────
    client.set_tag(run_id, "registry_name",         REGISTRY_NAME)
    client.set_tag(run_id, "registry_version",      str(version_num))
    client.set_tag(run_id, "registry_stage",        "Staging")
    client.set_tag(run_id, "registry_alias",        "champion")
    client.set_tag(run_id, "previous_champion_run", champion_run_id or "none")

    # ── Build approved model pointer and write to GCS ─────────────────────────
    commit_sha = _get_commit_sha()
    metadata = {
        "run_id":               run_id,
        "registry_name":        REGISTRY_NAME,
        "registry_version":     int(version_num),
        "registry_stage":       "Staging",
        "registry_alias":       "champion",
        "dataset_version_hash": dataset_version_hash,
        "val_rmse":             round(val_rmse, 4),
        "test_rmse":            validation_summary.get("metrics", {}).get("test_rmse"),
        "test_r2":              validation_summary.get("metrics", {}).get("test_r2"),
        "validation_status":    validation_summary.get("validation_status"),
        "bias_status":          bias_report.get("bias_status"),
        "bias_violations":      bias_report.get("violations", []),
        "station_capacity_disparity_ratio": (
            bias_report.get("dimensions", {})
                       .get("station_capacity", {})
                       .get("disparity_ratio")
        ),
        "code_commit_sha":          commit_sha,
        "rollback_threshold":       ROLLBACK_THRESHOLD,
        "previous_champion_run_id": champion_run_id,
        "previous_champion_version": champion_version,
        "force_promoted":           force_promote,
        "promoted_at":              datetime.now(timezone.utc).isoformat(),
    }

    gcs_uri = _save_approved_metadata_to_gcs(metadata)
    client.set_tag(run_id, "approved_metadata_gcs", gcs_uri)

    logger.info(
        "Registry push complete. name=%s version=%s stage=Staging alias=champion",
        REGISTRY_NAME, version_num,
    )
    return metadata
