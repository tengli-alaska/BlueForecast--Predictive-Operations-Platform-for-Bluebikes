"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowUp, ArrowDown } from "lucide-react";
import AnimatedCounter from "@/components/shared/AnimatedCounter";
import StatusBadge from "@/components/shared/StatusBadge";
import DataBadge from "@/components/shared/DataBadge";
import Tooltip from "@/components/shared/Tooltip";
import RebalancingMapWrapper from "@/components/map/RebalancingMapWrapper";
import { getStationStatuses, getRebalancingRoutes } from "@/data";
import { mockStations } from "@/data/mock/stations";
import type { StationStatus, RebalancingRoute } from "@/types";

// ── constants ────────────────────────────────────────────────────────────────
const PANEL_H   = 520; // px — list + map share this height for visual cohesion

const RISK_ORDER: Record<string, number> = { critical: 0, low: 1, moderate: 2, surplus: 3 };

const TRUCK_LABELS: Record<string, string> = {
  "RB-URGENT-001": "Truck Alpha",
  "RB-ACTIVE-002": "Truck Beta",
  "RB-PLANNED-003": "Truck Gamma",
};

function fillBarColor(pct: number) {
  if (pct <= 10 || pct >= 92) return "#ef4444";
  if (pct <= 25 || pct >= 80) return "#f59e0b";
  return "#10b981";
}

function riskBadge(l: string): "error" | "warning" | "success" | "running" {
  return l === "critical" ? "error" : l === "low" ? "warning" : l === "surplus" ? "running" : "success";
}

function routeStatusBadge(s: string): "running" | "pending" | "success" {
  return s === "active" ? "running" : s === "completed" ? "success" : "pending";
}

// Build lookup from mockStations for the map
const stationLookup: Record<string, { name: string; lat: number; lon: number; capacity: number }> = {};
for (const s of mockStations)
  stationLookup[s.station_id] = { name: s.station_name, lat: s.lat, lon: s.lon, capacity: s.capacity };

const nameById: Record<string, string> = {};
for (const s of mockStations) nameById[s.station_id] = s.station_name;

// ── page ─────────────────────────────────────────────────────────────────────
export default function RebalancingPage() {
  const [statuses, setStatuses] = useState<StationStatus[]>([]);
  const [routes,   setRoutes]   = useState<RebalancingRoute[]>([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    Promise.all([getStationStatuses(), getRebalancingRoutes()])
      .then(([s, r]) => { setStatuses(s); setRoutes(r); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="p-5 md:p-7 flex items-center justify-center min-h-[50vh]">
      <div className="h-6 w-6 rounded-full border-2 border-blue-400/30 border-t-blue-400 animate-spin" />
    </div>
  );

  const critical    = statuses.filter(s => s.risk_level === "critical");
  const surplus     = statuses.filter(s => s.risk_level === "surplus");
  const low         = statuses.filter(s => s.risk_level === "low");
  const needBikes   = critical.filter(s => s.fill_pct <= 10);
  const avgFill     = Math.round(statuses.reduce((a, b) => a + b.fill_pct, 0) / (statuses.length || 1));
  const activeTrucks = routes.filter(r => r.status === "active").length;

  const priorityList = [...statuses]
    .sort((a, b) => (RISK_ORDER[a.risk_level] ?? 4) - (RISK_ORDER[b.risk_level] ?? 4) || a.fill_pct - b.fill_pct)
    .slice(0, 14);

  return (
    <div className="p-5 md:p-7 space-y-5">

      {/* Header */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <h1 className="text-[20px] font-semibold text-white tracking-tight">Rebalancing</h1>
            <DataBadge isLive={false} />
          </div>
          <p className="text-[12px] text-slate-500">
            {activeTrucks} truck{activeTrucks !== 1 ? "s" : ""} active · {needBikes.length} stations need bikes now · {surplus.length} overfull
          </p>
        </div>
      </motion.div>

      {/* Urgency note — muted, not a red alarm */}
      {needBikes.length > 0 && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 rounded-xl bg-white/[0.03] border border-white/[0.07] px-4 py-2.5">
          <span className="h-2 w-2 rounded-full bg-red-400 ring-2 ring-red-400/20 shrink-0" />
          <p className="text-[12px] text-slate-300">
            <span className="font-semibold text-white">{needBikes.length} station{needBikes.length > 1 ? "s" : ""} under 10% fill</span>
            {" "}— Truck Alpha covers them. Dispatch before next rush window.
          </p>
        </motion.div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Avg network fill",  value: avgFill, suffix: "%",
            color: avgFill >= 20 && avgFill <= 80 ? "text-emerald-300" : "text-amber-300",
            tip: "Average dock occupancy across all stations. Healthy: 20–80%." },
          { label: "Trending low",      value: low.length, suffix: "",
            color: low.length > 0 ? "text-amber-300" : "text-slate-500",
            tip: "Stations at 10–25% fill. Will need bikes in 2–4 h without action." },
          { label: "Need bikes now",    value: needBikes.length, suffix: "",
            color: needBikes.length > 0 ? "text-red-300" : "text-slate-500",
            tip: "Stations below 10% fill. Will hit zero within 1–2 h at current demand." },
          { label: "Overfull",          value: surplus.length, suffix: "",
            color: surplus.length > 0 ? "text-blue-300" : "text-slate-500",
            tip: "Stations above 80% fill. Riders may find no docking space." },
        ].map(({ label, value, suffix, color, tip }, i) => (
          <motion.div key={label}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="rounded-xl bg-bg-card border border-white/[0.05] p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{label}</p>
              <Tooltip content={tip} />
            </div>
            <p className={`text-[24px] font-bold tracking-tight ${color}`}>
              <AnimatedCounter value={value} decimals={0} suffix={suffix} />
            </p>
          </motion.div>
        ))}
      </div>

      {/* ── Command panel: priority list LEFT · map RIGHT ─────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
        className="grid grid-cols-[2fr_3fr] gap-3"
        style={{ height: PANEL_H }}
      >
        {/* Left — priority list */}
        <div className="rounded-xl bg-bg-card border border-white/[0.05] flex flex-col overflow-hidden">
          {/* List header */}
          <div className="px-4 py-3 border-b border-white/[0.05] flex items-center gap-1.5 shrink-0">
            <p className="text-[12px] font-semibold text-white">Station priority</p>
            <Tooltip content="Sorted by risk then fill%. The most urgent stations are at the top — use this to verify the truck routes on the map make geographic sense." />
          </div>

          {/* Column labels */}
          <div className="grid grid-cols-[1fr_52px_44px_40px] gap-1 px-4 py-1.5 text-[9px] font-semibold uppercase tracking-widest text-slate-600 border-b border-white/[0.03] shrink-0">
            <span>Station</span>
            <span className="text-center">Risk</span>
            <span className="text-right">Fill</span>
            <span className="text-right">1 h</span>
          </div>

          {/* Rows — scrollable */}
          <div className="overflow-y-auto flex-1 divide-y divide-white/[0.03]">
            {priorityList.map((s) => {
              const name = nameById[s.station_id] ?? s.station_id;
              return (
                <div key={s.station_id}
                  className="grid grid-cols-[1fr_52px_44px_40px] gap-1 items-center px-4 py-2 hover:bg-white/[0.02] transition-colors">
                  {/* Name + fill bar */}
                  <div className="min-w-0">
                    <p className="text-[11px] text-slate-300 truncate leading-tight" title={name}>{name}</p>
                    <div className="mt-1 h-[3px] rounded-full bg-white/[0.06] overflow-hidden w-full">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, s.fill_pct)}%`, backgroundColor: fillBarColor(s.fill_pct) }} />
                    </div>
                  </div>
                  <div className="flex justify-center">
                    <StatusBadge status={riskBadge(s.risk_level)}
                      label={s.risk_level === "moderate" ? "OK" : s.risk_level.charAt(0).toUpperCase() + s.risk_level.slice(1)} />
                  </div>
                  <span className="text-[11px] tabular-nums text-right text-slate-400">{s.fill_pct}%</span>
                  <span className="text-[11px] tabular-nums text-right" style={{ color: s.net_flow_1h < 0 ? "#f87171" : s.net_flow_1h > 0 ? "#34d399" : "#64748b" }}>
                    {s.net_flow_1h > 0 ? "+" : ""}{s.net_flow_1h}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right — map */}
        <div className="rounded-xl overflow-hidden border border-white/[0.05]">
          <RebalancingMapWrapper
            stations={statuses}
            routes={routes}
            stationNames={stationLookup}
            height={`${PANEL_H}px`}
          />
        </div>
      </motion.div>

      {/* ── Route cards ───────────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }}>
        <div className="flex items-center gap-2 mb-3">
          <p className="text-[12px] font-semibold text-white">Model-suggested routes</p>
          <span className="text-[10px] text-slate-600 border border-white/[0.05] rounded-full px-2 py-0.5">review before dispatch</span>
          <Tooltip content="Routes are generated from predicted demand and current fill. They're recommendations — review on the map above before dispatching." />
        </div>

        <div className="grid grid-cols-3 gap-3">
          {routes.map((route) => (
            <div key={route.route_id} className="rounded-xl bg-bg-card border border-white/[0.05] p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[12px] font-semibold text-white">{TRUCK_LABELS[route.route_id] ?? route.truck_id}</p>
                <StatusBadge status={routeStatusBadge(route.status)}
                  label={route.status.charAt(0).toUpperCase() + route.status.slice(1)} />
              </div>
              <p className="text-[10px] text-slate-500 mb-3">
                {route.total_distance_km} km · {route.estimated_duration_min} min · {route.bikes_moved} bikes
              </p>
              <div className="space-y-1.5">
                {route.stops.sort((a, b) => a.order - b.order).map((stop) => (
                  <div key={stop.order} className="flex items-center gap-2">
                    <span className="text-[9px] text-slate-600 w-3 shrink-0 text-right tabular-nums">{stop.order}</span>
                    {stop.action === "pickup"
                      ? <ArrowUp   className="h-2.5 w-2.5 text-blue-400 shrink-0" />
                      : <ArrowDown className="h-2.5 w-2.5 text-emerald-400 shrink-0" />}
                    <span className="text-[11px] text-slate-300 truncate flex-1">{stop.station_name}</span>
                    <span className={`text-[10px] font-semibold tabular-nums shrink-0 ${stop.action === "pickup" ? "text-blue-400/80" : "text-emerald-400/80"}`}>
                      {stop.bikes}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </motion.div>

    </div>
  );
}
