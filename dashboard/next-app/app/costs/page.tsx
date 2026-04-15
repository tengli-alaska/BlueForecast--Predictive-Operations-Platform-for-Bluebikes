"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Server, HardDrive, Box, Database, Clock, DollarSign } from "lucide-react";
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
  "Cloud Logging": DollarSign,
};

const SERVICE_COLORS: Record<string, string> = {
  "Cloud Run — API": "text-blue-400 bg-blue-400/10",
  "Cloud Run — Dashboard": "text-violet-400 bg-violet-400/10",
  "Cloud Storage (GCS)": "text-cyan-400 bg-cyan-400/10",
  "Artifact Registry": "text-orange-400 bg-orange-400/10",
  "Cloud Dataproc": "text-emerald-400 bg-emerald-400/10",
  "Cloud Logging": "text-slate-400 bg-slate-400/10",
};

function estRange(low: number, high: number) {
  if (low === 0 && high <= 1) return "< $1";
  return `$${low}–$${high}`;
}

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
          <p className="text-sm text-slate-500">Loading...</p>
        </div>
      </div>
    );
  }

  const { services, training_durations, est_total_monthly_low_usd, est_total_monthly_high_usd, boston_context, expansion } = data;
  const cloudRunServices = services.filter((s) => s.name.startsWith("Cloud Run"));
  const otherServices = services.filter((s) => !s.name.startsWith("Cloud Run"));

  return (
    <div className="p-5 md:p-7 space-y-5">
      {/* Header */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h1 className="text-[22px] font-semibold text-white tracking-tight">Cost Analysis</h1>
        <p className="text-[13px] text-slate-500 mt-0.5">
          GCP infrastructure · us-east1 · estimated monthly spend
        </p>
      </motion.div>

      {/* Total estimate banner */}
      <motion.div
        custom={0} variants={fade} initial="hidden" animate="visible"
        className="rounded-xl bg-violet-500/10 border border-violet-500/20 p-4 flex items-center justify-between"
      >
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-violet-400/70">Estimated Monthly Total · Boston</p>
          <p className="text-3xl font-semibold text-white mt-1 tracking-tight">
            ${est_total_monthly_low_usd}–${est_total_monthly_high_usd}
            <span className="text-[14px] font-normal text-slate-400 ml-2">/ mo</span>
          </p>
          <p className="text-[11px] text-slate-500 mt-1">{boston_context}</p>
          <p className="text-[11px] text-slate-600 mt-0.5">GCP public pricing · scale-to-zero · ops-team usage hours</p>
        </div>
        <DollarSign className="h-10 w-10 text-violet-400/20" />
      </motion.div>

      {/* Cloud Run */}
      <motion.div custom={1} variants={fade} initial="hidden" animate="visible">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-violet-400/50 mb-2">Cloud Run</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {cloudRunServices.map((s) => {
            const Icon = SERVICE_ICONS[s.name] ?? Server;
            const colorClass = SERVICE_COLORS[s.name] ?? "text-slate-400 bg-slate-400/10";
            return (
              <div key={s.id} className="rounded-xl bg-bg-card p-4">
                <div className="flex items-start gap-3">
                  <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${colorClass}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-white">{s.name}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5 font-mono truncate">{s.id}</p>
                  </div>
                  <span className="text-[12px] font-semibold text-white shrink-0">
                    {estRange(s.est_monthly_low_usd, s.est_monthly_high_usd)}/mo
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[
                    { label: "Memory", value: s.memory },
                    { label: "CPU", value: s.cpu },
                    { label: "Max Inst.", value: String(s.max_instances) },
                  ].map((spec) => (
                    <div key={spec.label} className="rounded-lg bg-bg-secondary px-2.5 py-2">
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

      {/* Other services */}
      <motion.div custom={2} variants={fade} initial="hidden" animate="visible">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-violet-400/50 mb-2">Storage & Compute</p>
        <div className="rounded-xl bg-bg-card divide-y divide-[var(--border)]">
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
                    <span className="text-[12px] font-semibold text-white shrink-0">
                      {estRange(s.est_monthly_low_usd, s.est_monthly_high_usd)}/mo
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 font-mono mt-0.5">{s.id}</p>
                  <p className="text-[11px] text-slate-500 mt-1">{s.note}</p>
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* Training run costs */}
      <motion.div custom={3} variants={fade} initial="hidden" animate="visible">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-violet-400/50 mb-2">Per Training Run (Dataproc)</p>
        <div className="rounded-xl bg-bg-card divide-y divide-[var(--border)]">
          {training_durations.map((t) => (
            <div key={t.mode} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-slate-600 shrink-0" />
                <div>
                  <p className="text-[12px] text-slate-300">{t.mode}</p>
                  <p className="text-[11px] text-slate-500">{t.duration}</p>
                </div>
              </div>
              <span className="text-[12px] font-semibold text-white">
                ~${t.est_cost_usd_low.toFixed(2)}–${t.est_cost_usd_high.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Expansion estimate */}
      <motion.div custom={4} variants={fade} initial="hidden" animate="visible">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-violet-400/50 mb-2">Expansion Estimate</p>
        {expansion.map((city) => (
          <div key={city.city} className="rounded-xl bg-bg-card border border-[var(--border)] p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-white">{city.city}</span>
                  <span className="text-[11px] text-slate-500 bg-bg-secondary rounded px-1.5 py-0.5">{city.operator}</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">{city.notes}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[11px] text-slate-500 uppercase tracking-wide">Marginal cost</p>
                <p className="text-xl font-semibold text-emerald-400 mt-0.5">
                  +${city.est_marginal_monthly_low_usd}–${city.est_marginal_monthly_high_usd}
                  <span className="text-[12px] font-normal text-slate-500 ml-1">/mo</span>
                </p>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Total ~${est_total_monthly_low_usd + city.est_marginal_monthly_low_usd}–${est_total_monthly_high_usd + city.est_marginal_monthly_high_usd}/mo
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                { label: "Stations", value: `~${city.stations}` },
                { label: "Est. Trips", value: city.trips_annual_est },
                { label: "Extra Storage", value: city.marginal_storage_gb },
              ].map((s) => (
                <div key={s.label} className="rounded-lg bg-bg-secondary px-2.5 py-2">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">{s.label}</p>
                  <p className="text-[12px] font-semibold text-white mt-0.5">{s.value}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </motion.div>

      {/* Disclaimer */}
      <motion.div custom={5} variants={fade} initial="hidden" animate="visible">
        <p className="text-[11px] text-slate-600 text-center">
          Estimates based on GCP public pricing · connect GCP Billing Export → BigQuery for actuals
        </p>
      </motion.div>
    </div>
  );
}
