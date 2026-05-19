"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Activity, Shield, GitBranch, Bike, TrendingUp, Clock } from "lucide-react";
import { useRouter } from "next/navigation";
import AnimatedCounter from "@/components/shared/AnimatedCounter";
import DataBadge from "@/components/shared/DataBadge";
import Tooltip from "@/components/shared/Tooltip";
import {
  getLatestMetrics,
  getBiasReport,
  getDriftReport,
  getPredictionsNetwork,
  getStationStatuses,
} from "@/data";
import { formatDate } from "@/lib/utils";
import type { ModelMetrics, BiasReport, DriftReport, StationStatus } from "@/types";

const fade = {
  hidden: { opacity: 0, y: 10 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.07, duration: 0.35, ease: "easeOut" as const } }),
};

interface OverviewData {
  latest: ModelMetrics;
  biasReport: BiasReport;
  driftReport: DriftReport;
  stationStatuses: StationStatus[];
  hourlyDemand: { hour: number; total: number }[];
  isLive: boolean;
}

function nextPeakLabel(): string {
  const h = new Date().getHours();
  if (h < 7)  return "8 am rush";
  if (h < 15) return "5 pm rush";
  if (h < 20) return "tomorrow's 8 am";
  return "tomorrow's 8 am";
}

export default function OverviewPage() {
  const [data, setData]     = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    Promise.all([
      getLatestMetrics(),
      getBiasReport(),
      getDriftReport(),
      getPredictionsNetwork(),
      getStationStatuses(),
    ]).then(([latestResult, biasReport, driftReport, networkResult, stationStatuses]) => {
      setData({ latest: latestResult.data, biasReport, driftReport,
        stationStatuses, hourlyDemand: networkResult.data, isLive: latestResult.isLive });
    }).finally(() => setLoading(false));
  }, []);

  if (loading || !data) return (
    <div className="p-5 md:p-7 flex items-center justify-center min-h-[50vh]">
      <div className="flex flex-col items-center gap-3">
        <div className="h-6 w-6 rounded-full border-2 border-blue-400/30 border-t-blue-400 animate-spin" />
        <p className="text-xs text-slate-500">Loading network snapshot…</p>
      </div>
    </div>
  );

  const { latest, biasReport, driftReport, stationStatuses, hourlyDemand, isLive } = data;

  const healthy    = stationStatuses.filter(s => s.risk_level === "moderate" || s.risk_level === "surplus");
  const low        = stationStatuses.filter(s => s.risk_level === "low");
  const critical   = stationStatuses.filter(s => s.risk_level === "critical");
  const needBikes  = critical.filter(s => s.fill_pct <= 10);
  const overflow   = critical.filter(s => s.fill_pct >= 90);
  const total      = stationStatuses.length;
  const healthPct  = Math.round((healthy.length / total) * 100);
  const avgFill    = Math.round(stationStatuses.reduce((a, b) => a + b.fill_pct, 0) / (total || 1));
  const totalDemand = hourlyDemand.reduce((s, h) => s + h.total, 0);
  const biasFlags  = biasReport.slices.flatMap(s => s.flags);
  const hour       = new Date().getHours();
  const greeting   = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  // Demand chart
  const CHART_H  = 72;
  const overallMax = Math.max(...hourlyDemand.map(h => h.total), 1);

  // Attention items — only real problems, ordered by severity
  const attention: { dot: string; label: string; sub: string; href: string; urgent?: boolean }[] = [];
  if (needBikes.length > 0)
    attention.push({ dot: "bg-red-400", label: `${needBikes.length} station${needBikes.length > 1 ? "s" : ""} nearly empty`, sub: `Needs bikes before ${nextPeakLabel()}`, href: "/rebalancing", urgent: true });
  if (overflow.length > 0)
    attention.push({ dot: "bg-amber-400", label: `${overflow.length} station${overflow.length > 1 ? "s" : ""} overflowing`, sub: "Schedule a pickup — riders being turned away", href: "/rebalancing" });
  if (low.length > 0) {
    const lowIds = low.map(s => s.station_id).join(",");
    attention.push({ dot: "bg-amber-400/70", label: `${low.length} stations trending low`, sub: "Monitor — will need bikes within 3–4 h", href: `/forecasts?focus=${lowIds}` });
  }
  if (driftReport.overall_drift_detected)
    attention.push({ dot: "bg-blue-400", label: "Model drift detected", sub: `${driftReport.feature_drift.drifted_features.length} features shifted — review accuracy`, href: "/drift" });

  return (
    <div className="p-5 md:p-8 space-y-5">

      {/* ── Header ─────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-semibold text-white tracking-tight">{greeting}</h1>
          <p className="text-[12px] text-slate-500 mt-0.5 flex items-center gap-2">
            {total} stations monitored · updated {formatDate(latest.trained_at)}
            <DataBadge isLive={isLive} inline />
          </p>
        </div>
      </motion.div>

      {/* ── Network health hero ─────────────────────────────────── */}
      <motion.div custom={0} variants={fade} initial="hidden" animate="visible"
        className="rounded-2xl bg-gradient-to-br from-slate-800/60 to-slate-900/80 border border-white/[0.07] p-5">
        <div className="flex items-start justify-between gap-6">

          {/* Left — the headline number */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Network health</p>
            <div className="flex items-end gap-2">
              <span className="text-[48px] font-bold leading-none tracking-tight text-white">
                <AnimatedCounter value={healthPct} decimals={0} suffix="%" />
              </span>
              <span className="text-slate-400 text-sm mb-2">of stations healthy</span>
            </div>
            <p className="text-[12px] text-emerald-400/80 mt-1 font-medium">
              {healthy.length} stations serving riders well right now
            </p>
          </div>

          {/* Right — station breakdown dots */}
          <div className="text-right space-y-1.5 shrink-0">
            {[
              { count: healthy.length,  label: "Healthy",    dot: "bg-emerald-400" },
              { count: low.length,      label: "Trending low", dot: "bg-amber-400" },
              { count: critical.length, label: "Critical",   dot: "bg-red-400" },
            ].map(({ count, label, dot }) => (
              <div key={label} className="flex items-center justify-end gap-2">
                <span className="text-[12px] text-slate-400">{count} {label}</span>
                <span className={`h-2 w-2 rounded-full ${dot}`} />
              </div>
            ))}
          </div>
        </div>

        {/* Station fill stacked bar */}
        <div className="mt-4">
          <div className="flex h-2 rounded-full overflow-hidden gap-[2px]">
            <motion.div className="bg-emerald-500/60 rounded-l-full"
              initial={{ width: 0 }} animate={{ width: `${(healthy.length / total) * 100}%` }}
              transition={{ duration: 0.8, ease: "easeOut" as const, delay: 0.2 }} />
            <motion.div className="bg-amber-400/60"
              initial={{ width: 0 }} animate={{ width: `${(low.length / total) * 100}%` }}
              transition={{ duration: 0.8, ease: "easeOut" as const, delay: 0.3 }} />
            <motion.div className="bg-red-400/60 rounded-r-full"
              initial={{ width: 0 }} animate={{ width: `${(critical.length / total) * 100}%` }}
              transition={{ duration: 0.8, ease: "easeOut" as const, delay: 0.4 }} />
          </div>
          <div className="flex justify-between mt-1.5 text-[10px] text-slate-600">
            <span>Healthy</span><span>Low</span><span>Critical</span>
          </div>
        </div>
      </motion.div>

      {/* ── KPI strip ──────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            icon: <TrendingUp className="h-4 w-4 text-blue-400" />,
            label: "Predicted trips today",
            value: totalDemand,
            suffix: "",
            sub: "across all stations · 24 h",
            tip: "Sum of model-predicted pickups across all stations over the next 24 hours.",
            color: "text-white",
            i: 1,
          },
          {
            icon: <Bike className="h-4 w-4 text-slate-400" />,
            label: "Avg network fill",
            value: avgFill,
            suffix: "%",
            sub: avgFill < 30 ? "Network running low" : avgFill > 80 ? "Network filling up" : "Healthy range (20–80%)",
            tip: "Average dock occupancy across all monitored stations. Healthy range: 20–80%. Below 15% or above 90% triggers action.",
            color: avgFill < 20 || avgFill > 85 ? "text-amber-300" : "text-white",
            i: 2,
          },
          {
            icon: <Clock className="h-4 w-4 text-slate-400" />,
            label: "Next peak window",
            value: hour < 9 ? (9 - hour) : hour < 17 ? (17 - hour) : (24 - hour + 8),
            suffix: " h away",
            sub: hour < 9 ? "AM commute rush" : hour < 17 ? "PM commute rush" : "Tomorrow AM rush",
            tip: "Time until the next high-demand window (7–9 am or 4–7 pm). Plan truck routes to arrive 30–45 min before peak.",
            color: "text-white",
            i: 3,
          },
        ].map(({ icon, label, value, suffix, sub, tip, color, i }) => (
          <motion.div key={label} custom={i} variants={fade} initial="hidden" animate="visible"
            className="rounded-xl bg-bg-card border border-white/[0.05] p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{label}</p>
                <Tooltip content={tip} />
              </div>
              {icon}
            </div>
            <p className={`text-[26px] font-bold tracking-tight leading-none ${color}`}>
              <AnimatedCounter value={value} decimals={0} suffix={suffix} />
            </p>
            <p className="text-[11px] text-slate-600 mt-1.5">{sub}</p>
          </motion.div>
        ))}
      </div>

      {/* ── Attention items ─────────────────────────────────────── */}
      {attention.length > 0 && (
        <motion.div custom={4} variants={fade} initial="hidden" animate="visible">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">Needs attention</p>
          <div className="rounded-xl bg-bg-card border border-white/[0.05] divide-y divide-white/[0.04] overflow-hidden">
            {attention.map((a, idx) => (
              <button key={idx} onClick={() => router.push(a.href)}
                className="w-full flex items-center gap-4 px-4 py-3.5 text-left hover:bg-white/[0.03] transition-colors group">
                <span className={`h-2 w-2 rounded-full shrink-0 ${a.dot} ${a.urgent ? "ring-2 ring-red-400/20" : ""}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-slate-200">{a.label}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">{a.sub}</p>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-slate-600 group-hover:text-slate-400 transition-colors shrink-0" />
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {/* All-clear */}
      {attention.length === 0 && (
        <motion.div custom={4} variants={fade} initial="hidden" animate="visible"
          className="rounded-xl bg-emerald-500/[0.06] border border-emerald-500/15 px-4 py-3 flex items-center gap-3">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <p className="text-[13px] text-emerald-300 font-medium">All stations healthy — no action needed right now</p>
        </motion.div>
      )}

      {/* ── 24 h demand shape ───────────────────────────────────── */}
      <motion.div custom={5} variants={fade} initial="hidden" animate="visible"
        className="rounded-xl bg-bg-card border border-white/[0.05] p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[13px] font-semibold text-white">Demand shape · next 24 h</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Total predicted pickups across network by hour</p>
          </div>
          <p className="text-[11px] text-slate-600">blue = rush window</p>
        </div>

        <div className="relative flex items-end gap-[3px]" style={{ height: CHART_H }}>
          {hourlyDemand.map(({ hour: h, total }) => {
            const px     = Math.max(total > 0 ? 3 : 0, Math.round((total / overallMax) * CHART_H));
            const isRush = (h >= 7 && h <= 9) || (h >= 16 && h <= 19);
            const label  = h === 0 ? "12 am" : h < 12 ? `${h} am` : h === 12 ? "12 pm" : `${h - 12} pm`;
            return (
              <div key={h} className="flex-1 flex items-end group relative" style={{ height: CHART_H }}>
                {/* Tooltip */}
                <div className="absolute -top-9 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 pointer-events-none">
                  <div className="text-[9px] text-white bg-slate-800 border border-white/10 rounded px-2 py-1 whitespace-nowrap">
                    {label}: <span className="text-blue-300 font-medium">{total}</span>
                  </div>
                </div>
                <motion.div
                  className={`w-full rounded-t-sm ${isRush ? "bg-blue-400/75" : "bg-slate-600/35"}`}
                  style={isRush ? { background: "linear-gradient(to top, rgba(59,130,246,0.8), rgba(96,165,250,0.4))" } : {}}
                  initial={{ height: 0 }}
                  animate={{ height: px }}
                  transition={{ duration: 0.5, delay: h * 0.016, ease: "easeOut" as const }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between mt-2 text-[9px] text-slate-600">
          <span>12 am</span><span>6 am</span><span>12 pm</span><span>6 pm</span><span>11 pm</span>
        </div>
      </motion.div>

      {/* ── Model health strip ──────────────────────────────────── */}
      <motion.div custom={6} variants={fade} initial="hidden" animate="visible" className="grid grid-cols-3 gap-3">
        {[
          {
            icon: <Shield className="h-3.5 w-3.5" />,
            label: "Forecast accuracy",
            status: latest.validation_status === "PASSED" ? "Trusted" : "Review",
            ok: latest.validation_status === "PASSED",
            sub: `±${latest.test_rmse.toFixed(1)} bikes/hr avg error`,
            tip: `Test RMSE: average prediction error in bikes/hr on held-out data. Threshold: < 2.5. Ours: ${latest.test_rmse.toFixed(4)}.`,
            href: "/performance",
          },
          {
            icon: <Activity className="h-3.5 w-3.5" />,
            label: "Model drift",
            status: driftReport.overall_drift_detected ? "Detected" : "Stable",
            ok: !driftReport.overall_drift_detected,
            sub: driftReport.overall_drift_detected ? `${driftReport.feature_drift.drifted_features.length} features shifted` : "Tracking accurately",
            tip: "Drift is flagged when input distributions shift significantly from training (KL divergence > 0.10) or live MAE rises > 20% above baseline.",
            href: "/drift",
          },
          {
            icon: <GitBranch className="h-3.5 w-3.5" />,
            label: "Coverage equity",
            status: biasFlags.length > 0 ? `${biasFlags.length} flag${biasFlags.length > 1 ? "s" : ""}` : "Equitable",
            ok: biasFlags.length === 0,
            sub: biasFlags.length > 0 ? "Low-cap stations: add buffer" : "Consistent across all areas",
            tip: "Bias flags are raised when demand disparity across station groups (capacity, time-of-day, season) exceeds 5×. Wider error at low-volume stations — add extra stock buffer.",
            href: "/bias",
          },
        ].map(({ icon, label, status, ok, sub, tip, href }) => (
          <button key={label} onClick={() => router.push(href)}
            className="rounded-xl bg-bg-card border border-white/[0.05] p-4 text-left hover:bg-white/[0.03] transition-colors group">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-slate-500">
                {icon}
                <p className="text-[10px] font-semibold uppercase tracking-widest">{label}</p>
                <Tooltip content={tip} />
              </div>
              <ArrowRight className="h-3 w-3 text-slate-700 group-hover:text-slate-500 transition-colors" />
            </div>
            <p className={`text-[14px] font-semibold ${ok ? "text-emerald-400" : "text-amber-400"}`}>{status}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>
          </button>
        ))}
      </motion.div>

    </div>
  );
}
