"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { getFeatureImportance } from "@/data";
import DataBadge from "@/components/shared/DataBadge";
import Tooltip from "@/components/shared/Tooltip";
import { formatNumber } from "@/lib/utils";
import type { FeatureImportance } from "@/types";

const fade = {
  hidden: { opacity: 0, y: 8 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.06, duration: 0.3 } }),
};

// Plain English names for ops team
const FEATURE_LABELS: Record<string, string> = {
  demand_lag_168h:  "Last week's demand",
  demand_lag_1h:    "1 hour ago demand",
  rolling_avg_24h:  "24 h rolling avg",
  rolling_avg_6h:   "6 h rolling avg",
  demand_lag_24h:   "Yesterday's demand",
  hour_of_day:      "Hour of day",
  temperature_c:    "Temperature",
  capacity:         "Station capacity",
  day_of_week:      "Day of week",
  is_weekend:       "Weekend",
  rolling_avg_3h:   "3 h rolling avg",
  feels_like_c:     "Feels-like temp",
  hour_sin:         "Hour (cyclic)",
  hour_cos:         "Hour (cyclic)",
  precipitation_mm: "Precipitation",
  humidity_pct:     "Humidity",
  month:            "Month",
  wind_speed_kmh:   "Wind speed",
  dow_sin:          "Weekday (cyclic)",
  dow_cos:          "Weekday (cyclic)",
  is_holiday:       "Public holiday",
  month_sin:        "Month (cyclic)",
  month_cos:        "Month (cyclic)",
  is_cold:          "Cold conditions",
  is_hot:           "Hot conditions",
  is_precipitation: "Rain flag",
  year:             "Year",
  start_station_id: "Station ID",
  rolling_avg_12h:  "12 h rolling avg",
  demand_lag_3h:    "3 h ago demand",
};

const CAT_META: Record<string, { label: string; color: string; dot: string }> = {
  lag:     { label: "Past demand",     color: "#60a5fa", dot: "bg-blue-400"   },
  rolling: { label: "Rolling avg",     color: "#34d399", dot: "bg-emerald-400" },
  weather: { label: "Weather",         color: "#22d3ee", dot: "bg-cyan-400"   },
  time:    { label: "Time & calendar", color: "#a78bfa", dot: "bg-violet-400"  },
  station: { label: "Station",         color: "#fb923c", dot: "bg-orange-400"  },
};

// Plain English insight for top-3 features
const TOP_INSIGHTS = [
  { title: "Past demand dominates",    body: "What happened last hour and last week are by far the strongest signals. If a station was busy recently, it will likely stay busy." },
  { title: "Hour of day matters",      body: "Time-of-day patterns — commuter peaks at 8 am and 5 pm — are the next biggest driver after demand history." },
  { title: "Weather shifts predictions", body: "Temperature and feels-like temperature meaningfully adjust forecasts — cold days suppress demand even at normally busy stations." },
];

export default function FeaturesPage() {
  const [features, setFeatures] = useState<FeatureImportance[]>([]);
  const [isLive,   setIsLive]   = useState(false);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    getFeatureImportance().then(r => { setFeatures(r.data); setIsLive(r.isLive); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="p-5 md:p-7 flex items-center justify-center min-h-[50vh]">
      <div className="h-6 w-6 rounded-full border-2 border-blue-400/30 border-t-blue-400 animate-spin" />
    </div>
  );

  const sorted  = [...features].sort((a, b) => b.shap_value - a.shap_value);
  const maxShap = sorted[0]?.shap_value ?? 1;
  const top15   = sorted.slice(0, 15);

  // Category contribution totals
  const catTotals: Record<string, number> = {};
  for (const f of features) catTotals[f.category] = (catTotals[f.category] ?? 0) + f.shap_value;
  const totalShap = Object.values(catTotals).reduce((a, b) => a + b, 0);

  return (
    <div className="p-5 md:p-7 space-y-5 max-w-4xl">

      {/* Header */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2">
        <h1 className="text-[20px] font-semibold text-white tracking-tight">Feature Importance</h1>
        <DataBadge isLive={isLive} />
        <Tooltip content="SHAP value = average absolute impact of each feature on predictions, in trips/hr. A value of 0.32 means that feature shifts a prediction by ±0.32 trips/hr on average across all stations and hours." />
      </motion.div>

      {/* 3 plain-English insights */}
      <div className="grid grid-cols-3 gap-3">
        {TOP_INSIGHTS.map(({ title, body }, i) => (
          <motion.div key={title} custom={i} variants={fade} initial="hidden" animate="visible"
            className="rounded-xl bg-bg-card border border-white/[0.05] p-4">
            <p className="text-[12px] font-semibold text-white mb-1.5">{title}</p>
            <p className="text-[11px] text-slate-500 leading-relaxed">{body}</p>
          </motion.div>
        ))}
      </div>

      {/* Category contribution strip */}
      <motion.div custom={3} variants={fade} initial="hidden" animate="visible"
        className="rounded-xl bg-bg-card border border-white/[0.05] p-4">
        <div className="flex items-center gap-1.5 mb-3">
          <p className="text-[12px] font-semibold text-white">What category drives predictions most</p>
          <Tooltip content="Sum of SHAP values per feature category, as a % of total model impact. Past-demand features dominate because bike demand is highly autocorrelated — yesterday's pattern predicts today's." />
        </div>
        <div className="space-y-2">
          {Object.entries(catTotals)
            .sort(([, a], [, b]) => b - a)
            .map(([cat, total]) => {
              const meta = CAT_META[cat];
              const pct  = Math.round((total / totalShap) * 100);
              return (
                <div key={cat} className="flex items-center gap-3">
                  <div className="flex items-center gap-2 w-32 shrink-0">
                    <span className={`h-2 w-2 rounded-full ${meta?.dot ?? "bg-slate-400"}`} />
                    <span className="text-[11px] text-slate-400">{meta?.label ?? cat}</span>
                  </div>
                  <div className="flex-1 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                    <motion.div className="h-full rounded-full"
                      style={{ backgroundColor: meta?.color ?? "#94a3b8" }}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.6, ease: "easeOut" }} />
                  </div>
                  <span className="text-[11px] text-slate-400 tabular-nums w-8 text-right">{pct}%</span>
                </div>
              );
            })}
        </div>
      </motion.div>

      {/* Ranked feature list — top 15 */}
      <motion.div custom={4} variants={fade} initial="hidden" animate="visible"
        className="rounded-xl bg-bg-card border border-white/[0.05] overflow-hidden">
        <div className="px-4 py-3 border-b border-white/[0.05] flex items-center justify-between">
          <p className="text-[12px] font-semibold text-white">Top 15 features by impact</p>
          <p className="text-[10px] text-slate-600">SHAP value — trips/hr shifted on avg</p>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-[24px_1fr_140px_60px] gap-3 px-4 py-2 text-[9px] font-semibold uppercase tracking-widest text-slate-600 border-b border-white/[0.03]">
          <span>#</span>
          <span>Feature</span>
          <span>Impact bar</span>
          <span className="text-right">SHAP</span>
        </div>

        <div className="divide-y divide-white/[0.03]">
          {top15.map((f, i) => {
            const meta  = CAT_META[f.category];
            const pct   = (f.shap_value / maxShap) * 100;
            const label = FEATURE_LABELS[f.feature] ?? f.feature;

            return (
              <div key={f.feature}
                className="grid grid-cols-[24px_1fr_140px_60px] gap-3 items-center px-4 py-2.5 hover:bg-white/[0.02] transition-colors">

                {/* Rank */}
                <span className="text-[10px] text-slate-600 tabular-nums">{i + 1}</span>

                {/* Feature name + category dot */}
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${meta?.dot ?? "bg-slate-500"}`} />
                  <span className="text-[12px] text-slate-300 truncate">{label}</span>
                </div>

                {/* Bar */}
                <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                  <motion.div className="h-full rounded-full"
                    style={{ backgroundColor: meta?.color ?? "#94a3b8", opacity: 0.75 }}
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.5, delay: i * 0.03, ease: "easeOut" }} />
                </div>

                {/* Value */}
                <span className="text-[11px] font-mono tabular-nums text-right"
                  style={{ color: meta?.color ?? "#94a3b8" }}>
                  {formatNumber(f.shap_value, 3)}
                </span>
              </div>
            );
          })}
        </div>

        {/* Category legend */}
        <div className="px-4 py-3 border-t border-white/[0.05] flex items-center gap-4 flex-wrap">
          {Object.entries(CAT_META).map(([, meta]) => (
            <div key={meta.label} className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
              <span className="text-[10px] text-slate-500">{meta.label}</span>
            </div>
          ))}
        </div>
      </motion.div>

    </div>
  );
}
