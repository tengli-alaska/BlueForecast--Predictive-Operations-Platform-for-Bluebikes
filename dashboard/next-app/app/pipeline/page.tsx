"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  GitBranch,
  BarChart3,
  TestTube,
  Package,
  Clock,
  CheckCircle2,
  Gauge,
  ShieldCheck,
  Layers,
} from "lucide-react";
import { getPipelineStatus } from "@/data";
import KpiCard from "@/components/shared/KpiCard";
import StatusBadge from "@/components/shared/StatusBadge";
import ScrollReveal from "@/components/shared/ScrollReveal";
import TextReveal from "@/components/shared/TextReveal";
import { formatDate, formatNumber } from "@/lib/utils";
import type { PipelineStatus } from "@/types";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.12 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } },
};

function formatTaskName(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function calcDuration(start?: string, end?: string): string {
  if (!start || !end) return "--";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function mapStatus(
  status: "pending" | "running" | "success" | "failed"
): "pending" | "running" | "success" | "error" {
  return status === "failed" ? "error" : status;
}

function statusGlow(status: "pending" | "running" | "success" | "failed"): string {
  switch (status) {
    case "success":
      return "shadow-[0_0_20px_rgba(34,197,94,0.2)] border-green-500/40";
    case "running":
      return "shadow-[0_0_20px_rgba(59,130,246,0.2)] border-blue-500/40";
    case "failed":
      return "shadow-[0_0_20px_rgba(239,68,68,0.2)] border-red-500/40";
    default:
      return "border-white/[0.08]";
  }
}

function statusBorderColor(status: "pending" | "running" | "success" | "failed"): string {
  switch (status) {
    case "success":
      return "#22c55e";
    case "running":
      return "#3b82f6";
    case "failed":
      return "#ef4444";
    default:
      return "rgba(255,255,255,0.08)";
  }
}

const TASK_ICONS: Record<string, React.ReactNode> = {
  validate_data_input: <ShieldCheck className="h-5 w-5" />,
  train_and_evaluate: <BarChart3 className="h-5 w-5" />,
  detect_bias_and_sensitivity: <TestTube className="h-5 w-5" />,
  register_and_predict: <Package className="h-5 w-5" />,
};

const TASK_COLORS: Record<string, string> = {
  validate_data_input: "#3b82f6",
  train_and_evaluate: "#22c55e",
  detect_bias_and_sensitivity: "#a855f7",
  register_and_predict: "#f97316",
};

export default function PipelinePage() {
  const [pipeline, setPipeline] = useState<PipelineStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPipelineStatus().then(({ data }) => {
      setPipeline(data);
    }).finally(() => setLoading(false));
  }, []);

  if (loading || !pipeline) {
    return (
      <div className="p-5 md:p-7 flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 rounded-full border-2 border-blue-400/30 border-t-blue-400 animate-spin" />
          <p className="text-sm text-slate-500">Loading data...</p>
        </div>
      </div>
    );
  }

  const taskEntries = Object.entries(pipeline.tasks);

  return (
    <div className="min-h-screen bg-bg-primary bg-grid p-6 md:p-8 space-y-8">
      {/* Title */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-500/20 shadow-[0_0_20px_rgba(249,115,22,0.15)]">
            <GitBranch className="h-5 w-5 text-orange-400" />
          </div>
          <h1 className="text-3xl font-bold text-text-primary heading-premium">
            <TextReveal text="Pipeline Status" />
          </h1>
        </div>
        <p className="text-text-secondary max-w-3xl leading-relaxed">
          Airflow DAG run{" "}
          <span className="font-mono text-text-primary text-sm">{pipeline.dag_run_id}</span> --
          monitoring task execution, durations, and output metrics across the full ML pipeline.
        </p>
      </div>

      {/* KPI Row */}
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-text-secondary mb-4">
          PIPELINE METRICS
        </p>
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4"
        >
          <motion.div variants={cardVariants}>
            <KpiCard
              title="Validation RMSE"
              value={pipeline.metrics.val_rmse ?? 0}
              decimals={4}
              icon={<Gauge className="h-5 w-5" />}
              color="#3b82f6"
            />
          </motion.div>
          <motion.div variants={cardVariants}>
            <KpiCard
              title="Test RMSE"
              value={pipeline.metrics.test_rmse ?? 0}
              decimals={4}
              icon={<BarChart3 className="h-5 w-5" />}
              color="#22c55e"
            />
          </motion.div>
          <motion.div variants={cardVariants}>
            <KpiCard
              title="Registry Version"
              value={pipeline.metrics.registry_version ?? 0}
              prefix="v"
              icon={<Package className="h-5 w-5" />}
              color="#a855f7"
            />
          </motion.div>
          <motion.div variants={cardVariants}>
            <KpiCard
              title="Overall Status"
              value={pipeline.overall_status === "success" ? 1 : 0}
              suffix={pipeline.overall_status === "success" ? " PASSED" : " FAILED"}
              icon={<CheckCircle2 className="h-5 w-5" />}
              color={pipeline.overall_status === "success" ? "#22c55e" : "#ef4444"}
            />
          </motion.div>
        </motion.div>
      </div>

      {/* Pipeline Flow Visualization */}
      <ScrollReveal>
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-text-secondary mb-4">
            EXECUTION FLOW
          </p>
          <div className="rounded-2xl border border-white/[0.08] backdrop-blur-xl bg-white/[0.03] p-6 overflow-x-auto shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
            <div className="flex items-center justify-center gap-0 min-w-[700px]">
              {taskEntries.map(([taskName, task], index) => {
                const color = TASK_COLORS[taskName] || "#3b82f6";
                const icon = TASK_ICONS[taskName];
                const duration = calcDuration(task.started_at, task.completed_at);
                const isLast = index === taskEntries.length - 1;
                const glow = statusGlow(task.status);
                const borderColor = statusBorderColor(task.status);

                return (
                  <motion.div
                    key={taskName}
                    initial={{ opacity: 0, x: -30 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      duration: 0.5,
                      delay: 0.3 + index * 0.15,
                      ease: "easeOut",
                    }}
                    className="flex items-center"
                  >
                    {/* Task Node */}
                    <div
                      className={`flex flex-col items-center rounded-2xl border-2 backdrop-blur-xl bg-white/[0.05] p-4 min-w-[150px] ${glow}`}
                      style={{ borderColor }}
                    >
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-full mb-2"
                        style={{ backgroundColor: `${color}20`, color }}
                      >
                        {icon}
                      </div>
                      <p className="text-xs font-semibold text-text-primary text-center mb-1.5">
                        {formatTaskName(taskName)}
                      </p>
                      <StatusBadge status={mapStatus(task.status)} />
                      <div className="flex items-center gap-1 mt-2 text-text-secondary">
                        <Clock className="h-3 w-3" />
                        <span className="text-xs font-mono">{duration}</span>
                      </div>
                    </div>

                    {/* SVG Arrow connector */}
                    {!isLast && (
                      <svg className="w-12 h-8 shrink-0" viewBox="0 0 48 32">
                        <defs>
                          <linearGradient id={`arrowGrad-${index}`} x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="rgba(255,255,255,0.1)" />
                            <stop offset="50%" stopColor="rgba(255,255,255,0.2)" />
                            <stop offset="100%" stopColor="rgba(255,255,255,0.1)" />
                          </linearGradient>
                        </defs>
                        <line
                          x1="0"
                          y1="16"
                          x2="40"
                          y2="16"
                          stroke={`url(#arrowGrad-${index})`}
                          strokeWidth="2"
                        />
                        <polygon points="40,10 48,16 40,22" fill="rgba(255,255,255,0.15)" />
                      </svg>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      </ScrollReveal>

      {/* Task Detail Cards */}
      <ScrollReveal>
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-text-secondary mb-4">
            TASK DETAILS
          </p>
          <p className="text-sm text-text-secondary mb-6">
            Execution timeline and duration for each pipeline stage
          </p>

          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4"
          >
            {taskEntries.map(([taskName, task]) => {
              const color = TASK_COLORS[taskName] || "#3b82f6";
              const icon = TASK_ICONS[taskName];
              const duration = calcDuration(task.started_at, task.completed_at);

              return (
                <motion.div
                  key={taskName}
                  variants={cardVariants}
                  className="rounded-2xl border border-white/[0.08] border-l-4 backdrop-blur-xl bg-white/[0.05] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.3)]"
                  style={{ borderLeftColor: color }}
                >
                  <div className="flex items-center gap-2 mb-4">
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-lg"
                      style={{ backgroundColor: `${color}20`, color }}
                    >
                      {icon}
                    </div>
                    <h3 className="text-sm font-semibold text-text-primary">
                      {formatTaskName(taskName)}
                    </h3>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text-secondary">Status</span>
                      <StatusBadge status={mapStatus(task.status)} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text-secondary">Started</span>
                      <span className="text-xs font-mono text-text-secondary">
                        {task.started_at ? formatDate(task.started_at) : "--"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text-secondary">Completed</span>
                      <span className="text-xs font-mono text-text-secondary">
                        {task.completed_at ? formatDate(task.completed_at) : "--"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text-secondary">Duration</span>
                      <span className="font-mono text-accent-blue font-medium text-sm">
                        {duration}
                      </span>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </ScrollReveal>

      {/* Metrics Summary Card */}
      <ScrollReveal>
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-text-secondary mb-4">
            RUN SUMMARY
          </p>
          <div className="rounded-2xl border border-white/[0.08] backdrop-blur-xl bg-white/[0.05] p-6 shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
            <div className="flex items-center gap-2 mb-5">
              <Layers className="h-5 w-5 text-cyan-400" />
              <h3 className="text-base font-semibold text-text-primary">Pipeline Metrics Summary</h3>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="bg-white/[0.03] rounded-lg px-4 py-3">
                <p className="text-xs text-text-secondary mb-1">Validation RMSE</p>
                <p className="text-lg font-bold text-blue-400 font-mono">
                  {pipeline.metrics.val_rmse != null
                    ? formatNumber(pipeline.metrics.val_rmse, 4)
                    : "--"}
                </p>
              </div>
              <div className="bg-white/[0.03] rounded-lg px-4 py-3">
                <p className="text-xs text-text-secondary mb-1">Test RMSE</p>
                <p className="text-lg font-bold text-blue-400 font-mono">
                  {pipeline.metrics.test_rmse != null
                    ? formatNumber(pipeline.metrics.test_rmse, 4)
                    : "--"}
                </p>
              </div>
              <div className="bg-white/[0.03] rounded-lg px-4 py-3">
                <p className="text-xs text-text-secondary mb-1">Bias Status</p>
                <p
                  className={`text-lg font-bold font-mono ${
                    pipeline.metrics.bias_status === "PASSED"
                      ? "text-green-400"
                      : "text-red-400"
                  }`}
                >
                  {pipeline.metrics.bias_status ?? "--"}
                </p>
              </div>
              <div className="bg-white/[0.03] rounded-lg px-4 py-3">
                <p className="text-xs text-text-secondary mb-1">Registry Version</p>
                <p className="text-lg font-bold text-purple-400 font-mono">
                  v{pipeline.metrics.registry_version ?? "--"}
                </p>
              </div>
            </div>

            {/* Timeline */}
            <div className="mt-5 pt-4 border-t border-white/[0.06] flex flex-wrap items-center gap-6 text-sm text-text-secondary">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                <span>
                  Started:{" "}
                  <span className="text-text-primary font-mono">
                    {formatDate(pipeline.started_at)}
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                <span>
                  Completed:{" "}
                  <span className="text-text-primary font-mono">
                    {formatDate(pipeline.updated_at)}
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                <span>
                  Total Duration:{" "}
                  <span className="text-text-primary font-mono">
                    {calcDuration(pipeline.started_at, pipeline.updated_at)}
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </ScrollReveal>
    </div>
  );
}
