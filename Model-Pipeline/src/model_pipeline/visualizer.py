"""
MLflow visualization utilities for BlueForecast.

Generates and logs matplotlib figures directly into the MLflow run artifacts
(visible under the run's Artifacts tab → charts/).

Charts:
  1. feature_importance.png  — horizontal bar, top-15 features by SHAP mean |SHAP|
  2. version_comparison.png  — grouped bar: val_rmse vs test_rmse across last N approved runs
                               (makes the version selection basis immediately visible)
  3. sensitivity_curves.png  — OAT sweep: val RMSE vs param value, one subplot per param

All figures are written to a temp file and logged via MlflowClient.log_artifact()
so they work regardless of whether a run is currently active.
All figure objects are closed immediately after logging — no memory leaks.
"""

import logging
import os
import tempfile

import matplotlib
matplotlib.use("Agg")   # non-interactive backend — required in Docker / headless server
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np
import mlflow.tracking

logger = logging.getLogger("model_pipeline.visualizer")

# Brand palette
_BLUE  = "#0072CE"
_GRAY  = "#6C757D"
_RED   = "#DC3545"
_GREEN = "#28A745"


def _log_figure(client: mlflow.tracking.MlflowClient, run_id: str, fig, filename: str) -> None:
    """Save fig to a temp file and log it to MLflow artifacts under charts/."""
    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, filename)
        fig.savefig(path, dpi=150, bbox_inches="tight")
        client.log_artifact(run_id, path, artifact_path="charts")
    plt.close(fig)
    logger.info("Logged charts/%s to MLflow run %s", filename, run_id[:8])


# ---------------------------------------------------------------------------
# 1. Feature importance (SHAP)
# ---------------------------------------------------------------------------

def log_feature_importance_chart(
    run_id: str,
    feature_importance: dict,
    top_n: int = 15,
) -> None:
    """
    Horizontal bar chart of top-N features by SHAP mean |SHAP| value.

    Parameters
    ----------
    run_id             : MLflow run ID
    feature_importance : dict with key "shap_mean_abs" → {feature: score}
    top_n              : number of features to show (default 15)
    """
    shap_scores = feature_importance.get("shap_mean_abs", {})
    if not shap_scores:
        logger.warning("No SHAP scores available — skipping feature importance chart.")
        return

    items        = list(shap_scores.items())[:top_n]
    features     = [f for f, _ in reversed(items)]
    values       = [v for _, v in reversed(items)]
    bar_colors   = [_RED if i == len(items) - 1 else _BLUE for i in range(len(items))]

    fig, ax = plt.subplots(figsize=(10, max(5, top_n * 0.45)))
    bars = ax.barh(features, values, color=list(reversed(bar_colors)), height=0.65)
    ax.bar_label(bars, labels=[f"{v:.4f}" for v in values], padding=4, fontsize=8)
    ax.set_xlabel("Mean |SHAP value|  (average impact on model output)", fontsize=10)
    ax.set_title(
        f"Feature Importance — SHAP (TreeExplainer, 10k-row sample)\n"
        f"Run: {run_id[:8]}...",
        fontsize=11,
    )
    ax.axvline(x=0, color="black", linewidth=0.5)
    ax.spines[["top", "right"]].set_visible(False)
    plt.tight_layout()

    _log_figure(mlflow.tracking.MlflowClient(), run_id, fig, "feature_importance.png")


# ---------------------------------------------------------------------------
# 2. Version comparison (approved runs)
# ---------------------------------------------------------------------------

def log_version_comparison_chart(
    run_id: str,
    client: mlflow.tracking.MlflowClient,
    experiment_name: str = "BlueForecast-Demand",
    last_n: int = 10,
) -> None:
    """
    Grouped bar chart: val_rmse and test_rmse for the last N approved runs.

    The current run is highlighted with a red border so it's instantly
    identifiable in the MLflow comparison view.
    """
    experiment = client.get_experiment_by_name(experiment_name)
    if experiment is None:
        logger.warning("Experiment '%s' not found — skipping version comparison chart.", experiment_name)
        return

    runs = client.search_runs(
        experiment_ids=[experiment.experiment_id],
        filter_string="tags.status = 'approved'",
        order_by=["attributes.start_time DESC"],
        max_results=last_n,
    )
    if not runs:
        logger.info("No approved runs found — skipping version comparison chart.")
        return

    # Reverse so oldest → newest left to right
    runs = list(reversed(runs))
    labels     = [r.info.run_id[:8] for r in runs]
    val_rmses  = [r.data.metrics.get("val_rmse",  0.0) for r in runs]
    test_rmses = [r.data.metrics.get("test_rmse", 0.0) for r in runs]

    x     = np.arange(len(labels))
    width = 0.35

    fig, ax = plt.subplots(figsize=(max(8, len(labels) * 1.5), 5))

    bars1 = ax.bar(x - width / 2, val_rmses,  width, label="Val RMSE",  color=_BLUE,  alpha=0.88)
    bars2 = ax.bar(x + width / 2, test_rmses, width, label="Test RMSE", color=_GRAY,  alpha=0.88)

    # Highlight current run
    current_short = run_id[:8]
    if current_short in labels:
        idx = labels.index(current_short)
        ax.axvspan(idx - 0.5, idx + 0.5, alpha=0.07, color=_RED)
        ax.get_xticklabels()   # trigger tick generation before modifying
        for bar in [bars1[idx], bars2[idx]]:
            bar.set_edgecolor(_RED)
            bar.set_linewidth(2.0)

    ax.bar_label(bars1, labels=[f"{v:.3f}" for v in val_rmses],  padding=2, fontsize=7)
    ax.bar_label(bars2, labels=[f"{v:.3f}" for v in test_rmses], padding=2, fontsize=7)

    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=30, ha="right", fontsize=8)
    ax.set_ylabel("RMSE", fontsize=10)
    ax.set_xlabel("Run ID (short)  — current run outlined in red", fontsize=9)
    ax.set_title(
        "Model Version Comparison — All Approved Runs\n"
        "Selection criterion: lowest val_rmse → promoted to champion",
        fontsize=11,
    )
    ax.legend(fontsize=9)
    ax.spines[["top", "right"]].set_visible(False)
    plt.tight_layout()

    _log_figure(client, run_id, fig, "version_comparison.png")


# ---------------------------------------------------------------------------
# 3. Hyperparameter sensitivity curves (OAT)
# ---------------------------------------------------------------------------

def log_sensitivity_curves(
    run_id: str,
    hyperparam_data: dict,
) -> None:
    """
    One subplot per hyperparameter: x = param value, y = val RMSE.

    Base value is marked with a vertical dashed red line.
    Best value is marked with a filled dot.
    Skipped silently if the hyperparam sweep was not run.
    """
    if hyperparam_data.get("skipped"):
        logger.info("Hyperparam sweep was skipped — no sensitivity curves to plot.")
        return

    parameters = hyperparam_data.get("parameters", {})
    if not parameters:
        logger.info("No parameter data found — skipping sensitivity curves.")
        return

    n_params = len(parameters)
    fig, axes = plt.subplots(1, n_params, figsize=(5 * n_params, 4), sharey=False)
    if n_params == 1:
        axes = [axes]

    for ax, (param_name, data) in zip(axes, parameters.items()):
        values    = data["values"]
        val_rmse  = data["val_rmse"]
        base_val  = data["base_value"]
        best_idx  = val_rmse.index(min(val_rmse))

        ax.plot(
            values, val_rmse,
            marker="o", color=_BLUE, linewidth=2, markersize=6, zorder=2,
        )
        ax.axvline(
            x=base_val, color=_RED, linestyle="--", linewidth=1.4,
            label=f"current base={base_val}",
        )
        ax.scatter(
            [values[best_idx]], [val_rmse[best_idx]],
            color=_GREEN, zorder=5, s=90,
            label=f"best={values[best_idx]} (RMSE={val_rmse[best_idx]:.4f})",
        )

        # Shade the region around the best value
        ax.axvspan(
            values[max(0, best_idx - 1)],
            values[min(len(values) - 1, best_idx + 1)],
            alpha=0.07, color=_GREEN,
        )

        ax.set_xlabel(param_name, fontsize=10)
        ax.set_ylabel("Val RMSE", fontsize=10)
        ax.set_title(f"{param_name}\n(OAT sweep, 20% subsample)", fontsize=9)
        ax.legend(fontsize=7.5, loc="best")
        ax.spines[["top", "right"]].set_visible(False)
        ax.xaxis.set_major_formatter(mticker.FormatStrFormatter("%g"))

    fig.suptitle(
        f"Hyperparameter Sensitivity — One-at-a-Time Sweep\nRun: {run_id[:8]}...",
        fontsize=11,
    )
    plt.tight_layout()

    _log_figure(mlflow.tracking.MlflowClient(), run_id, fig, "sensitivity_curves.png")
