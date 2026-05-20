"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Activity, Shield, GitBranch, Bike, TrendingUp, Clock, Zap, CalendarClock } from "lucide-react";
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

function SectionLabel({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-slate-600">{icon}</span>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{label}</p>
    </div>
  );
}

export default function OverviewPage() {
  const [data, setData]       = useState<OverviewData | null>(null);
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
  const hasActNow  = needBikes.length > 0 || overflow.length > 0;
  const hasPlanFor = low.length > 0 || driftReport.overall_drift_detected;

  const CHART_H    = 68;
  const overallMax = Math.max(...hourlyDemand.map(h => h.total), 1);

  return (
    <div className="p-5 md:p-8 space-y-6">

      {/* ── Header ── */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-semibold text-white tracking-tight">{greeting}</h1>
          <p className="text-[12px] text-slate-500 mt-0.5 flex items-center gap-2">
            {total} stations monitored · updated {formatDate(latest.trained_at)}
            <DataBadge isLive={isLive} inline />
          </p>
        </div>
      </motion.div>

      {/* ── 1. NETWORK HEALTH — overall snapshot ── */}
      <motion.div custom={0} variants={fade} initial="hidden" animate="visible">
        <SectionLabel label="Network health" icon={<Bike className="h-3.5 w-3.5" />} />
        <div className="rounded-2xl bg-gradient-to-br from-slate-800/60 to-slate-900/80 border border-white/[0.07] p-5">
          <div className="flex items-start justify-between gap-6">
            <div>
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
            <div className="text-right space-y-1.5 shrink-0">
              {[
                { count: healthy.length,  label: "Healthy",      dot: "bg-emerald-400" },
                { count: low.length,      label: "Trending low",  dot: "bg-amber-400"  },
                { count: critical.length, label: "Critical",      dot: "bg-red-400"    },
              ].map(({ count, label, dot }) => (
                <div key={label} className="flex items-center justify-end gap-2">
                  <span className="text-[12px] text-slate-400">{count} {label}</span>
                  <span className={`h-2 w-2 rounded-full ${dot}`} />
                </div>
              ))}
            </div>
          </div>
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
        </div>
      </motion.div>

      {/* ── 2. ACT NOW — dispatch decisions ── */}
      <motion.div custom={1} variants={fade} initial="hidden" animate="visible">
        <SectionLabel label="Act now" icon={<Zap className="h-3.5 w-3.5" />} />
        {hasActNow ? (
          <div className="rounded-xl bg-bg-card border border-white/[0.05] divide-y divide-white/[0.04] overflow-hidden">
            {needBikes.length > 0 && (
              <button onClick={() => router.push("/rebalancing")}
                className="w-full flex items-center gap-4 px-4 py-3.5 text-left hover:bg-white/[0.03] transition-colors group">
                <span className="h-2 w-2 rounded-full bg-red-400 ring-2 ring-red-400/20 shrink-0" />
                <div className="flex-1">
                  <p className="text-[13px] font-medium text-slate-200">
                    {needBikes.length} station{needBikes.length > 1 ? "s" : ""} nearly empty
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">Dispatch trucks before {nextPeakLabel()} — see priority routes</p>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-slate-600 group-hover:text-slate-400 transition-colors shrink-0" />
              </button>
            )}
            {overflow.length > 0 && (
              <button onClick={() => router.push("/rebalancing")}
                className="w-full flex items-center gap-4 px-4 py-3.5 text-left hover:bg-white/[0.03] transition-colors group">
                <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                <div className="flex-1">
                  <p className="text-[13px] font-medium text-slate-200">
                    {overflow.length} station{overflow.length > 1 ? "s" : ""} overflowing
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">Schedule a pickup — riders being turned away</p>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-slate-600 group-hover:text-slate-400 transition-colors shrink-0" />
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-xl bg-emerald-500/[0.05] border border-emerald-500/10 px-4 py-3 flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <p className="text-[13px] text-emerald-300/80">No immediate dispatch needed — all critical stations are stable</p>
          </div>
        )}
      </motion.div>

      {/* ── 3. PLAN FOR — forecast + upcoming demand ── */}
      <motion.div custom={2} variants={fade} initial="hidden" animate="visible">
        <SectionLabel label="Plan for" icon={<CalendarClock className="h-3.5 w-3.5" />} />
        <div className="rounded-xl bg-bg-card border border-white/[0.05] overflow-hidden">

          {/* Trending low — plan restock before it hits critical */}
          {low.length > 0 && (
            <button onClick={() => router.push(`/forecasts?focus=${low.map(s => s.station_id).join(",")}`)}
              className="w-full flex items-center gap-4 px-4 py-3.5 text-left hover:bg-white/[0.03] transition-colors group border-b border-white/[0.04]">
              <span className="h-2 w-2 rounded-full bg-amber-400/70 shrink-0" />
              <div className="flex-1">
                <p className="text-[13px] font-medium text-slate-200">
                  {low.length} stations trending low
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">Will need bikes in 3–4 h — check demand forecast to plan restock timing</p>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-slate-600 group-hover:text-slate-400 transition-colors shrink-0" />
            </button>
          )}

          {/* Demand chart — when does the next peak hit */}
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-[12px] font-semibold text-white">Demand shape · next 24 h</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{totalDemand.toLocaleString()} predicted trips · blue = rush window</p>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-slate-600" />
                <p className="text-[11px] text-slate-500">Next peak: <span className="text-white font-medium">{nextPeakLabel()}</span></p>
              </div>
            </div>
            <div className="relative flex items-end gap-[3px]" style={{ height: CHART_H }}>
              {hourlyDemand.map(({ hour: h, total }) => {
                const px     = Math.max(total > 0 ? 3 : 0, Math.round((total / overallMax) * CHART_H));
                const isRush = (h >= 7 && h <= 9) || (h >= 16 && h <= 19);
                const label  = h === 0 ? "12 am" : h < 12 ? `${h} am` : h === 12 ? "12 pm" : `${h - 12} pm`;
                return (
                  <div key={h} className="flex-1 flex items-end group relative" style={{ height: CHART_H }}>
                    <div className="absolute -top-9 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 pointer-events-none">
                      <div className="text-[9px] text-white bg-slate-800 border border-white/10 rounded px-2 py-1 whitespace-nowrap">
                        {label}: <span className="text-blue-300 font-medium">{total}</span>
                      </div>
                    </div>
                    <motion.div
                      className={`w-full rounded-t-sm ${isRush ? "" : "bg-slate-600/35"}`}
                      style={isRush ? { background: "linear-gradient(to top, rgba(59,130,246,0.8), rgba(96,165,250,0.4))" } : {}}
                      initial={{ height: 0 }}
                      animate={{ height: px }}
                      transition={{ duration: 0.5, delay: h * 0.016, ease: "easeOut" as const }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between mt-1.5 text-[9px] text-slate-600">
              <span>12 am</span><span>6 am</span><span>12 pm</span><span>6 pm</span><span>11 pm</span>
            </div>
          </div>

        </div>
      </motion.div>

      {/* ── 4. TRUST THE NUMBERS — model health deep dive ── */}
      <motion.div custom={3} variants={fade} initial="hidden" animate="visible">
        <SectionLabel label="Trust the numbers" icon={<Shield className="h-3.5 w-3.5" />} />
        <div className="grid grid-cols-3 gap-3">
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
              tip: "Bias flags are raised when demand disparity across station groups exceeds 5×.",
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
        </div>
      </motion.div>

    </div>
  );
}
