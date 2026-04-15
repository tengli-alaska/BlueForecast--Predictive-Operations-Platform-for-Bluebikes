"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Server, HardDrive, Box, Database, Clock, ChevronRight } from "lucide-react";
import { getCostAnalysis } from "@/data";
import type { CostAnalysis } from "@/types";

const fade = {
  hidden: { opacity: 0, y: 8 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.3 },
  }),
};

const SERVICE_ICONS: Record<string, React.ElementType> = {
  "Cloud Run — API": Server,
  "Cloud Run — Dashboard": Server,
  "Cloud Storage (GCS)": HardDrive,
  "Artifact Registry": Box,
  "Cloud Dataproc": Database,
  "Cloud Logging": ChevronRight,
};

const SERVICE_COLORS: Record<string, string> = {
  "Cloud Run — API": "text-blue-400 bg-blue-400/10",
  "Cloud Run — Dashboard": "text-violet-400 bg-violet-400/10",
  "Cloud Storage (GCS)": "text-cyan-400 bg-cyan-400/10",
  "Artifact Registry": "text-orange-400 bg-orange-400/10",
  "Cloud Dataproc": "text-emerald-400 bg-emerald-400/10",
  "Cloud Logging": "text-slate-400 bg-slate-400/10",
};

export default function CostsPage() {
  const [data, setData] = useState<CostAnalysis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCostAnalysis().then(setData).finally(() => setLoading(false));
  }, []);

  if (loading || !data) {
    return (
      <div className="p-5 md:p-7 flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 rounded-full border-2 border-violet-400/30 border-t-violet-400 animate-spin" />
          <p className="text-sm text-slate-500">Loading infrastructure data...</p>
        </div>
      </div>
    );
  }

  const { services, training_durations } = data;

  const cloudRunServices = services.filter((s) => s.name.startsWith("Cloud Run"));
  const otherServices = services.filter((s) => !s.name.startsWith("Cloud Run"));

  return (
    <div className="p-5 md:p-7 space-y-5">
      {/* Header */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h1 className="text-[22px] font-semibold text-white tracking-tight">Infrastructure Overview</h1>
        <p className="text-[13px] text-slate-500 mt-0.5">
          GCP services provisioned for BlueForecast · us-east1
        </p>
      </motion.div>

      {/* Summary badges */}
      <motion.div custom={0} variants={fade} initial="hidden" animate="visible" className="flex flex-wrap gap-2">
        {[
          { label: "Cloud Run Services", value: "2", color: "text-blue-400 bg-blue-400/10 border-blue-400/20" },
          { label: "Max Instances / Service", value: "3", color: "text-violet-400 bg-violet-400/10 border-violet-400/20" },
          { label: "Scale to Zero", value: "Yes", color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
          { label: "Region", value: "us-east1", color: "text-cyan-400 bg-cyan-400/10 border-cyan-400/20" },
        ].map((b) => (
          <span key={b.label} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium ${b.color}`}>
            {b.label}: <span className="font-semibold">{b.value}</span>
          </span>
        ))}
      </motion.div>

      {/* Cloud Run Services */}
      <motion.div custom={1} variants={fade} initial="hidden" animate="visible">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-violet-400/50 mb-2">Cloud Run</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {cloudRunServices.map((s) => {
            const Icon = SERVICE_ICONS[s.name] ?? Server;
            const colorClass = SERVICE_COLORS[s.name] ?? "text-slate-400 bg-slate-400/10";
            return (
              <div key={s.id} className="rounded-xl bg-[#0f1520] p-4">
                <div className="flex items-start gap-3">
                  <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${colorClass}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-white">{s.name}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5 font-mono">{s.id}</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[
                    { label: "Memory", value: s.memory },
                    { label: "CPU", value: s.cpu },
                    { label: "Max Inst.", value: String(s.max_instances) },
                  ].map((spec) => (
                    <div key={spec.label} className="rounded-lg bg-white/[0.03] px-2.5 py-2">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wide">{spec.label}</p>
                      <p className="text-[13px] font-semibold text-white mt-0.5">{spec.value}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 mt-2.5">{s.note}</p>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* Other GCP Services */}
      <motion.div custom={2} variants={fade} initial="hidden" animate="visible">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-violet-400/50 mb-2">Storage & Compute</p>
        <div className="rounded-xl bg-[#0f1520] divide-y divide-white/[0.04]">
          {otherServices.map((s) => {
            const Icon = SERVICE_ICONS[s.name] ?? Server;
            const colorClass = SERVICE_COLORS[s.name] ?? "text-slate-400 bg-slate-400/10";
            return (
              <div key={s.id} className="flex items-start gap-3 p-4">
                <div className={`h-7 w-7 rounded-md flex items-center justify-center shrink-0 ${colorClass}`}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-medium text-white">{s.name}</p>
                    {s.memory && (
                      <span className="text-[11px] text-slate-500 shrink-0">{s.cpu} · {s.memory}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 font-mono mt-0.5">{s.id}</p>
                  <p className="text-[11px] text-slate-500 mt-1">{s.note}</p>
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* Training Durations */}
      <motion.div custom={3} variants={fade} initial="hidden" animate="visible">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-violet-400/50 mb-2">Training Durations</p>
        <div className="rounded-xl bg-[#0f1520] divide-y divide-white/[0.04]">
          {training_durations.map((t) => (
            <div key={t.mode} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-slate-600" />
                <span className="text-[12px] text-slate-400">{t.mode}</span>
              </div>
              <span className="text-[12px] font-semibold text-white">{t.duration}</span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Note */}
      <motion.div custom={4} variants={fade} initial="hidden" animate="visible">
        <p className="text-[11px] text-slate-600 text-center">
          Billing data not yet integrated · connect GCP Billing Export to BigQuery to populate cost figures
        </p>
      </motion.div>
    </div>
  );
}
