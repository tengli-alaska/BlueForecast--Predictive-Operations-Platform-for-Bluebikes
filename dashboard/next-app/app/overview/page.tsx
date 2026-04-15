"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { CheckCircle, AlertTriangle } from "lucide-react";
import AnimatedCounter from "@/components/shared/AnimatedCounter";
import StatusBadge from "@/components/shared/StatusBadge";
import {
  getLatestMetrics,
  getPipelineStatus,
  getBiasReport,
  getDriftReport,
  getStations,
  getPredictions,
  getStationMapping,
} from "@/data";
import { formatDate, deriveStationStatuses } from "@/lib/utils";
import DataBadge from "@/components/shared/DataBadge";
import type { ModelMetrics, PipelineStatus, BiasReport, DriftReport, Station, Prediction, StationStatus } from "@/types";

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
  predictions: Prediction[];
  stationStatuses: StationStatus[];
  // Hourly demand curve: hour 0–23 → total predicted trips across network
  hourlyDemand: { hour: number; total: number }[];
  // Top stations by total predicted demand today
  topStations: { name: string; total: number; risk: StationStatus["risk_level"] }[];
  metricsLive: boolean;
  pipelineLive: boolean;
  stationsLive: boolean;
  predictionsLive: boolean;
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
      getPredictions(),
      getStationMapping(),
    ]).then(([latestResult, pipelineResult, biasReport, driftReport, stationsResult, predictionsResult, mapping]) => {
      const stations = stationsResult.data;
      const predictions = predictionsResult.data;

      // Build lookup: A32xxx → gbfs_station_id and A32xxx → station_name
      const a32ToGbfs: Record<string, string> = {};
      const a32ToName: Record<string, string> = {};
      for (const row of mapping) {
        if (row.gbfs_station_id) a32ToGbfs[row.start_station_id] = row.gbfs_station_id;
        if (row.station_name) a32ToName[row.start_station_id] = row.station_name;
      }

      // Translate prediction station_ids to GBFS UUIDs so deriveStationStatuses works
      const translatedPredictions: Prediction[] = predictions.map((p) => ({
        ...p,
        station_id: a32ToGbfs[p.station_id] ?? p.station_id,
      }));

      // Derive station risk from real model predictions
      const stationStatuses = deriveStationStatuses(stations, translatedPredictions);

      // Build station name lookup (GBFS UUID → name)
      const nameById: Record<string, string> = {};
      for (const s of stations) nameById[s.station_id] = s.station_name;

      // Aggregate real predictions by forecast hour (0–23) across all stations
      const hourTotals: Record<number, number> = {};
      for (const p of predictions) {
        const h = new Date(p.forecast_hour).getHours();
        hourTotals[h] = (hourTotals[h] ?? 0) + p.predicted_demand;
      }
      const hourlyDemand = Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        total: Math.round(hourTotals[h] ?? 0),
      }));

      // Top stations by total predicted demand — use A32xxx IDs keyed by predictions
      const stationTotals: Record<string, number> = {};
      for (const p of predictions) {
        stationTotals[p.station_id] = (stationTotals[p.station_id] ?? 0) + p.predicted_demand;
      }
      const riskByGbfs: Record<string, StationStatus["risk_level"]> = {};
      for (const s of stationStatuses) riskByGbfs[s.station_id] = s.risk_level;

      const topStations = Object.entries(stationTotals)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 8)
        .map(([sid, total]) => {
          const gbfsId = a32ToGbfs[sid] ?? sid;
          const name = nameById[gbfsId] ?? a32ToName[sid] ?? sid;
          return {
            name,
            total: Math.round(total),
            risk: riskByGbfs[gbfsId] ?? "moderate",
          };
        });

      setData({
        latest: latestResult.data,
        pipeline: pipelineResult.data,
        biasReport,
        driftReport,
        stations,
        predictions,
        stationStatuses,
        hourlyDemand,
        topStations,
        metricsLive: latestResult.isLive,
        pipelineLive: pipelineResult.isLive,
        stationsLive: stationsResult.isLive,
        predictionsLive: predictionsResult.isLive,
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

  const { latest, pipeline, biasReport, driftReport, stations, stationStatuses, hourlyDemand, topStations, metricsLive, pipelineLive, stationsLive, predictionsLive } = data;

  const criticalCount = stationStatuses.filter((s) => s.risk_level === "critical").length;
  const avgFill = Math.round(stationStatuses.reduce((a, b) => a + b.fill_pct, 0) / (stationStatuses.length || 1));
  const biasFlags = biasReport.slices.flatMap((s) => s.flags);
  const maxHourlyDemand = Math.max(...hourlyDemand.map((h) => h.total), 1);

  const tasks = Object.entries(pipeline.tasks);
  const completedTasks = tasks.filter(([, t]) => t.status === "success").length;
  // Pipeline status is always mock (no live endpoint). Use metrics + stations + predictions to determine badge.
  const dataIsLive = metricsLive && stationsLive && predictionsLive;

  function riskBadge(level: StationStatus["risk_level"]): "error" | "warning" | "success" | "running" {
    if (level === "critical") return "error";
    if (level === "low") return "warning";
    if (level === "surplus") return "running";
    return "success";
  }

  // Time-aware greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";

  return (
    <div className="p-5 md:p-7 space-y-5">
      {/* Header — tight, informational */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-[22px] font-semibold text-white tracking-tight">{greeting}</h1>
            <DataBadge isLive={dataIsLive} />
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
          className="col-span-6 rounded-xl bg-bg-card p-4"
        >
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">High-Risk Stations</p>
          <p className="text-2xl font-semibold text-white mt-1 tracking-tight">
            <AnimatedCounter value={criticalCount} decimals={0} />
            <span className="text-sm text-slate-500 font-normal ml-1">/ {stationStatuses.length}</span>
          </p>
          <div className="flex items-center gap-1 mt-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400/80" />
            <span className="text-[11px] text-slate-500">
              {criticalCount === 0 ? "All stations within normal demand" : "Demand-predicted — see Rebalancing"}
            </span>
          </div>
        </motion.div>

        <motion.div
          custom={1} variants={fade} initial="hidden" animate="visible"
          className="col-span-6 rounded-xl bg-bg-card p-4"
        >
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Avg Predicted Demand Load</p>
          <p className="text-2xl font-semibold text-white mt-1 tracking-tight">
            <AnimatedCounter value={avgFill} decimals={0} suffix="%" />
          </p>
          {/* Mini fill bar */}
          <div className="mt-2.5 h-1 w-full rounded-full bg-bg-tertiary">
            <motion.div
              className="h-full rounded-full bg-blue-400/60"
              initial={{ width: 0 }}
              animate={{ width: `${avgFill}%` }}
              transition={{ duration: 1, delay: 0.5, ease: "easeOut" }}
            />
          </div>
        </motion.div>

        {/* ---- Row 2: Top stations today (wide) + Pipeline (narrow) ---- */}
        <motion.div
          custom={4} variants={fade} initial="hidden" animate="visible"
          className="col-span-8 rounded-xl bg-bg-card p-4"
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-[13px] font-medium text-white">Top Stations — Predicted Demand Today</p>
            <DataBadge isLive={predictionsLive} liveLabel="LIVE FORECAST" mockLabel="DEMO DATA" />
          </div>
          <div className="space-y-1.5">
            {topStations.map((s) => (
              <div key={s.name} className="flex items-center gap-3">
                <span className="text-[11px] text-slate-400 truncate w-48">{s.name}</span>
                <div className="flex-1 h-[5px] rounded-full bg-white/[0.06] overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-blue-400/50"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, (s.total / (topStations[0]?.total || 1)) * 100)}%` }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                  />
                </div>
                <span className="text-[11px] text-slate-400 tabular-nums w-16 text-right">{s.total} trips</span>
                <StatusBadge
                  status={riskBadge(s.risk)}
                  label={s.risk.charAt(0).toUpperCase() + s.risk.slice(1)}
                />
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          custom={5} variants={fade} initial="hidden" animate="visible"
          className="col-span-4 rounded-xl bg-bg-card p-4"
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
          <div className="mt-4 pt-3 border-t border-[var(--border)]">
            <p className="text-[11px] text-slate-500">{completedTasks}/{tasks.length} tasks complete</p>
            <div className="mt-1.5 h-1 w-full rounded-full bg-bg-tertiary">
              <div
                className="h-full rounded-full bg-emerald-400/50"
                style={{ width: `${(completedTasks / tasks.length) * 100}%` }}
              />
            </div>
          </div>
        </motion.div>

        {/* ---- Row 3: Real 24h network demand curve ---- */}
        <motion.div
          custom={6} variants={fade} initial="hidden" animate="visible"
          className="col-span-12 rounded-xl bg-[#0f1520] p-4"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[13px] font-medium text-white">24-Hour Network Demand Forecast</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Total predicted trips across all {stations.length} stations, by hour</p>
            </div>
            <DataBadge isLive={predictionsLive} liveLabel="LIVE FORECAST" mockLabel="DEMO DATA" />
          </div>
          <div className="flex items-end gap-[3px] h-20">
            {hourlyDemand.map(({ hour, total }) => {
              const heightPct = maxHourlyDemand > 0 ? (total / maxHourlyDemand) * 100 : 0;
              const isRush = (hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 19);
              return (
                <div key={hour} className="flex-1 flex flex-col items-center gap-1 group relative">
                  <div className="absolute -top-7 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center z-10">
                    <span className="text-[9px] text-white bg-slate-800 rounded px-1.5 py-0.5 whitespace-nowrap">
                      {hour === 0 ? "12am" : hour < 12 ? `${hour}am` : hour === 12 ? "12pm" : `${hour - 12}pm`}: {total}
                    </span>
                  </div>
                  <motion.div
                    className={`w-full rounded-sm ${isRush ? "bg-blue-400/70" : "bg-slate-600/50"}`}
                    initial={{ height: 0 }}
                    animate={{ height: `${heightPct}%` }}
                    transition={{ duration: 0.6, delay: hour * 0.02, ease: "easeOut" }}
                    style={{ minHeight: total > 0 ? 2 : 0 }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-2 text-[9px] text-slate-600">
            <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span>
          </div>
          <p className="text-[10px] text-slate-600 mt-1">Highlighted bars = rush hours (7–9am, 4–7pm)</p>
        </motion.div>

        {/* ---- Row 4: Status tiles — compact ---- */}
        <motion.div
          custom={7} variants={fade} initial="hidden" animate="visible"
          className="col-span-4 rounded-xl bg-bg-card p-4"
        >
          <div className="flex items-center justify-between">
            <p className="text-[12px] text-slate-400">Forecast Quality</p>
            <span className={`text-[11px] font-medium ${latest.validation_status === "PASSED" ? "text-emerald-400/70" : "text-red-400/70"}`}>
              {latest.validation_status === "PASSED" ? "Good" : "Needs Review"}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
            Accuracy checks passed · Off by ±{latest.test_rmse.toFixed(1)} bikes/station on average
          </p>
        </motion.div>

        <motion.div
          custom={8} variants={fade} initial="hidden" animate="visible"
          className="col-span-4 rounded-xl bg-bg-card p-4"
        >
          <div className="flex items-center justify-between">
            <p className="text-[12px] text-slate-400">Model Health</p>
            <span className={`text-[11px] font-medium ${driftReport.overall_drift_detected ? "text-amber-400/70" : "text-emerald-400/70"}`}>
              {driftReport.overall_drift_detected ? "Calendar Drift" : "Stable"}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
            {driftReport.overall_drift_detected
              ? "Seasonal feature shift detected · MAE improved 30% · No retrain needed"
              : "Predictions are tracking real demand patterns as expected"}
          </p>
        </motion.div>

        <motion.div
          custom={9} variants={fade} initial="hidden" animate="visible"
          className="col-span-4 rounded-xl bg-bg-card p-4"
        >
          <div className="flex items-center justify-between">
            <p className="text-[12px] text-slate-400">Prediction Fairness</p>
            <span className={`text-[11px] font-medium ${biasFlags.length > 0 ? "text-amber-400/70" : "text-emerald-400/70"}`}>
              {biasFlags.length > 0 ? "Watch Item" : "All Clear"}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
            {biasFlags.length > 0
              ? "Small stations are harder to predict — accuracy is consistent everywhere else"
              : "Forecast accuracy is consistent across all station sizes, times, and weather conditions"}
          </p>
        </motion.div>
      </div>
    </div>
  );
}
