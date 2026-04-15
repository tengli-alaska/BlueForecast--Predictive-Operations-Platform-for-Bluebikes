"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  BarChart3,
  Target,
  Lightbulb,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { getDriftReport } from "@/data";
import DataBadge from "@/components/shared/DataBadge";
import DriftHeatmap from "@/components/charts/DriftHeatmap";
import StatusBadge from "@/components/shared/StatusBadge";
import ScrollReveal from "@/components/shared/ScrollReveal";
import TextReveal from "@/components/shared/TextReveal";
import { formatNumber } from "@/lib/utils";
import type { DriftReport } from "@/types";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } },
};

export default function DriftPage() {
  const [report, setReport] = useState<DriftReport | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDriftReport().then((r) => {
      setReport(r);
      setIsLive(Object.keys(r.feature_drift?.drift_scores ?? {}).length > 0);
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

  const isAlert = report.overall_drift_detected;

  return (
    <div className="min-h-screen bg-bg-primary bg-grid p-6 md:p-8 space-y-8">
      {/* Title */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-500/20 shadow-[0_0_20px_rgba(6,182,212,0.15)]">
            <Activity className="h-5 w-5 text-cyan-400" />
          </div>
          <h1 className="text-3xl font-bold text-text-primary heading-premium">
            <TextReveal text="Drift Monitoring" />
          </h1>
          <DataBadge isLive={isLive} />
        </div>
        <p className="text-text-secondary max-w-3xl leading-relaxed">
          KL divergence analysis of feature distributions at training time. Flags when
          retraining may be needed — reviewed by an engineer before any action is taken.
        </p>
        <p className="text-[11px] text-slate-500 mt-2">
          Report generated at last model promotion · Calendar features (month, year) flagged but excluded from retrain decision — performance MAE improved 30%
        </p>
      </div>

      {/* Status Banner */}
      <AnimatePresence mode="wait">
        <motion.div
          key="status"
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className={`rounded-2xl border p-6 flex items-center gap-4 backdrop-blur-xl bg-bg-secondary shadow-[0_8px_32px_rgba(0,0,0,0.3)] ${
            isAlert
              ? "border-red-500/40"
              : "border-green-500/40"
          }`}
        >
          <motion.div
            animate={
              isAlert
                ? { scale: [1, 1.15, 1], opacity: [1, 0.7, 1] }
                : {}
            }
            transition={
              isAlert
                ? { duration: 2, repeat: Infinity, ease: "easeInOut" }
                : {}
            }
            className={`flex h-14 w-14 items-center justify-center rounded-full shrink-0 ${
              isAlert
                ? "bg-red-500/20 shadow-[0_0_25px_rgba(239,68,68,0.2)]"
                : "bg-green-500/20 shadow-[0_0_25px_rgba(34,197,94,0.2)]"
            }`}
          >
            {isAlert ? (
              <AlertTriangle className="h-7 w-7 text-red-400" />
            ) : (
              <CheckCircle2 className="h-7 w-7 text-green-400" />
            )}
          </motion.div>
          <div>
            <h2
              className={`text-xl font-bold ${
                isAlert ? "text-red-400" : "text-green-400"
              }`}
            >
              {isAlert ? "Drift Detected" : "No Drift Detected"}
            </h2>
            <p className="text-sm text-text-secondary mt-1">
              {isAlert
                ? "Calendar feature shift detected (month/year). MAE improved 30% — no retrain triggered. Reviewed and accepted by engineering."
                : "All feature distributions, performance metrics, and target statistics are within normal thresholds."}
            </p>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* 3-Column Drift Category Grid */}
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-text-secondary mb-4">
          DRIFT CATEGORIES
        </p>
        <AnimatePresence mode="wait">
          <motion.div
            key="cards"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-1 gap-6 md:grid-cols-3"
          >
            {/* Feature Drift */}
            <motion.div
              variants={cardVariants}
              className="rounded-2xl border border-white/[0.08] border-l-4 border-l-blue-500 backdrop-blur-xl bg-bg-tertiary p-5 shadow-[0_8px_32px_rgba(0,0,0,0.3)]"
            >
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="h-5 w-5 text-blue-400" />
                <h3 className="text-base font-semibold text-text-primary">Feature Drift</h3>
                <div className="ml-auto">
                  <StatusBadge
                    status={report.feature_drift.drift_detected ? "error" : "success"}
                    label={report.feature_drift.drift_detected ? "Drifted" : "Stable"}
                  />
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">Max KL Score</span>
                  <span className="font-mono font-medium text-text-primary">
                    {formatNumber(report.feature_drift.max_drift, 4)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">Threshold</span>
                  <span className="font-mono font-medium text-text-primary">
                    {formatNumber(report.feature_drift.threshold, 2)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">Drifted Features</span>
                  <span className="font-mono font-medium text-text-primary">
                    {report.feature_drift.drifted_features.length}
                  </span>
                </div>
                {/* Progress bar */}
                <div className="mt-1">
                  <div className="w-full h-2 rounded-full bg-bg-tertiary">
                    <motion.div
                      className={`h-2 rounded-full ${
                        report.feature_drift.drift_detected ? "bg-red-500" : "bg-blue-500"
                      }`}
                      initial={{ width: 0 }}
                      animate={{
                        width: `${Math.min(
                          (report.feature_drift.max_drift / report.feature_drift.threshold) * 100,
                          100
                        )}%`,
                      }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                    />
                  </div>
                </div>
                {report.feature_drift.drifted_features.length > 0 && (
                  <div className="mt-2 pt-3 border-t border-white/[0.06]">
                    <p className="text-xs text-text-secondary mb-2">Drifted features:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {report.feature_drift.drifted_features.map((f) => (
                        <span
                          key={f}
                          className="bg-red-500/10 text-red-400 border border-red-500/20 rounded-full px-3 py-1 text-xs font-mono"
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>

            {/* Performance Drift */}
            <motion.div
              variants={cardVariants}
              className="rounded-2xl border border-white/[0.08] border-l-4 border-l-orange-500 backdrop-blur-xl bg-bg-tertiary p-5 shadow-[0_8px_32px_rgba(0,0,0,0.3)]"
            >
              <div className="flex items-center gap-2 mb-4">
                <Activity className="h-5 w-5 text-orange-400" />
                <h3 className="text-base font-semibold text-text-primary">Performance Drift</h3>
                <div className="ml-auto">
                  <StatusBadge
                    status={report.performance_drift.drift_detected ? "error" : "success"}
                    label={report.performance_drift.drift_detected ? "Degraded" : "Stable"}
                  />
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">Baseline MAE</span>
                  <span className="font-mono font-medium text-text-primary">
                    {formatNumber(report.performance_drift.baseline_mae, 4)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">Current MAE</span>
                  <span
                    className={`font-mono font-medium ${
                      report.performance_drift.drift_detected
                        ? "text-red-400"
                        : "text-text-primary"
                    }`}
                  >
                    {formatNumber(report.performance_drift.current_mae, 4)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">MAE Increase</span>
                  <span
                    className={`font-mono font-medium ${
                      report.performance_drift.drift_detected
                        ? "text-red-400"
                        : "text-green-400"
                    }`}
                  >
                    +{formatNumber(report.performance_drift.mae_increase_pct, 2)}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">Threshold</span>
                  <span className="font-mono font-medium text-text-primary">
                    {formatNumber(report.performance_drift.threshold_pct, 1)}%
                  </span>
                </div>
                {/* Progress bar */}
                <div className="mt-1">
                  <div className="w-full h-2 rounded-full bg-bg-tertiary">
                    <motion.div
                      className={`h-2 rounded-full ${
                        report.performance_drift.drift_detected
                          ? "bg-red-500"
                          : "bg-orange-500"
                      }`}
                      initial={{ width: 0 }}
                      animate={{
                        width: `${Math.min(
                          (report.performance_drift.mae_increase_pct /
                            report.performance_drift.threshold_pct) *
                            100,
                          100
                        )}%`,
                      }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                    />
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Target Drift */}
            <motion.div
              variants={cardVariants}
              className="rounded-2xl border border-white/[0.08] border-l-4 border-l-purple-500 backdrop-blur-xl bg-bg-tertiary p-5 shadow-[0_8px_32px_rgba(0,0,0,0.3)]"
            >
              <div className="flex items-center gap-2 mb-4">
                <Target className="h-5 w-5 text-purple-400" />
                <h3 className="text-base font-semibold text-text-primary">Target Drift</h3>
                <div className="ml-auto">
                  <StatusBadge
                    status={report.target_drift.drift_detected ? "error" : "success"}
                    label={report.target_drift.drift_detected ? "Shifted" : "Stable"}
                  />
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">KL Divergence</span>
                  <span
                    className={`font-mono font-medium ${
                      report.target_drift.drift_detected
                        ? "text-red-400"
                        : "text-text-primary"
                    }`}
                  >
                    {formatNumber(report.target_drift.target_kl_divergence, 4)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">Threshold</span>
                  <span className="font-mono font-medium text-text-primary">
                    {formatNumber(report.target_drift.threshold, 2)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">Reference Mean</span>
                  <span className="font-mono font-medium text-text-primary">
                    {formatNumber(report.target_drift.reference_mean, 3)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">Current Mean</span>
                  <span
                    className={`font-mono font-medium ${
                      report.target_drift.drift_detected
                        ? "text-red-400"
                        : "text-text-primary"
                    }`}
                  >
                    {formatNumber(report.target_drift.current_mean, 3)}
                  </span>
                </div>
                {/* Progress bar */}
                <div className="mt-1">
                  <div className="w-full h-2 rounded-full bg-bg-tertiary">
                    <motion.div
                      className={`h-2 rounded-full ${
                        report.target_drift.drift_detected ? "bg-red-500" : "bg-purple-500"
                      }`}
                      initial={{ width: 0 }}
                      animate={{
                        width: `${Math.min(
                          (report.target_drift.target_kl_divergence / report.target_drift.threshold) * 100,
                          100
                        )}%`,
                      }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Drift Heatmap */}
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-text-secondary mb-4">
          FEATURE DRIFT SCORES
        </p>
        <ScrollReveal>
          <AnimatePresence mode="wait">
            <motion.div
              key="heatmap"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.5 }}
            >
              <DriftHeatmap
                driftScores={report.feature_drift.drift_scores}
                threshold={report.feature_drift.threshold}
              />
            </motion.div>
          </AnimatePresence>
        </ScrollReveal>
      </div>

      {/* Recommendation Card */}
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-text-secondary mb-4">
          RECOMMENDATION
        </p>
        <ScrollReveal>
          <AnimatePresence mode="wait">
            <motion.div
              key="rec"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className={`rounded-2xl border p-5 backdrop-blur-xl bg-gradient-to-r shadow-[0_8px_32px_rgba(0,0,0,0.3)] ${
                isAlert
                  ? "border-yellow-500/30 from-red-500/5 to-transparent"
                  : "border-green-500/30 from-green-500/5 to-transparent"
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full shrink-0 ${
                    isAlert
                      ? "bg-yellow-500/20 shadow-[0_0_20px_rgba(234,179,8,0.2)]"
                      : "bg-green-500/20 shadow-[0_0_20px_rgba(34,197,94,0.2)]"
                  }`}
                >
                  <Lightbulb
                    className={`h-5 w-5 ${isAlert ? "text-yellow-400" : "text-green-400"}`}
                  />
                </div>
                <div>
                  <h3
                    className={`text-sm font-semibold ${
                      isAlert ? "text-yellow-400" : "text-green-400"
                    }`}
                  >
                    Recommendation
                  </h3>
                  <p className="mt-1 text-sm text-text-secondary leading-relaxed">
                    {report.recommendation}
                  </p>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </ScrollReveal>
      </div>
    </div>
  );
}
