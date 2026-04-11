"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowUpRight, ArrowDownRight, Minus, CheckCircle, AlertTriangle } from "lucide-react";
import AnimatedCounter from "@/components/shared/AnimatedCounter";
import MetricLineChart from "@/components/charts/MetricLineChart";
import DemandHeatmapChart from "@/components/charts/DemandHeatmapChart";
import {
  getLatestMetrics,
  getPipelineStatus,
  getBiasReport,
  getDriftReport,
  getStations,
  getModelMetrics,
  getDemandHeatmap,
  getStationStatuses,
} from "@/data";
import { formatDate } from "@/lib/utils";
import DataBadge from "@/components/shared/DataBadge";
import type { ModelMetrics, PipelineStatus, BiasReport, DriftReport, Station, DemandHeatmapEntry, StationStatus } from "@/types";

const fade = {
  hidden: { opacity: 0, y: 8 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.3 },
  }),
};

interface OverviewData {
  latest: ModelMetrics;
  pipeline: PipelineStatus;
  biasReport: BiasReport;
  driftReport: DriftReport;
  stations: Station[];
  allMetrics: ModelMetrics[];
  heatmapData: DemandHeatmapEntry[];
  stationStatuses: StationStatus[];
  metricsLive: boolean;
  pipelineLive: boolean;
  stationsLive: boolean;
}

export default function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getLatestMetrics(),
      getPipelineStatus(),
      getBiasReport(),
      getDriftReport(),
      getStations(),
      getModelMetrics(),
      getDemandHeatmap(),
      getStationStatuses(),
    ]).then(([latestResult, pipelineResult, biasReport, driftReport, stationsResult, allMetrics, heatmapData, stationStatuses]) => {
      setData({
        latest: latestResult.data,
        pipeline: pipelineResult.data,
        biasReport,
        driftReport,
        stations: stationsResult.data,
        allMetrics,
        heatmapData,
        stationStatuses,
        metricsLive: latestResult.isLive,
        pipelineLive: pipelineResult.isLive,
        stationsLive: stationsResult.isLive,
      });
    }).finally(() => setLoading(false));
  }, []);

  if (loading || !data) {
    return (
      <div className="p-5 md:p-7 flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 rounded-full border-2 border-blue-400/30 border-t-blue-400 animate-spin" />
          <p className="text-sm text-slate-500">Loading data...</p>
        </div>
      </div>
    );
  }

  const { latest, pipeline, biasReport, driftReport, stations, allMetrics, heatmapData, stationStatuses, metricsLive, pipelineLive, stationsLive } = data;

  const criticalCount = stationStatuses.filter((s) => s.risk_level === "critical").length;
  const avgFill = Math.round(stationStatuses.reduce((a, b) => a + b.fill_pct, 0) / stationStatuses.length);
  const biasFlags = biasReport.slices.flatMap((s) => s.flags);
  const prevMetrics = allMetrics[allMetrics.length - 2];

  const chartData = allMetrics.map((m, i) => ({
    label: `v${i + 1}`,
    rmse: m.test_rmse,
    r2: m.test_r2,
    mae: m.test_mae,
  }));

  const tasks = Object.entries(pipeline.tasks);
  const completedTasks = tasks.filter(([, t]) => t.status === "success").length;

  return (
    <div className="p-5 md:p-7 space-y-5">
      {/* Header — tight, informational */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-[22px] font-semibold text-white tracking-tight">Good morning</h1>
            <DataBadge isLive={metricsLive && pipelineLive && stationsLive} />
          </div>
          <p className="text-[13px] text-slate-500">
            {stations.length} stations monitored · Model v{pipeline.metrics?.registry_version ?? "—"} · Last trained {formatDate(latest.trained_at)}
          </p>
        </div>
        {biasFlags.length > 0 && (
          <div className="flex items-center gap-1.5 text-amber-400/80 text-xs">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>{biasFlags.length} bias flags</span>
          </div>
        )}
      </motion.div>

      {/* Bento Grid — asymmetric layout */}
      <div className="grid grid-cols-12 gap-3">

        {/* ---- Row 1: Ops-friendly KPIs ---- */}
        <motion.div
          custom={0} variants={fade} initial="hidden" animate="visible"
          className="col-span-3 rounded-xl bg-[#0f1520] p-4"
        >
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Prediction Accuracy</p>
          <p className="text-2xl font-semibold text-white mt-1 tracking-tight">
            ±<AnimatedCounter value={latest.test_rmse} decimals={1} suffix=" trips/hr" />
          </p>
          <div className="flex items-center gap-1 mt-1.5">
            {latest.test_rmse < prevMetrics.test_rmse ? (
              <ArrowDownRight className="h-3 w-3 text-emerald-400/60" />
            ) : (
              <ArrowUpRight className="h-3 w-3 text-red-400/60" />
            )}
            <span className="text-[11px] text-slate-500">
              Typical forecast error · {latest.test_rmse < 1.5 ? "Good" : latest.test_rmse < 2.5 ? "Acceptable" : "Review needed"}
            </span>
          </div>
        </motion.div>

        <motion.div
          custom={1} variants={fade} initial="hidden" animate="visible"
          className="col-span-3 rounded-xl bg-[#0f1520] p-4"
        >
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Demand Explained</p>
          <p className="text-2xl font-semibold text-white mt-1 tracking-tight">
            <AnimatedCounter value={latest.test_r2 * 100} decimals={0} suffix="%" />
          </p>
          <div className="flex items-center gap-1 mt-1.5">
            <ArrowUpRight className="h-3 w-3 text-emerald-400/60" />
            <span className="text-[11px] text-slate-500">
              Model captures {(latest.test_r2 * 100).toFixed(0)}% of demand patterns
            </span>
          </div>
        </motion.div>

        <motion.div
          custom={2} variants={fade} initial="hidden" animate="visible"
          className="col-span-3 rounded-xl bg-[#0f1520] p-4"
        >
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Stations Need Action</p>
          <p className="text-2xl font-semibold text-white mt-1 tracking-tight">
            <AnimatedCounter value={criticalCount} decimals={0} />
            <span className="text-sm text-slate-500 font-normal ml-1">/ {stationStatuses.length}</span>
          </p>
          <div className="flex items-center gap-1 mt-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400/80" />
            <span className="text-[11px] text-slate-500">
              {criticalCount === 0 ? "All stations healthy" : "Send trucks to rebalancing page"}
            </span>
          </div>
        </motion.div>

        <motion.div
          custom={3} variants={fade} initial="hidden" animate="visible"
          className="col-span-3 rounded-xl bg-[#0f1520] p-4"
        >
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Avg Fill Rate</p>
          <p className="text-2xl font-semibold text-white mt-1 tracking-tight">
            <AnimatedCounter value={avgFill} decimals={0} suffix="%" />
          </p>
          {/* Mini fill bar */}
          <div className="mt-2.5 h-1 w-full rounded-full bg-white/[0.06]">
            <motion.div
              className="h-full rounded-full bg-blue-400/60"
              initial={{ width: 0 }}
              animate={{ width: `${avgFill}%` }}
              transition={{ duration: 1, delay: 0.5, ease: "easeOut" }}
            />
          </div>
        </motion.div>

        {/* ---- Row 2: Model chart (wide) + Pipeline (narrow) ---- */}
        <motion.div
          custom={4} variants={fade} initial="hidden" animate="visible"
          className="col-span-8 rounded-xl bg-[#0f1520]"
        >
          <MetricLineChart data={chartData} title="Model Performance" />
        </motion.div>

        <motion.div
          custom={5} variants={fade} initial="hidden" animate="visible"
          className="col-span-4 rounded-xl bg-[#0f1520] p-4"
        >
          <p className="text-[13px] font-medium text-white mb-3">Pipeline</p>
          <div className="space-y-2.5">
            {tasks.map(([key, task]) => (
              <div key={key} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className={`h-3.5 w-3.5 ${task.status === "success" ? "text-emerald-400/50" : "text-slate-600"}`} />
                  <span className="text-[12px] text-slate-400">
                    {key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/And /g, "& ")}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-white/[0.04]">
            <p className="text-[11px] text-slate-500">{completedTasks}/{tasks.length} tasks complete</p>
            <div className="mt-1.5 h-1 w-full rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-emerald-400/50"
                style={{ width: `${(completedTasks / tasks.length) * 100}%` }}
              />
            </div>
          </div>
        </motion.div>

        {/* ---- Row 3: Heatmap (full width) ---- */}
        <motion.div
          custom={6} variants={fade} initial="hidden" animate="visible"
          className="col-span-12"
        >
          <DemandHeatmapChart data={heatmapData} />
        </motion.div>

        {/* ---- Row 4: Status tiles — compact ---- */}
        <motion.div
          custom={7} variants={fade} initial="hidden" animate="visible"
          className="col-span-4 rounded-xl bg-[#0f1520] p-4"
        >
          <div className="flex items-center justify-between">
            <p className="text-[12px] text-slate-400">Validation</p>
            <span className={`text-[11px] font-medium ${latest.validation_status === "PASSED" ? "text-emerald-400/70" : "text-red-400/70"}`}>
              {latest.validation_status}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
            All gates passed — RMSE {latest.test_rmse.toFixed(4)}, R² {(latest.test_r2 * 100).toFixed(1)}%, MAE {latest.test_mae.toFixed(4)}
          </p>
        </motion.div>

        <motion.div
          custom={8} variants={fade} initial="hidden" animate="visible"
          className="col-span-4 rounded-xl bg-[#0f1520] p-4"
        >
          <div className="flex items-center justify-between">
            <p className="text-[12px] text-slate-400">Drift</p>
            <span className={`text-[11px] font-medium ${driftReport.overall_drift_detected ? "text-amber-400/70" : "text-emerald-400/70"}`}>
              {driftReport.overall_drift_detected ? "Detected" : "Stable"}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
            {driftReport.recommendation}
          </p>
        </motion.div>

        <motion.div
          custom={9} variants={fade} initial="hidden" animate="visible"
          className="col-span-4 rounded-xl bg-[#0f1520] p-4"
        >
          <div className="flex items-center justify-between">
            <p className="text-[12px] text-slate-400">Bias</p>
            <span className={`text-[11px] font-medium ${biasFlags.length > 0 ? "text-amber-400/70" : "text-emerald-400/70"}`}>
              {biasFlags.length > 0 ? `${biasFlags.length} flags` : "Clear"}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
            {biasFlags.length > 0
              ? "Station capacity disparity 10.2× exceeds 5× threshold"
              : "All disparity ratios within thresholds"}
          </p>
        </motion.div>
      </div>
    </div>
  );
}
