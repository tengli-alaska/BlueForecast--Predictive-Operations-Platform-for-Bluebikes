"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Activity, CheckCircle2, AlertTriangle, ArrowRight } from "lucide-react";
import { getDriftReport } from "@/data";
import DataBadge from "@/components/shared/DataBadge";
import Tooltip from "@/components/shared/Tooltip";
import { formatNumber } from "@/lib/utils";
import type { DriftReport } from "@/types";

const fade = {
  hidden: { opacity: 0, y: 8 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.07, duration: 0.3 } }),
};

// Category labels for features — makes them readable for ops team
const FEATURE_LABELS: Record<string, string> = {
  temperature_c: "Temperature", precipitation_mm: "Precipitation", feels_like_c: "Feels-like temp",
  wind_speed_kmh: "Wind speed", humidity_pct: "Humidity", is_cold: "Cold flag", is_hot: "Hot flag", is_precipitation: "Rain flag",
  demand_lag_1h: "Demand (1h ago)", demand_lag_24h: "Demand (24h ago)", demand_lag_168h: "Demand (last week)",
  rolling_avg_3h: "3h rolling avg", rolling_avg_6h: "6h rolling avg", rolling_avg_24h: "24h rolling avg",
  hour_of_day: "Hour of day", day_of_week: "Day of week", month: "Month", is_weekend: "Weekend flag",
  is_holiday: "Holiday flag", hour_sin: "Hour (cyclic)", hour_cos: "Hour (cyclic)", dow_sin: "Weekday (cyclic)",
  dow_cos: "Weekday (cyclic)", month_sin: "Month (cyclic)", month_cos: "Month (cyclic)",
  capacity: "Station capacity", start_station_id: "Station ID",
};

function featureLabel(f: string) { return FEATURE_LABELS[f] ?? f; }
function featureCategory(f: string): "weather" | "demand" | "time" | "station" {
  if (["temperature_c","precipitation_mm","feels_like_c","wind_speed_kmh","humidity_pct","is_cold","is_hot","is_precipitation"].includes(f)) return "weather";
  if (f.startsWith("demand") || f.startsWith("rolling")) return "demand";
  if (["capacity","start_station_id"].includes(f)) return "station";
  return "time";
}
const catColor: Record<string, string> = {
  weather: "text-blue-300 bg-blue-500/10",
  demand:  "text-purple-300 bg-purple-500/10",
  time:    "text-slate-300 bg-slate-500/10",
  station: "text-amber-300 bg-amber-500/10",
};

export default function DriftPage() {
  const [report, setReport] = useState<DriftReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDriftReport().then(setReport).finally(() => setLoading(false));
  }, []);

  if (loading || !report) return (
    <div className="p-5 md:p-7 flex items-center justify-center min-h-[50vh]">
      <div className="h-6 w-6 rounded-full border-2 border-blue-400/30 border-t-blue-400 animate-spin" />
    </div>
  );

  const drifted   = report.feature_drift.drifted_features;
  const hasDrift  = report.overall_drift_detected;
  const maeIncrPct = report.performance_drift.mae_increase_pct;

  // Top drifted features sorted by score descending
  const topDrifted = drifted
    .map(f => ({ feature: f, score: report.feature_drift.drift_scores[f] ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  // Show top 8 stable features for context
  const topStable = Object.entries(report.feature_drift.drift_scores)
    .filter(([f]) => !drifted.includes(f))
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8);

  const threshold = report.feature_drift.threshold;

  return (
    <div className="p-5 md:p-7 space-y-5">

      {/* Header */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2">
        <Activity className="h-5 w-5 text-slate-500" />
        <h1 className="text-[20px] font-semibold text-white tracking-tight">Model Drift</h1>
        <DataBadge isLive={false} />
      </motion.div>

      {/* Verdict */}
      <motion.div custom={0} variants={fade} initial="hidden" animate="visible"
        className="rounded-xl bg-white/[0.03] border border-white/[0.07] px-4 py-4">
        <div className="flex items-start gap-3">
          {hasDrift
            ? <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
            : <CheckCircle2  className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />}
          <div>
            <p className={`text-[13px] font-semibold ${hasDrift ? "text-amber-300" : "text-emerald-300"}`}>
              {hasDrift
                ? `Drift detected in ${drifted.length} feature${drifted.length > 1 ? "s" : ""} — retraining recommended`
                : "No drift detected — model is tracking current patterns accurately"}
            </p>
            <p className="text-[12px] text-slate-400 mt-1 leading-relaxed">{report.recommendation}</p>
          </div>
        </div>
      </motion.div>

      {/* 3 signal KPIs */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            label: "Features drifted",
            value: `${drifted.length} / ${Object.keys(report.feature_drift.drift_scores).length}`,
            alert: drifted.length > 0,
            tip: `KL divergence threshold: ${threshold}. Features above this threshold have shifted significantly from training distribution — the model may not have seen these input patterns before.`,
          },
          {
            label: "Max KL divergence",
            value: formatNumber(report.feature_drift.max_drift, 3),
            alert: report.feature_drift.max_drift > threshold,
            tip: `KL divergence measures how much a feature's current distribution differs from training. 0 = identical. >${threshold} = significant drift. Current max: ${formatNumber(report.feature_drift.max_drift, 3)} on "${featureLabel(drifted[0] ?? "")}"`,
          },
          {
            label: "MAE degradation",
            value: `+${formatNumber(maeIncrPct, 1)}%`,
            alert: report.performance_drift.drift_detected,
            tip: `Live MAE vs baseline MAE (${formatNumber(report.performance_drift.baseline_mae, 4)}). If degradation exceeds 20%, drift is flagged as performance drift. Current: +${formatNumber(maeIncrPct, 1)}%.`,
          },
        ].map(({ label, value, alert, tip }, i) => (
          <motion.div key={label} custom={i + 1} variants={fade} initial="hidden" animate="visible"
            className="rounded-xl bg-bg-card p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">{label}</p>
              <Tooltip content={tip} />
            </div>
            <p className={`text-xl font-semibold tracking-tight ${alert ? "text-amber-300" : "text-white"}`}>{value}</p>
          </motion.div>
        ))}
      </div>

      {hasDrift && topDrifted.length > 0 && (
        <motion.div custom={4} variants={fade} initial="hidden" animate="visible"
          className="rounded-xl bg-bg-card p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <p className="text-[13px] font-semibold text-white">What drifted — and why it matters</p>
            <Tooltip content="Features are ranked by KL divergence score. Weather features drifting usually means seasonal change. Demand lag features drifting means ridership behaviour has changed." />
          </div>
          <div className="space-y-2.5">
            {topDrifted.map(({ feature, score }) => {
              const cat   = featureCategory(feature);
              const pct   = Math.min(100, (score / (report.feature_drift.max_drift || 1)) * 100);
              return (
                <div key={feature} className="flex items-center gap-3">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded w-16 text-center shrink-0 ${catColor[cat]}`}>{cat}</span>
                  <span className="text-[12px] text-slate-300 w-36 shrink-0">{featureLabel(feature)}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
                    <motion.div className="h-full rounded-full bg-amber-400/60"
                      initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, ease: "easeOut" as const }} />
                  </div>
                  <span className="text-[11px] text-amber-300/80 font-mono tabular-nums w-10 text-right">{formatNumber(score, 3)}</span>
                  <ArrowRight className="h-3 w-3 text-slate-600 shrink-0" />
                  <span className="text-[10px] text-slate-500 w-28 text-right">threshold {threshold}</span>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Stable features — collapsed summary, not a full heatmap */}
      <motion.div custom={5} variants={fade} initial="hidden" animate="visible"
        className="rounded-xl bg-bg-card p-4">
        <div className="flex items-center gap-1.5 mb-3">
          <p className="text-[13px] font-semibold text-white">
            {hasDrift ? "Stable features" : "All features stable"}
          </p>
          <Tooltip content={`Features below KL divergence threshold of ${threshold} — the model's inputs are behaving as expected for these. No action needed.`} />
        </div>
        <div className="flex flex-wrap gap-2">
          {topStable.map(([feature, score]) => (
            <div key={feature} className="flex items-center gap-1.5 rounded-lg bg-white/[0.03] border border-white/[0.05] px-2.5 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/60 shrink-0" />
              <span className="text-[11px] text-slate-400">{featureLabel(feature)}</span>
              <span className="text-[10px] text-slate-600 font-mono">{formatNumber(score, 3)}</span>
            </div>
          ))}
          {Object.keys(report.feature_drift.drift_scores).length - drifted.length > 8 && (
            <span className="text-[11px] text-slate-500 px-2 py-1.5">
              +{Object.keys(report.feature_drift.drift_scores).length - drifted.length - 8} more stable
            </span>
          )}
        </div>
      </motion.div>

    </div>
  );
}
