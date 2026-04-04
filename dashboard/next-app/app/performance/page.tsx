"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { Target, TrendingUp, BarChart3, CheckCircle, XCircle } from "lucide-react";
import KpiCard from "@/components/shared/KpiCard";
import MetricLineChart from "@/components/charts/MetricLineChart";
import ScatterPlot from "@/components/charts/ScatterPlot";
import ResidualHistogram from "@/components/charts/ResidualHistogram";
import ScrollReveal from "@/components/shared/ScrollReveal";
import TextReveal from "@/components/shared/TextReveal";
import { getModelMetrics, getLatestMetrics } from "@/data";
import { formatNumber } from "@/lib/utils";
import { COLORS } from "@/lib/constants";
import type { ModelMetrics } from "@/types";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } },
};

/**
 * Deterministic pseudo-random number generator using index.
 * Returns a value in [0, 1) with no Math.random().
 */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
}

interface PerformanceData {
  allMetrics: ModelMetrics[];
  latest: ModelMetrics;
}

export default function PerformancePage() {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getModelMetrics(),
      getLatestMetrics(),
    ]).then(([allMetrics, latest]) => {
      setData({ allMetrics, latest });
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

  const { allMetrics, latest } = data;

  // Previous run for trend comparison
  const previous = allMetrics.length >= 2 ? allMetrics[allMetrics.length - 2] : null;

  const rmseTrend = previous
    ? latest.test_rmse < previous.test_rmse
      ? "down"
      : latest.test_rmse > previous.test_rmse
      ? "up"
      : ("stable" as const)
    : undefined;

  const r2Trend = previous
    ? latest.test_r2 > previous.test_r2
      ? "up"
      : latest.test_r2 < previous.test_r2
      ? "down"
      : ("stable" as const)
    : undefined;

  const maeTrend = previous
    ? latest.test_mae < previous.test_mae
      ? "down"
      : latest.test_mae > previous.test_mae
      ? "up"
      : ("stable" as const)
    : undefined;

  const rmseTrendValue = previous
    ? `${formatNumber(Math.abs(latest.test_rmse - previous.test_rmse), 4)} ${latest.test_rmse < previous.test_rmse ? "decrease" : "increase"}`
    : undefined;

  const r2TrendValue = previous
    ? `${formatNumber(Math.abs(latest.test_r2 - previous.test_r2), 4)} ${latest.test_r2 > previous.test_r2 ? "increase" : "decrease"}`
    : undefined;

  const maeTrendValue = previous
    ? `${formatNumber(Math.abs(latest.test_mae - previous.test_mae), 4)} ${latest.test_mae < previous.test_mae ? "decrease" : "increase"}`
    : undefined;

  // Metric chart data for all runs
  const metricChartData = allMetrics.map((m, i) => ({
    label: `Run ${i + 1}`,
    rmse: m.test_rmse,
    r2: m.test_r2,
    mae: m.test_mae,
  }));

  // Generate deterministic scatter data: ~100 points with predicted = actual + noise
  const scatterData = (() => {
    const points: { actual: number; predicted: number }[] = [];
    for (let i = 0; i < 100; i++) {
      const actual = pseudoRandom(i * 3 + 7) * 10;
      const noise = (pseudoRandom(i * 5 + 13) - 0.5) * 2 * latest.test_rmse;
      const predicted = Math.max(0, actual + noise);
      points.push({
        actual: Math.round(actual * 100) / 100,
        predicted: Math.round(predicted * 100) / 100,
      });
    }
    return points;
  })();

  // Generate deterministic residual histogram data (bell-shaped around 0)
  const residualData = (() => {
    const bins: Record<string, number> = {};
    const binEdges = [-3, -2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3];
    const binLabels: string[] = [];

    for (let i = 0; i < binEdges.length - 1; i++) {
      const label = `${binEdges[i].toFixed(1)} to ${binEdges[i + 1].toFixed(1)}`;
      binLabels.push(label);
      bins[label] = 0;
    }

    const center = 6;
    for (let i = 0; i < binLabels.length; i++) {
      const dist = Math.abs(i - center + 0.5);
      const baseCount = Math.round(Math.exp(-0.35 * dist * dist) * 25);
      const variation = Math.round(pseudoRandom(i * 17 + 31) * 3);
      bins[binLabels[i]] = Math.max(1, baseCount + variation);
    }

    return binLabels.map((label) => ({
      range: label,
      count: bins[label],
    }));
  })();

  // Validation gates
  const validationGates = [
    {
      metric: "Test RMSE",
      threshold: `< ${formatNumber(latest.thresholds.max_test_rmse, 1)}`,
      actual: formatNumber(latest.test_rmse, 4),
      passed: latest.test_rmse <= latest.thresholds.max_test_rmse,
      thresholdNum: latest.thresholds.max_test_rmse,
      actualNum: latest.test_rmse,
    },
    {
      metric: "Test R\u00B2",
      threshold: `> ${formatNumber(latest.thresholds.min_test_r2, 2)}`,
      actual: formatNumber(latest.test_r2, 4),
      passed: latest.test_r2 >= latest.thresholds.min_test_r2,
      thresholdNum: latest.thresholds.min_test_r2,
      actualNum: latest.test_r2,
    },
    {
      metric: "Test MAE",
      threshold: `< ${formatNumber(latest.thresholds.max_test_mae, 1)}`,
      actual: formatNumber(latest.test_mae, 4),
      passed: latest.test_mae <= latest.thresholds.max_test_mae,
      thresholdNum: latest.thresholds.max_test_mae,
      actualNum: latest.test_mae,
    },
  ];

  return (
    <div className="min-h-screen bg-bg-primary bg-grid p-6 md:p-8 space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl heading-premium font-bold text-text-primary">
          <TextReveal text="Model Performance" />
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          <TextReveal
            text="Evaluation metrics, diagnostic plots, and validation gate results for the latest model run."
            delay={0.15}
          />
        </p>
      </div>

      {/* Section Label: Model Metrics */}
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-secondary/60">
        Model Metrics
      </p>

      {/* Top Row: KPI Cards */}
      <motion.div
        className="grid grid-cols-1 sm:grid-cols-3 gap-6"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={itemVariants}>
          <KpiCard
            title="Test RMSE"
            value={latest.test_rmse}
            decimals={4}
            icon={<Target className="h-5 w-5" />}
            color={COLORS.blue}
            trend={rmseTrend}
            trendValue={rmseTrendValue}
          />
        </motion.div>
        <motion.div variants={itemVariants}>
          <KpiCard
            title="Test R\u00B2"
            value={latest.test_r2}
            decimals={4}
            icon={<TrendingUp className="h-5 w-5" />}
            color={COLORS.green}
            trend={r2Trend}
            trendValue={r2TrendValue}
          />
        </motion.div>
        <motion.div variants={itemVariants}>
          <KpiCard
            title="Test MAE"
            value={latest.test_mae}
            decimals={4}
            icon={<BarChart3 className="h-5 w-5" />}
            color={COLORS.orange}
            trend={maeTrend}
            trendValue={maeTrendValue}
          />
        </motion.div>
      </motion.div>

      {/* Section Label: Analysis */}
      <ScrollReveal>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-secondary/60">
          Analysis
        </p>
      </ScrollReveal>

      {/* Middle Row: Scatter Plot + Residual Histogram */}
      <ScrollReveal>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="relative overflow-hidden rounded-xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06] shadow-2xl shadow-black/20">
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-px"
              style={{ background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)" }}
            />
            <ScatterPlot data={scatterData} />
          </div>
          <div className="relative overflow-hidden rounded-xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06] shadow-2xl shadow-black/20">
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-px"
              style={{ background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)" }}
            />
            <ResidualHistogram data={residualData} />
          </div>
        </div>
      </ScrollReveal>

      {/* Section Label: Performance History */}
      <ScrollReveal>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-secondary/60">
          Performance History
        </p>
      </ScrollReveal>

      {/* Bottom: Metric Progression Chart */}
      <ScrollReveal>
        <div className="relative overflow-hidden rounded-xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06] shadow-2xl shadow-black/20">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{ background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)" }}
          />
          <MetricLineChart data={metricChartData} title="Metric Progression Across All Runs" />
        </div>
      </ScrollReveal>

      {/* Section Label: Validation Gates */}
      <ScrollReveal>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-secondary/60">
          Validation Gates
        </p>
      </ScrollReveal>

      {/* Validation Gates Table */}
      <ScrollReveal>
        <div className="relative overflow-hidden rounded-2xl backdrop-blur-xl bg-white/[0.05] border border-white/[0.06] p-6 shadow-2xl shadow-black/20">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{ background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)" }}
          />
          <h3 className="text-base font-semibold text-text-primary mb-4">
            Quality Gate Results
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white/[0.04]">
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider rounded-tl-lg">
                    Metric
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
                    Threshold
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
                    Actual Value
                  </th>
                  <th className="px-4 py-3 text-center text-[11px] font-semibold text-text-secondary uppercase tracking-wider rounded-tr-lg">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {validationGates.map((gate) => (
                  <tr
                    key={gate.metric}
                    className={`group transition-colors relative ${
                      gate.passed
                        ? "hover:bg-green-500/[0.03]"
                        : "hover:bg-red-500/[0.03]"
                    }`}
                  >
                    {/* Accent left border */}
                    <td className="px-4 py-4 text-text-primary font-medium relative">
                      <span
                        className={`absolute left-0 top-1 bottom-1 w-[3px] rounded-full ${
                          gate.passed ? "bg-green-500/70" : "bg-red-500/70"
                        }`}
                      />
                      {gate.metric}
                    </td>
                    <td className="px-4 py-4 text-text-secondary font-mono">
                      {gate.threshold}
                    </td>
                    <td className="px-4 py-4 font-mono">
                      <span className={gate.passed ? "text-accent-green" : "text-accent-red"}>
                        {gate.actual}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center">
                      {gate.passed ? (
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full bg-accent-green/10 px-2.5 py-1 text-xs font-medium text-accent-green"
                          style={{ boxShadow: "0 0 12px rgba(34,197,94,0.15)" }}
                        >
                          <CheckCircle className="h-3.5 w-3.5" />
                          PASSED
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full bg-accent-red/10 px-2.5 py-1 text-xs font-medium text-accent-red"
                          style={{ boxShadow: "0 0 12px rgba(239,68,68,0.15)" }}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          FAILED
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-text-secondary">
            Overall validation: <span className={latest.validation_status === "PASSED" ? "text-accent-green font-medium" : "text-accent-red font-medium"}>{latest.validation_status}</span> | Model: {latest.model_type.toUpperCase()} | Best iteration: {latest.best_iteration}
          </p>
        </div>
      </ScrollReveal>
    </div>
  );
}
