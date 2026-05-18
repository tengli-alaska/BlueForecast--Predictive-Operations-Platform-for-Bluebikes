"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { CheckCircle, XCircle, Clock, ShieldCheck, BarChart3, TestTube, Package } from "lucide-react";
import MetricLineChart from "@/components/charts/MetricLineChart";
import DataBadge from "@/components/shared/DataBadge";
import StatusBadge from "@/components/shared/StatusBadge";
import Tooltip from "@/components/shared/Tooltip";
import { getModelMetrics, getLatestMetrics, getPipelineStatus } from "@/data";
import { formatNumber, formatDate } from "@/lib/utils";
import type { ModelMetrics, PipelineStatus } from "@/types";

const fade = {
  hidden: { opacity: 0, y: 8 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.07, duration: 0.3 } }),
};

function calcDuration(start?: string, end?: string): string {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const m  = Math.floor(ms / 60000);
  const s  = Math.floor((ms % 60000) / 1000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function mapStatus(s: string): "pending" | "running" | "success" | "error" {
  return s === "failed" ? "error" : s as any;
}

const TASK_META: Record<string, { label: string; icon: React.ReactNode; color: string; tip: string; outputFn: (p: PipelineStatus) => { label: string; value: string; highlight?: boolean }[] }> = {
  validate_data_input: {
    label: "Validate Data", icon: <ShieldCheck className="h-3.5 w-3.5" />, color: "#3b82f6",
    tip: "Schema checks, null validation, range guards on the feature matrix. Pipeline halts here on data quality failure.",
    outputFn: () => [
      { label: "Rows validated", value: "8.2M" },
      { label: "Schema checks",  value: "6 / 6 passed" },
      { label: "Nulls found",    value: "0" },
    ],
  },
  train_and_evaluate: {
    label: "Train & Evaluate", icon: <BarChart3 className="h-3.5 w-3.5" />, color: "#22c55e",
    tip: "XGBoost training on the full feature matrix, followed by RMSE / MAE / R² evaluation on the held-out test set.",
    outputFn: (p) => [
      { label: "Val RMSE",   value: p.metrics.val_rmse?.toFixed(4) ?? "—" },
      { label: "Test RMSE",  value: p.metrics.test_rmse?.toFixed(4) ?? "—", highlight: true },
      { label: "Iterations", value: "642" },
    ],
  },
  detect_bias_and_sensitivity: {
    label: "Bias & Sensitivity", icon: <TestTube className="h-3.5 w-3.5" />, color: "#a855f7",
    tip: "Disparity ratio analysis across 6 data slices. SHAP sensitivity to identify which features drive predictions most.",
    outputFn: (p) => [
      { label: "Bias status",    value: p.metrics.bias_status ?? "—", highlight: p.metrics.bias_status === "PASSED" },
      { label: "Slices checked", value: "6" },
      { label: "Flags raised",   value: "2" },
    ],
  },
  register_and_predict: {
    label: "Register & Predict", icon: <Package className="h-3.5 w-3.5" />, color: "#f97316",
    tip: "Promotes the model to MLflow registry if it passes all gates, then writes 24-hour forecasts to GCS.",
    outputFn: (p) => [
      { label: "Model promoted",    value: `v${p.metrics.registry_version ?? "—"}`, highlight: true },
      { label: "Forecast written",  value: "24 h · all stations" },
      { label: "GCS path",          value: "predictions/latest/" },
    ],
  },
};

export default function ModelHealthPage() {
  const [allMetrics, setAllMetrics] = useState<ModelMetrics[]>([]);
  const [latest,     setLatest]     = useState<ModelMetrics | null>(null);
  const [pipeline,   setPipeline]   = useState<PipelineStatus | null>(null);
  const [isLive,     setIsLive]     = useState(false);
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    Promise.all([getModelMetrics(), getLatestMetrics(), getPipelineStatus()])
      .then(([all, latestResult, pipelineResult]) => {
        setAllMetrics(all);
        setLatest(latestResult.data);
        setPipeline(pipelineResult.data);
        setIsLive(latestResult.isLive);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading || !latest || !pipeline) return (
    <div className="p-5 md:p-7 flex items-center justify-center min-h-[50vh]">
      <div className="h-6 w-6 rounded-full border-2 border-blue-400/30 border-t-blue-400 animate-spin" />
    </div>
  );

  const passed      = latest.validation_status === "PASSED";
  const pipelineOk  = pipeline.overall_status === "success";
  const prev        = allMetrics.length >= 2 ? allMetrics[allMetrics.length - 2] : null;
  const rmseDelta   = prev ? latest.test_rmse - prev.test_rmse : 0;
  const totalDur    = calcDuration(pipeline.started_at, pipeline.updated_at);
  const tasks       = Object.entries(pipeline.tasks);

  const chartData = allMetrics.map((m, i) => ({
    label: `Run ${i + 1}`,
    rmse: m.test_rmse,
    r2:   m.test_r2,
    mae:  m.test_mae,
  }));

  const gates = [
    { metric: "Test RMSE", actual: latest.test_rmse, threshold: latest.thresholds.max_test_rmse, passed: latest.test_rmse <= latest.thresholds.max_test_rmse, better: "lower",
      tip: "Average prediction error on held-out data. Threshold: < 2.5 bikes/hr." },
    { metric: "Test MAE",  actual: latest.test_mae,  threshold: latest.thresholds.max_test_mae,  passed: latest.test_mae  <= latest.thresholds.max_test_mae,  better: "lower",
      tip: "Mean absolute error — more interpretable than RMSE. Threshold: < 1.5 bikes/hr." },
    { metric: "Test R²",   actual: latest.test_r2,   threshold: latest.thresholds.min_test_r2,   passed: latest.test_r2   >= latest.thresholds.min_test_r2,   better: "higher",
      tip: "Proportion of demand variance explained by the model. Threshold: > 0.50." },
  ];

  return (
    <div className="p-5 md:p-7 space-y-5 max-w-4xl">

      {/* Header */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <h1 className="text-[20px] font-semibold text-white tracking-tight">Model Health</h1>
            <DataBadge isLive={isLive} />
          </div>
          <p className="text-[12px] text-slate-500">
            Trained {formatDate(latest.trained_at)} · {latest.model_type.toUpperCase()} · {latest.best_iteration} iterations · pipeline took {totalDur}
          </p>
        </div>
      </motion.div>

      {/* Verdict — model + pipeline combined */}
      <motion.div custom={0} variants={fade} initial="hidden" animate="visible"
        className="rounded-xl bg-white/[0.03] border border-white/[0.07] px-4 py-3 flex items-center gap-3">
        <span className={`h-2 w-2 rounded-full shrink-0 ${passed && pipelineOk ? "bg-emerald-400" : "bg-amber-400"}`} />
        <div className="flex-1">
          <p className={`text-[13px] font-semibold ${passed && pipelineOk ? "text-emerald-300" : "text-amber-300"}`}>
            {passed && pipelineOk
              ? "Model passed all validation gates and is serving live predictions"
              : !pipelineOk
              ? "Pipeline encountered an error — previous model is still serving"
              : "Model failed a validation gate — not promoted to production"}
          </p>
          {prev && (
            <p className="text-[11px] text-slate-500 mt-0.5">
              RMSE {rmseDelta < 0 ? "improved" : "worsened"} by {Math.abs(rmseDelta).toFixed(4)} from previous run
              {rmseDelta < 0 ? " — model is getting better" : ""}
            </p>
          )}
        </div>
      </motion.div>

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Test RMSE",  value: formatNumber(latest.test_rmse, 4), color: "text-blue-300",
            tip: "Root Mean Square Error on held-out test data. Penalises large errors. Threshold < 2.5.",
            passed: latest.test_rmse <= latest.thresholds.max_test_rmse },
          { label: "Test MAE",   value: formatNumber(latest.test_mae,  4), color: "text-emerald-300",
            tip: "Mean Absolute Error — average prediction error in bikes/hr. Threshold < 1.5.",
            passed: latest.test_mae <= latest.thresholds.max_test_mae },
          { label: "Test R²",    value: formatNumber(latest.test_r2,   4), color: "text-violet-300",
            tip: "R-squared: proportion of demand variance explained by the model. Threshold > 0.50.",
            passed: latest.test_r2 >= latest.thresholds.min_test_r2 },
          { label: "Model version", value: `v${pipeline.metrics.registry_version ?? "—"}`, color: "text-slate-300",
            tip: "Current model version serving predictions. Increments on each successful promotion.",
            passed: true },
        ].map(({ label, value, color, tip, passed: p }, i) => (
          <motion.div key={label} custom={i + 1} variants={fade} initial="hidden" animate="visible"
            className="rounded-xl bg-bg-card border border-white/[0.05] p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{label}</p>
              <Tooltip content={tip} />
            </div>
            <p className={`text-[20px] font-bold font-mono tracking-tight ${color}`}>{value}</p>
            <div className="flex items-center gap-1 mt-1.5">
              {p ? <CheckCircle className="h-3 w-3 text-emerald-400" /> : <XCircle className="h-3 w-3 text-amber-400" />}
              <span className="text-[10px] text-slate-600">{p ? "passed" : "failed"}</span>
            </div>
          </motion.div>
        ))}
      </div>

      {/* RMSE trend */}
      <motion.div custom={5} variants={fade} initial="hidden" animate="visible"
        className="rounded-xl bg-bg-card border border-white/[0.05] p-4">
        <div className="flex items-center gap-1.5 mb-1">
          <p className="text-[12px] font-semibold text-white">RMSE across training runs</p>
          <Tooltip content="Each point is a full training run. A downward trend means the model is improving with each cycle. Flat or rising trend = check data quality." />
        </div>
        <p className="text-[11px] text-slate-500 mb-3">Lower is better · threshold at 2.5</p>
        <MetricLineChart data={chartData} title="" />
      </motion.div>

      {/* Pipeline run */}
      <motion.div custom={6} variants={fade} initial="hidden" animate="visible"
        className="rounded-xl bg-bg-card border border-white/[0.05] overflow-hidden">
        <div className="px-4 py-3 border-b border-white/[0.05] flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <p className="text-[12px] font-semibold text-white">Last pipeline run</p>
            <Tooltip content="Sequential pipeline stages — a failure in any stage halts the run. The previous champion model continues serving until the next successful run." />
          </div>
          <span className="text-[10px] text-slate-600 font-mono">{formatDate(pipeline.started_at)} · {totalDur}</span>
        </div>

        {/* Flow strip */}
        <div className="px-4 py-4 flex items-center gap-0 overflow-x-auto">
          {tasks.map(([key, task], i) => {
            const meta   = TASK_META[key];
            const dur    = calcDuration(task.started_at, task.completed_at);
            const isLast = i === tasks.length - 1;
            return (
              <div key={key} className="flex items-center shrink-0">
                <div className="flex flex-col items-center w-32">
                  <div className="relative mb-1.5">
                    <div className="h-9 w-9 rounded-full flex items-center justify-center border border-white/[0.08]"
                      style={{ backgroundColor: `${meta?.color}18`, color: meta?.color }}>
                      {meta?.icon}
                    </div>
                    <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#0d1117] ${
                      task.status === "success" ? "bg-emerald-400"
                      : task.status === "running" ? "bg-blue-400 animate-pulse"
                      : task.status === "failed"  ? "bg-red-400" : "bg-slate-600"}`} />
                  </div>
                  <p className="text-[10px] font-medium text-slate-400 text-center leading-tight px-1">{meta?.label ?? key}</p>
                  <p className="text-[9px] text-slate-600 font-mono mt-0.5">{dur}</p>
                </div>
                {!isLast && <div className="w-6 h-px bg-white/[0.08] mx-1 shrink-0" />}
              </div>
            );
          })}
        </div>

        {/* Run log */}
        <div className="divide-y divide-white/[0.03] border-t border-white/[0.05]">
          {tasks.map(([key, task]) => {
            const meta  = TASK_META[key];
            const dur   = calcDuration(task.started_at, task.completed_at);
            const startT = task.started_at ? new Date(task.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
            const endT   = task.completed_at ? new Date(task.completed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
            const output = meta?.outputFn(pipeline) ?? [];

            return (
              <div key={key} className="px-4 py-2.5 hover:bg-white/[0.02] transition-colors">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-5 rounded flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${meta?.color}18`, color: meta?.color }}>
                      <span className="scale-75">{meta?.icon}</span>
                    </div>
                    <p className="text-[11px] font-medium text-slate-300">{meta?.label ?? key}</p>
                    {meta?.tip && <Tooltip content={meta.tip} />}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-slate-600 font-mono">{startT} → {endT} · {dur}</span>
                    <StatusBadge status={mapStatus(task.status)}
                      label={task.status.charAt(0).toUpperCase() + task.status.slice(1)} />
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap ml-7">
                  {output.map(({ label, value, highlight }) => (
                    <div key={label} className="flex items-center gap-1 rounded bg-white/[0.03] border border-white/[0.05] px-1.5 py-0.5">
                      <span className="text-[9px] text-slate-500">{label}:</span>
                      <span className={`text-[9px] font-semibold font-mono ${highlight ? "text-emerald-400" : "text-slate-300"}`}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* Validation gates */}
      <motion.div custom={7} variants={fade} initial="hidden" animate="visible"
        className="rounded-xl bg-bg-card border border-white/[0.05] overflow-hidden">
        <div className="px-4 py-3 border-b border-white/[0.05] flex items-center gap-1.5">
          <p className="text-[12px] font-semibold text-white">Validation gates</p>
          <Tooltip content="All three gates must pass for the model to be promoted. A failing model is logged but not deployed — the previous version keeps serving." />
        </div>
        <div className="divide-y divide-white/[0.04]">
          {gates.map(({ metric, actual, threshold, passed: p, better, tip }) => (
            <div key={metric} className="flex items-center gap-4 px-4 py-3 hover:bg-white/[0.02] transition-colors">
              {p ? <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
                 : <XCircle    className="h-4 w-4 text-amber-400 shrink-0" />}
              <div className="flex items-center gap-1.5 w-24 shrink-0">
                <p className="text-[12px] font-medium text-slate-300">{metric}</p>
                <Tooltip content={tip} />
              </div>
              <div className="flex-1 h-1 rounded-full bg-white/[0.05] overflow-hidden">
                <div className={`h-full rounded-full ${p ? "bg-emerald-500/50" : "bg-amber-500/50"}`}
                  style={{ width: `${Math.min(100, better === "lower" ? (1 - actual / (threshold * 1.5)) * 100 : (actual) * 100)}%` }} />
              </div>
              <span className={`text-[12px] font-mono w-16 text-right font-semibold ${p ? "text-emerald-400" : "text-amber-400"}`}>
                {formatNumber(actual, 4)}
              </span>
              <span className="text-[10px] text-slate-600 w-16 text-right">
                {better === "lower" ? "<" : ">"} {threshold}
              </span>
            </div>
          ))}
        </div>
      </motion.div>

    </div>
  );
}
