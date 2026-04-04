"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowUp, ArrowDown } from "lucide-react";
import AnimatedCounter from "@/components/shared/AnimatedCounter";
import StatusBadge from "@/components/shared/StatusBadge";
import RebalancingMapWrapper from "@/components/map/RebalancingMapWrapper";
import { getStations } from "@/data";
import type { Station, StationStatus, RebalancingRoute } from "@/types";

/* ------------------------------------------------------------------ */
/*  Animations                                                         */
/* ------------------------------------------------------------------ */
const stagger = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" as const } },
};

/* ------------------------------------------------------------------ */
/*  Mock data — inline until backend is wired                          */
/* ------------------------------------------------------------------ */
const STATION_STATUSES: StationStatus[] = [
  { station_id: "A32001", current_bikes: 2,  capacity: 24, fill_pct: 8,  predicted_demand_1h: 6.2, predicted_demand_6h: 18.4, risk_level: "critical", net_flow_1h: -4 },
  { station_id: "A32006", current_bikes: 3,  capacity: 30, fill_pct: 10, predicted_demand_1h: 8.1, predicted_demand_6h: 22.0, risk_level: "critical", net_flow_1h: -5 },
  { station_id: "A32035", current_bikes: 4,  capacity: 28, fill_pct: 14, predicted_demand_1h: 5.8, predicted_demand_6h: 15.2, risk_level: "critical", net_flow_1h: -3 },
  { station_id: "A32036", current_bikes: 27, capacity: 30, fill_pct: 90, predicted_demand_1h: 1.2, predicted_demand_6h: 4.1,  risk_level: "surplus",  net_flow_1h: 6 },
  { station_id: "A32038", current_bikes: 24, capacity: 26, fill_pct: 92, predicted_demand_1h: 0.8, predicted_demand_6h: 3.5,  risk_level: "surplus",  net_flow_1h: 5 },
  { station_id: "A32007", current_bikes: 25, capacity: 28, fill_pct: 89, predicted_demand_1h: 1.0, predicted_demand_6h: 5.0,  risk_level: "surplus",  net_flow_1h: 4 },
  { station_id: "A32009", current_bikes: 5,  capacity: 24, fill_pct: 21, predicted_demand_1h: 4.5, predicted_demand_6h: 12.8, risk_level: "low",      net_flow_1h: -3 },
  { station_id: "A32030", current_bikes: 6,  capacity: 26, fill_pct: 23, predicted_demand_1h: 4.0, predicted_demand_6h: 11.5, risk_level: "low",      net_flow_1h: -2 },
  { station_id: "A32049", current_bikes: 5,  capacity: 24, fill_pct: 21, predicted_demand_1h: 3.9, predicted_demand_6h: 10.2, risk_level: "low",      net_flow_1h: -3 },
  { station_id: "A32002", current_bikes: 12, capacity: 20, fill_pct: 60, predicted_demand_1h: 2.1, predicted_demand_6h: 7.4,  risk_level: "moderate", net_flow_1h: 1 },
  { station_id: "A32003", current_bikes: 10, capacity: 18, fill_pct: 56, predicted_demand_1h: 1.8, predicted_demand_6h: 6.0,  risk_level: "moderate", net_flow_1h: 0 },
  { station_id: "A32011", current_bikes: 11, capacity: 22, fill_pct: 50, predicted_demand_1h: 1.5, predicted_demand_6h: 5.2,  risk_level: "moderate", net_flow_1h: 1 },
  { station_id: "A32016", current_bikes: 9,  capacity: 20, fill_pct: 45, predicted_demand_1h: 2.0, predicted_demand_6h: 6.8,  risk_level: "moderate", net_flow_1h: 0 },
  { station_id: "A32021", current_bikes: 15, capacity: 20, fill_pct: 75, predicted_demand_1h: 1.3, predicted_demand_6h: 4.5,  risk_level: "moderate", net_flow_1h: 2 },
  { station_id: "A32026", current_bikes: 14, capacity: 22, fill_pct: 64, predicted_demand_1h: 1.6, predicted_demand_6h: 5.8,  risk_level: "moderate", net_flow_1h: 1 },
  { station_id: "A32031", current_bikes: 8,  capacity: 24, fill_pct: 33, predicted_demand_1h: 2.8, predicted_demand_6h: 8.5,  risk_level: "low",      net_flow_1h: -1 },
  { station_id: "A32040", current_bikes: 16, capacity: 20, fill_pct: 80, predicted_demand_1h: 0.9, predicted_demand_6h: 3.2,  risk_level: "moderate", net_flow_1h: 2 },
  { station_id: "A32043", current_bikes: 7,  capacity: 16, fill_pct: 44, predicted_demand_1h: 1.4, predicted_demand_6h: 4.0,  risk_level: "moderate", net_flow_1h: 0 },
  { station_id: "A32046", current_bikes: 18, capacity: 22, fill_pct: 82, predicted_demand_1h: 1.1, predicted_demand_6h: 3.8,  risk_level: "surplus",  net_flow_1h: 3 },
  { station_id: "A32008", current_bikes: 7,  capacity: 26, fill_pct: 27, predicted_demand_1h: 3.5, predicted_demand_6h: 9.8,  risk_level: "low",      net_flow_1h: -2 },
];

const ROUTES: RebalancingRoute[] = [
  {
    route_id: "route-alpha",
    truck_id: "truck-01",
    total_distance_km: 8.4,
    estimated_duration_min: 42,
    bikes_moved: 18,
    status: "active",
    stops: [
      { station_id: "A32036", station_name: "South Station",                lat: 42.3523, lon: -71.0551, action: "pickup",  bikes: 8,  order: 1 },
      { station_id: "A32001", station_name: "Back Bay / Stuart St",         lat: 42.3484, lon: -71.0762, action: "dropoff", bikes: 5,  order: 2 },
      { station_id: "A32035", station_name: "Downtown Crossing",            lat: 42.3555, lon: -71.0604, action: "dropoff", bikes: 3,  order: 3 },
      { station_id: "A32038", station_name: "Boston Common",                lat: 42.3560, lon: -71.0641, action: "pickup",  bikes: 6,  order: 4 },
      { station_id: "A32009", station_name: "Kendall/MIT T Station",        lat: 42.3625, lon: -71.0862, action: "dropoff", bikes: 6,  order: 5 },
    ],
  },
  {
    route_id: "route-beta",
    truck_id: "truck-02",
    total_distance_km: 11.2,
    estimated_duration_min: 55,
    bikes_moved: 22,
    status: "active",
    stops: [
      { station_id: "A32007", station_name: "Harvard Square",               lat: 42.3735, lon: -71.1218, action: "pickup",  bikes: 10, order: 1 },
      { station_id: "A32006", station_name: "MIT at Mass Ave",              lat: 42.3581, lon: -71.0936, action: "dropoff", bikes: 7,  order: 2 },
      { station_id: "A32046", station_name: "Broadway T Station",           lat: 42.3425, lon: -71.0571, action: "pickup",  bikes: 5,  order: 3 },
      { station_id: "A32049", station_name: "Seaport Blvd",                 lat: 42.3513, lon: -71.0490, action: "dropoff", bikes: 5,  order: 4 },
      { station_id: "A32030", station_name: "Kenmore Square",               lat: 42.3489, lon: -71.0955, action: "dropoff", bikes: 5,  order: 5 },
    ],
  },
  {
    route_id: "route-gamma",
    truck_id: "truck-03",
    total_distance_km: 6.8,
    estimated_duration_min: 35,
    bikes_moved: 12,
    status: "planned",
    stops: [
      { station_id: "A32021", station_name: "Packard's Corner",             lat: 42.3519, lon: -71.1323, action: "pickup",  bikes: 4,  order: 1 },
      { station_id: "A32031", station_name: "Fenway Park",                  lat: 42.3465, lon: -71.0979, action: "dropoff", bikes: 4,  order: 2 },
      { station_id: "A32040", station_name: "North End - Hanover St",       lat: 42.3634, lon: -71.0548, action: "pickup",  bikes: 4,  order: 3 },
      { station_id: "A32008", station_name: "Central Square",               lat: 42.3651, lon: -71.1032, action: "dropoff", bikes: 4,  order: 4 },
    ],
  },
];

const ROUTE_NAMES: Record<string, string> = {
  "route-alpha": "Truck Alpha",
  "route-beta": "Truck Beta",
  "route-gamma": "Truck Gamma",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function fillBarColor(pct: number): string {
  if (pct < 15 || pct > 90) return "#ef4444";
  if (pct < 30 || pct > 80) return "#f59e0b";
  return "#10b981";
}

function riskBadge(level: string): "error" | "warning" | "success" | "running" {
  if (level === "critical") return "error";
  if (level === "low") return "warning";
  if (level === "surplus") return "running";
  return "success";
}

function routeStatusBadge(status: string): "running" | "pending" | "success" {
  if (status === "active") return "running";
  if (status === "completed") return "success";
  return "pending";
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
export default function RebalancingPage() {
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getStations().then((s) => {
      setStations(s);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-5 md:p-7 flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 rounded-full border-2 border-blue-400/30 border-t-blue-400 animate-spin" />
          <p className="text-sm text-slate-500">Loading data...</p>
        </div>
      </div>
    );
  }

  /* Derived data */
  const stationLookup: Record<string, { name: string; lat: number; lon: number; capacity: number }> = {};
  for (const s of stations) {
    stationLookup[s.station_id] = { name: s.station_name, lat: s.lat, lon: s.lon, capacity: s.capacity };
  }

  const activeTrucks = ROUTES.filter((r) => r.status === "active").length;
  const totalBikesMoved = ROUTES.reduce((sum, r) => sum + r.bikes_moved, 0);
  const criticalCount = STATION_STATUSES.filter((s) => s.risk_level === "critical").length;
  const avgFillRate = Math.round(STATION_STATUSES.reduce((sum, s) => sum + s.fill_pct, 0) / STATION_STATUSES.length);

  /* Sorted by urgency: critical first, then by lowest fill */
  const priorityStations = [...STATION_STATUSES]
    .sort((a, b) => {
      const riskOrder: Record<string, number> = { critical: 0, low: 1, moderate: 2, surplus: 3 };
      const riskDiff = (riskOrder[a.risk_level] ?? 4) - (riskOrder[b.risk_level] ?? 4);
      if (riskDiff !== 0) return riskDiff;
      return a.fill_pct - b.fill_pct;
    })
    .slice(0, 15);

  return (
    <div className="min-h-screen p-6 md:p-8 space-y-6">
      {/* Header with inline stats */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="flex items-end justify-between"
      >
        <div>
          <h1 className="text-[22px] font-semibold text-white tracking-tight">Rebalancing</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">
            {activeTrucks} trucks active · {totalBikesMoved} bikes in transit · {criticalCount} critical stations
          </p>
        </div>
        <div className="flex items-center gap-5 text-sm">
          <div className="text-right">
            <p className="text-[11px] text-slate-500">Network fill</p>
            <p className="text-lg font-semibold text-white tabular-nums">
              <AnimatedCounter value={avgFillRate} decimals={0} suffix="%" />
            </p>
          </div>
        </div>
      </motion.div>

      {/* Map */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        viewport={{ once: true }}
        className="rounded-2xl border border-white/[0.06] bg-[#0f1623] p-4"
      >
        <h3 className="text-sm font-semibold text-white mb-3">Truck Routes & Station Status</h3>
        <RebalancingMapWrapper
          stations={STATION_STATUSES}
          routes={ROUTES}
          stationNames={stationLookup}
        />
      </motion.div>

      {/* Route Details */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05 }}
        viewport={{ once: true }}
      >
        <h3 className="text-sm font-semibold text-white mb-3">Route Details</h3>
        <motion.div
          className="grid grid-cols-1 md:grid-cols-3 gap-4"
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
        >
          {ROUTES.map((route) => (
            <motion.div
              key={route.route_id}
              variants={fadeUp}
              className="rounded-2xl border border-white/[0.06] bg-[#0f1623] p-5"
            >
              {/* Route header */}
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-[13px] font-semibold text-white">
                  {ROUTE_NAMES[route.route_id] || route.truck_id}
                </h4>
                <StatusBadge
                  status={routeStatusBadge(route.status)}
                  label={route.status.charAt(0).toUpperCase() + route.status.slice(1)}
                />
              </div>

              {/* Route stats */}
              <div className="flex items-center gap-4 mb-4 text-[11px] text-slate-500">
                <span>{route.total_distance_km} km</span>
                <span>{route.estimated_duration_min} min</span>
                <span>{route.bikes_moved} bikes</span>
              </div>

              {/* Stop list */}
              <div className="space-y-1.5">
                {route.stops
                  .sort((a, b) => a.order - b.order)
                  .map((stop) => (
                    <div
                      key={stop.order}
                      className="flex items-center gap-2 rounded-lg border border-white/[0.04] bg-white/[0.02] px-3 py-2 hover:bg-white/[0.04] transition-colors"
                    >
                      <span className="text-[10px] font-mono text-slate-600 w-4 text-right shrink-0">
                        {stop.order}
                      </span>
                      <span
                        className="shrink-0"
                        title={stop.action}
                      >
                        {stop.action === "pickup" ? (
                          <ArrowUp className="h-3 w-3 text-blue-400" />
                        ) : (
                          <ArrowDown className="h-3 w-3 text-emerald-400" />
                        )}
                      </span>
                      <span className="text-[12px] text-slate-300 truncate flex-1">
                        {stop.station_name}
                      </span>
                      <span className={`text-[11px] font-medium tabular-nums ${stop.action === "pickup" ? "text-blue-400/80" : "text-emerald-400/80"}`}>
                        {stop.bikes}
                      </span>
                    </div>
                  ))}
              </div>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>

      {/* Station Priority List */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        viewport={{ once: true }}
        className="rounded-2xl border border-white/[0.06] bg-[#0f1623] p-5"
      >
        <h3 className="text-sm font-semibold text-white mb-4">Station Priority</h3>

        {/* Header row */}
        <div className="grid grid-cols-[1fr_140px_80px_80px_80px_60px] gap-2 px-3 pb-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider border-b border-white/[0.04]">
          <span>Station</span>
          <span>Fill Level</span>
          <span className="text-right">Bikes</span>
          <span className="text-center">Risk</span>
          <span className="text-right">Demand 1h</span>
          <span className="text-right">Flow</span>
        </div>

        {/* Rows */}
        <div className="divide-y divide-white/[0.03]">
          {priorityStations.map((s) => {
            const info = stationLookup[s.station_id];
            const name = info?.name ?? s.station_id;
            const cap = info?.capacity ?? s.capacity;
            return (
              <div
                key={s.station_id}
                className="grid grid-cols-[1fr_140px_80px_80px_80px_60px] gap-2 items-center px-3 py-2.5 hover:bg-white/[0.02] transition-colors"
              >
                {/* Station name */}
                <span className="text-[12px] text-slate-300 truncate" title={name}>
                  {name}
                </span>

                {/* Fill bar */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-[5px] rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, s.fill_pct)}%`,
                        backgroundColor: fillBarColor(s.fill_pct),
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-slate-500 tabular-nums w-7 text-right">
                    {s.fill_pct}%
                  </span>
                </div>

                {/* Current / capacity */}
                <span className="text-[11px] text-slate-400 text-right tabular-nums">
                  {s.current_bikes}/{cap}
                </span>

                {/* Risk badge */}
                <span className="flex justify-center">
                  <StatusBadge
                    status={riskBadge(s.risk_level)}
                    label={s.risk_level.charAt(0).toUpperCase() + s.risk_level.slice(1)}
                  />
                </span>

                {/* Predicted demand */}
                <span className="text-[11px] text-slate-400 text-right tabular-nums">
                  {s.predicted_demand_1h.toFixed(1)}
                </span>

                {/* Net flow */}
                <span className={`text-[11px] text-right tabular-nums font-medium ${s.net_flow_1h > 0 ? "text-emerald-400/70" : s.net_flow_1h < 0 ? "text-red-400/70" : "text-slate-500"}`}>
                  {s.net_flow_1h > 0 ? "+" : ""}{s.net_flow_1h}
                </span>
              </div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}
