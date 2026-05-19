"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Flag } from "lucide-react";
import { getBiasReport } from "@/data";
import DataBadge from "@/components/shared/DataBadge";
import Tooltip from "@/components/shared/Tooltip";
import AnimatedCounter from "@/components/shared/AnimatedCounter";
import { formatNumber } from "@/lib/utils";
import type { BiasReport, BiasSlice } from "@/types";

const fade = {
  hidden: { opacity: 0, y: 8 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.07, duration: 0.3 } }),
};

function sliceLabel(name: string) {
  const map: Record<string, string> = {
    time_of_day:       "Time of day",
    day_type:          "Day type",
    season:            "Season",
    station_capacity:  "Station capacity",
    precipitation:     "Precipitation",
    temperature:       "Temperature",
  };
  return map[name] ?? name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function ratioColor(ratio: number) {
  if (ratio > 5) return { bar: "bg-amber-400/70", text: "text-amber-300" };
  if (ratio > 2) return { bar: "bg-blue-400/50",  text: "text-blue-300"  };
  return              { bar: "bg-emerald-400/50", text: "text-emerald-300" };
}

function groupSummary(slice: BiasSlice) {
  const sorted = [...slice.groups].sort((a, b) => b.mean_demand - a.mean_demand);
  const high = sorted[0];
  const low  = sorted[sorted.length - 1];
  return { high, low };
}

export default function BiasPage() {
  const [report,  setReport]  = useState<BiasReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getBiasReport().then(setReport).finally(() => setLoading(false));
  }, []);

  if (loading || !report) return (
    <div className="p-5 md:p-7 flex items-center justify-center min-h-[50vh]">
      <div className="h-6 w-6 rounded-full border-2 border-blue-400/30 border-t-blue-400 animate-spin" />
    </div>
  );

  const flaggedSlices = report.slices.filter(s => s.flags.length > 0);
  const maxRatio      = Math.max(...report.slices.map(s => s.disparity_ratio), 1);

  return (
    <div className="p-5 md:p-7 space-y-5">

      {/* Header */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2">
        <h1 className="text-[20px] font-semibold text-white tracking-tight">Bias & Fairness</h1>
        <DataBadge isLive={false} />
      </motion.div>

      {/* Verdict */}
      <motion.div custom={0} variants={fade} initial="hidden" animate="visible"
        className="rounded-xl bg-white/[0.03] border border-white/[0.07] px-4 py-3 flex items-center gap-3">
        <span className={`h-2 w-2 rounded-full shrink-0 ${report.total_flags > 0 ? "bg-amber-400" : "bg-emerald-400"}`} />
        <div>
          <p className={`text-[13px] font-semibold ${report.total_flags > 0 ? "text-amber-300" : "text-emerald-300"}`}>
            {report.total_flags > 0
              ? `${report.total_flags} fairness flag${report.total_flags > 1 ? "s" : ""} across ${flaggedSlices.length} slice${flaggedSlices.length > 1 ? "s" : ""} — review below`
              : "All data slices within acceptable fairness thresholds"}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {report.total_rows.toLocaleString()} rows · {report.slices.length} dimensions analysed · disparity threshold 5×
          </p>
        </div>
      </motion.div>

      {/* 3 KPIs */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            label: "Training rows",
            value: (report.total_rows / 1_000_000).toFixed(1),
            suffix: "M",
            tip: "Total station-hour observations used in training data. Higher coverage = more representative model.",
            color: "text-white",
          },
          {
            label: "Dimensions checked",
            value: report.slices.length,
            suffix: "",
            tip: "Number of data slices analysed: time of day, day type, season, station capacity, precipitation, temperature.",
            color: "text-white",
          },
          {
            label: "Flags raised",
            value: report.total_flags,
            suffix: "",
            tip: "Flags are raised when a slice's disparity ratio exceeds 5× or a group's representation falls below 2%. Flagged slices need an ops buffer strategy.",
            color: report.total_flags > 0 ? "text-amber-300" : "text-emerald-300",
          },
        ].map(({ label, value, suffix, tip, color }, i) => (
          <motion.div key={label} custom={i + 1} variants={fade} initial="hidden" animate="visible"
            className="rounded-xl bg-bg-card border border-white/[0.05] p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{label}</p>
              <Tooltip content={tip} />
            </div>
            <p className={`text-[24px] font-bold tracking-tight ${color}`}>
              {typeof value === "number"
                ? <AnimatedCounter value={value} decimals={0} suffix={suffix} />
                : <span>{value}{suffix}</span>}
            </p>
          </motion.div>
        ))}
      </div>

      {/* Slice table — the hero, replaces 6 separate cards */}
      <motion.div custom={4} variants={fade} initial="hidden" animate="visible"
        className="rounded-xl bg-bg-card border border-white/[0.05] overflow-hidden">
        <div className="px-4 py-3 border-b border-white/[0.05] flex items-center gap-1.5">
          <p className="text-[12px] font-semibold text-white">Disparity across all dimensions</p>
          <Tooltip content="Disparity ratio = mean demand of highest group ÷ mean demand of lowest group within each slice. Ratios above 5× are flagged — the model has seen very unequal demand patterns across those groups and may have wider error margins for underrepresented ones." />
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-[160px_1fr_120px_90px_70px] gap-3 px-4 py-2 text-[9px] font-semibold uppercase tracking-widest text-slate-600 border-b border-white/[0.03]">
          <span>Dimension</span>
          <span>Disparity bar</span>
          <span>Highest group</span>
          <span>Lowest group</span>
          <span className="text-right">Ratio</span>
        </div>

        <div className="divide-y divide-white/[0.03]">
          {report.slices.map((slice, i) => {
            const { high, low } = groupSummary(slice);
            const { bar, text } = ratioColor(slice.disparity_ratio);
            const barPct = (slice.disparity_ratio / maxRatio) * 100;
            const isFlagged = slice.flags.length > 0;

            return (
              <div key={slice.slice_name}
                className={`grid grid-cols-[160px_1fr_120px_90px_70px] gap-3 items-center px-4 py-3 transition-colors ${isFlagged ? "bg-amber-500/[0.03]" : "hover:bg-white/[0.02]"}`}>

                {/* Dimension name + flag dot */}
                <div className="flex items-center gap-2 min-w-0">
                  {isFlagged
                    ? <Flag className="h-3 w-3 text-amber-400 shrink-0" />
                    : <CheckCircle2 className="h-3 w-3 text-emerald-400/40 shrink-0" />}
                  <span className="text-[12px] text-slate-300 font-medium truncate">{sliceLabel(slice.slice_name)}</span>
                </div>

                {/* Visual bar */}
                <div className="h-2 rounded-full bg-white/[0.05] overflow-hidden">
                  <motion.div className={`h-full rounded-full ${bar}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${barPct}%` }}
                    transition={{ duration: 0.6, delay: i * 0.05, ease: "easeOut" as const }} />
                </div>

                {/* High group */}
                <div className="min-w-0">
                  <p className="text-[10px] text-slate-400 truncate capitalize">{high?.group.replace(/_/g, " ")}</p>
                  <p className="text-[11px] font-semibold text-white font-mono">{formatNumber(high?.mean_demand ?? 0, 2)}/hr</p>
                </div>

                {/* Low group */}
                <div className="min-w-0">
                  <p className="text-[10px] text-slate-500 truncate capitalize">{low?.group.replace(/_/g, " ")}</p>
                  <p className="text-[11px] font-mono text-slate-400">{formatNumber(low?.mean_demand ?? 0, 2)}/hr</p>
                </div>

                {/* Ratio */}
                <p className={`text-[13px] font-bold font-mono text-right ${text}`}>
                  {slice.disparity_ratio.toFixed(1)}×
                </p>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* Flag callout — only when there are flags, plain English ops advice */}
      {flaggedSlices.length > 0 && (
        <motion.div custom={5} variants={fade} initial="hidden" animate="visible"
          className="rounded-xl bg-white/[0.03] border border-amber-500/15 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Flag className="h-3.5 w-3.5 text-amber-400" />
            <p className="text-[12px] font-semibold text-amber-300">What this means for ops</p>
          </div>
          <div className="space-y-2">
            {flaggedSlices.map(slice => (
              <div key={slice.slice_name} className="flex items-start gap-3">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400/60 shrink-0 mt-1.5" />
                <div>
                  <span className="text-[12px] font-medium text-slate-200">{sliceLabel(slice.slice_name)} </span>
                  <span className="text-[12px] text-slate-400">
                    — {slice.disparity_ratio.toFixed(1)}× disparity.{" "}
                    {slice.slice_name === "station_capacity"
                      ? "Low-capacity stations have significantly less training data — add 20–30% extra buffer when stocking these."
                      : slice.slice_name === "time_of_day"
                      ? "Night hours are underrepresented — overnight predictions carry wider error margins, use conservative stock levels."
                      : "Underrepresented groups may have wider prediction error — apply extra stock buffer for those conditions."}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

    </div>
  );
}
