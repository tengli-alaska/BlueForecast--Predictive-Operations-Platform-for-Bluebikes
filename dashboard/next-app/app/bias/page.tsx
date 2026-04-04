"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Scale, Flag, Users } from "lucide-react";
import { getBiasReport } from "@/data";
import BiasDisparityChart from "@/components/charts/BiasDisparityChart";
import AlertBanner from "@/components/shared/AlertBanner";
import ScrollReveal from "@/components/shared/ScrollReveal";
import TextReveal from "@/components/shared/TextReveal";
import { formatNumber } from "@/lib/utils";
import type { BiasReport } from "@/types";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.12 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: "easeOut" as const } },
};

function formatSliceName(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function disparityBadge(ratio: number): { bg: string; text: string } {
  if (ratio > 5.0) return { bg: "bg-red-500/15", text: "text-red-400" };
  if (ratio > 2.0) return { bg: "bg-amber-500/15", text: "text-amber-400" };
  return { bg: "bg-green-500/15", text: "text-green-400" };
}

export default function BiasPage() {
  const [report, setReport] = useState<BiasReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getBiasReport().then((r) => {
      setReport(r);
    }).finally(() => setLoading(false));
  }, []);

  if (loading || !report) {
    return (
      <div className="p-5 md:p-7 flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 rounded-full border-2 border-blue-400/30 border-t-blue-400 animate-spin" />
          <p className="text-sm text-slate-500">Loading data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary bg-grid p-6 md:p-8 space-y-8">
      {/* Title */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-500/20 shadow-[0_0_20px_rgba(234,179,8,0.15)]">
            <Scale className="h-5 w-5 text-yellow-400" />
          </div>
          <h1 className="text-3xl font-bold text-text-primary heading-premium">
            <TextReveal text="Bias & Fairness" />
          </h1>
        </div>
        <p className="text-text-secondary max-w-3xl leading-relaxed">
          Fairness analysis across {report.slices.length} data slices covering{" "}
          {report.total_rows.toLocaleString()} observation rows. Disparity ratios measure the
          max/min mean demand between groups within each slice. Ratios above 5.0x trigger
          investigation flags.
        </p>
      </div>

      {/* Alert Banner */}
      {report.total_flags > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          <AlertBanner
            type="warning"
            title={`${report.total_flags} Fairness Flag${report.total_flags > 1 ? "s" : ""} Detected`}
            message={report.slices
              .filter((s) => s.flags.length > 0)
              .flatMap((s) => s.flags)
              .join(" | ")}
          />
        </motion.div>
      )}

      {/* Disparity Chart */}
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-text-secondary mb-4">
          DISPARITY ANALYSIS
        </p>
        <ScrollReveal>
          <BiasDisparityChart data={report.slices} />
        </ScrollReveal>
      </div>

      {/* Detail Cards */}
      <ScrollReveal>
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-text-secondary mb-4">
            SLICE BREAKDOWN
          </p>
          <p className="text-sm text-text-secondary mb-6">
            Per-group representation, demand statistics, and fairness flags
          </p>

          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3"
          >
            {report.slices.map((slice) => {
              const badge = disparityBadge(slice.disparity_ratio);
              const hasFlagGlow = slice.flags.length > 0;

              return (
                <motion.div
                  key={slice.slice_name}
                  variants={cardVariants}
                  {...(hasFlagGlow
                    ? {
                        animate: {
                          boxShadow: [
                            "0 0 20px rgba(239,68,68,0.05)",
                            "0 0 30px rgba(239,68,68,0.15)",
                            "0 0 20px rgba(239,68,68,0.05)",
                          ],
                        },
                        transition: {
                          boxShadow: { repeat: Infinity, duration: 3, ease: "easeInOut" },
                        },
                      }
                    : {})}
                  className={`backdrop-blur-xl bg-white/[0.05] rounded-2xl p-5 border shadow-[0_8px_32px_rgba(0,0,0,0.3)] ${
                    hasFlagGlow
                      ? "border-red-500/30"
                      : "border-white/[0.08]"
                  }`}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-text-secondary" />
                      <h3 className="text-base font-semibold text-text-primary">
                        {formatSliceName(slice.slice_name)}
                      </h3>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${badge.bg} ${badge.text}`}
                    >
                      {slice.disparity_ratio.toFixed(2)}x
                    </span>
                  </div>

                  {/* Groups */}
                  <div className="space-y-0">
                    {slice.groups.map((g, gIdx) => (
                      <div key={g.group}>
                        <div className="rounded-lg px-3 py-2.5 hover:bg-white/[0.06] transition-colors">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-sm font-medium text-text-primary capitalize">
                              {g.group.replace(/_/g, " ")}
                            </span>
                            <span className="text-xs text-text-secondary">
                              {g.count.toLocaleString()} obs
                            </span>
                          </div>
                          {/* Representation bar */}
                          <div className="flex items-center gap-2 mb-2">
                            <div className="flex-1 h-1.5 rounded-full bg-bg-tertiary">
                              <motion.div
                                className="h-1.5 rounded-full bg-accent-blue"
                                initial={{ width: 0 }}
                                whileInView={{ width: `${Math.min(g.representation_pct, 100)}%` }}
                                transition={{ duration: 0.8, ease: "easeOut" }}
                                viewport={{ once: true }}
                              />
                            </div>
                            <span className="text-xs font-mono text-text-secondary w-10 text-right shrink-0">
                              {g.representation_pct.toFixed(1)}%
                            </span>
                          </div>
                          <div className="flex items-center gap-4 text-xs text-text-secondary">
                            <span>
                              Mean:{" "}
                              <span className="text-text-primary font-medium">
                                {formatNumber(g.mean_demand, 3)}
                              </span>
                            </span>
                            <span>
                              Zero:{" "}
                              <span className="text-text-primary font-medium">
                                {g.zero_demand_pct.toFixed(1)}%
                              </span>
                            </span>
                          </div>
                        </div>
                        {gIdx < slice.groups.length - 1 && (
                          <div className="mx-3 border-t border-white/[0.06]" />
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Flags */}
                  {slice.flags.length > 0 && (
                    <div className="mt-4 space-y-2">
                      {slice.flags.map((flag, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2"
                        >
                          <Flag className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400" />
                          <span className="text-xs text-amber-400">{flag}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </ScrollReveal>
    </div>
  );
}
