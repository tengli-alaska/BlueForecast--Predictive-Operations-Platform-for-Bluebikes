"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowUp, ArrowDown } from "lucide-react";
import AnimatedCounter from "@/components/shared/AnimatedCounter";
import StatusBadge from "@/components/shared/StatusBadge";
import DataBadge from "@/components/shared/DataBadge";
import RebalancingMapWrapper from "@/components/map/RebalancingMapWrapper";
import { getStations, getPredictions, getStationMapping } from "@/data";
import { deriveStationStatuses } from "@/lib/utils";
import { mockStationStatuses, mockRebalancingRoutes } from "@/data/mock/rebalancing";
import type { Station, Prediction, StationStatus, RebalancingRoute } from "@/types";

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
/*  AI-suggested routes (clearly labeled as such)                     */
/* ------------------------------------------------------------------ */
const ROUTES: RebalancingRoute[] = [
  {
    route_id: "route-alpha",
    truck_id: "truck-01",
    total_distance_km: 8.4,
    estimated_duration_min: 42,
    bikes_moved: 18,
    status: "active",
    stops: [
      { station_id: "A32036", station_name: "South Station",         lat: 42.3523, lon: -71.0551, action: "pickup",  bikes: 8, order: 1 },
      { station_id: "A32001", station_name: "Back Bay / Stuart St",  lat: 42.3484, lon: -71.0762, action: "dropoff", bikes: 5, order: 2 },
      { station_id: "A32035", station_name: "Downtown Crossing",     lat: 42.3555, lon: -71.0604, action: "dropoff", bikes: 3, order: 3 },
      { station_id: "A32038", station_name: "Boston Common",         lat: 42.3560, lon: -71.0641, action: "pickup",  bikes: 6, order: 4 },
      { station_id: "A32009", station_name: "Kendall/MIT T Station", lat: 42.3625, lon: -71.0862, action: "dropoff", bikes: 6, order: 5 },
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
      { station_id: "A32007", station_name: "Harvard Square",    lat: 42.3735, lon: -71.1218, action: "pickup",  bikes: 10, order: 1 },
      { station_id: "A32006", station_name: "MIT at Mass Ave",   lat: 42.3581, lon: -71.0936, action: "dropoff", bikes: 7,  order: 2 },
      { station_id: "A32046", station_name: "Broadway T Station",lat: 42.3425, lon: -71.0571, action: "pickup",  bikes: 5,  order: 3 },
      { station_id: "A32049", station_name: "Seaport Blvd",      lat: 42.3513, lon: -71.0490, action: "dropoff", bikes: 5,  order: 4 },
      { station_id: "A32030", station_name: "Kenmore Square",    lat: 42.3489, lon: -71.0955, action: "dropoff", bikes: 5,  order: 5 },
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
      { station_id: "A32021", station_name: "Packard's Corner",      lat: 42.3519, lon: -71.1323, action: "pickup",  bikes: 4, order: 1 },
      { station_id: "A32031", station_name: "Fenway Park",           lat: 42.3465, lon: -71.0979, action: "dropoff", bikes: 4, order: 2 },
      { station_id: "A32040", station_name: "North End - Hanover St",lat: 42.3634, lon: -71.0548, action: "pickup",  bikes: 4, order: 3 },
      { station_id: "A32008", station_name: "Central Square",        lat: 42.3651, lon: -71.1032, action: "dropoff", bikes: 4, order: 4 },
    ],
  },
];

const ROUTE_NAMES: Record<string, string> = {
  "route-alpha": "Truck Alpha",
  "route-beta":  "Truck Beta",
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
  const [stationStatuses, setStationStatuses] = useState<StationStatus[]>([]);
  const [stationLookup, setStationLookup] = useState<Record<string, { name: string; lat: number; lon: number; capacity: number }>>({});
  const [stationsLive, setStationsLive] = useState(false);
  const [predictionsLive, setPredictionsLive] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getStations(), getPredictions(), getStationMapping()]).then(([stationsResult, predictionsResult, mapping]) => {
      setStationsLive(stationsResult.isLive);
      setPredictionsLive(predictionsResult.isLive);

      const stations = stationsResult.data;
      const predictions = predictionsResult.data;

      // Build A32xxx → GBFS UUID lookup from station mapping
      const a32ToGbfs: Record<string, string> = {};
      for (const row of mapping) {
        if (row.gbfs_station_id) a32ToGbfs[row.start_station_id] = row.gbfs_station_id;
      }

      const lookup: Record<string, { name: string; lat: number; lon: number; capacity: number }> = {};
      for (const s of stations) {
        lookup[s.station_id] = { name: s.station_name, lat: s.lat, lon: s.lon, capacity: s.capacity };
      }
      setStationLookup(lookup);

      // Translate prediction IDs to GBFS UUIDs so deriveStationStatuses works
      const translatedPredictions: Prediction[] = predictions.map((p) => ({
        ...p,
        station_id: a32ToGbfs[p.station_id] ?? p.station_id,
      }));

      // Use real predictions to derive risk if both are live, else use mock
      if (stationsResult.isLive && predictionsResult.isLive) {
        setStationStatuses(deriveStationStatuses(stations, translatedPredictions));
      } else {
        setStationStatuses(mockStationStatuses);
      }
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-5 md:p-7 flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 rounded-full border-2 border-blue-400/30 border-t-blue-400 animate-spin" />
          <p className="text-sm text-slate-500">Loading station data...</p>
        </div>
      </div>
    );
  }

  const activeTrucks = ROUTES.filter((r) => r.status === "active").length;
  const totalBikesMoved = ROUTES.reduce((sum, r) => sum + r.bikes_moved, 0);
  const criticalCount = stationStatuses.filter((s) => s.risk_level === "critical").length;
  const avgFillRate = Math.round(stationStatuses.reduce((sum, s) => sum + s.fill_pct, 0) / (stationStatuses.length || 1));

  const priorityStations = [...stationStatuses]
    .sort((a, b) => {
      const riskOrder: Record<string, number> = { critical: 0, low: 1, moderate: 2, surplus: 3 };
      const riskDiff = (riskOrder[a.risk_level] ?? 4) - (riskOrder[b.risk_level] ?? 4);
      if (riskDiff !== 0) return riskDiff;
      return a.fill_pct - b.fill_pct;
    })
    .slice(0, 15);

  const dataIsLive = stationsLive && predictionsLive;

  return (
    <div className="min-h-screen p-6 md:p-8 space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="flex items-start justify-between"
      >
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-[22px] font-semibold text-white tracking-tight">Rebalancing</h1>
            <DataBadge isLive={dataIsLive} />
          </div>
          <p className="text-[13px] text-slate-500">
            {criticalCount} stations need bikes now · {stationStatuses.filter(s => s.risk_level === "surplus").length} stations overfull · {ROUTES.length} routes suggested by model
          </p>
          {!dataIsLive && (
            <p className="text-[11px] text-amber-400/70 mt-1">
              API unavailable — station risk levels are representative demo data, not real-time.
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-[11px] text-slate-500">Network fill</p>
          <p className="text-lg font-semibold text-white tabular-nums">
            <AnimatedCounter value={avgFillRate} decimals={0} suffix="%" />
          </p>
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
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white">Truck Routes & Station Risk</h3>
          <DataBadge isLive={dataIsLive} liveLabel="LIVE RISK" mockLabel="DEMO RISK" />
        </div>
        <RebalancingMapWrapper
          stations={stationStatuses}
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
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-white">AI-Suggested Routes</h3>
          <span className="text-[10px] text-slate-500 border border-white/[0.06] rounded-full px-2 py-0.5">
            Model-generated · not dispatched
          </span>
        </div>
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
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-[13px] font-semibold text-white">
                  {ROUTE_NAMES[route.route_id] || route.truck_id}
                </h4>
                <StatusBadge
                  status={routeStatusBadge(route.status)}
                  label={route.status.charAt(0).toUpperCase() + route.status.slice(1)}
                />
              </div>

              <div className="flex items-center gap-4 mb-4 text-[11px] text-slate-500">
                <span>{route.total_distance_km} km</span>
                <span>{route.estimated_duration_min} min</span>
                <span>{route.bikes_moved} bikes</span>
              </div>

              <div className="space-y-1.5">
                {route.stops
                  .sort((a, b) => a.order - b.order)
                  .map((stop) => (
                    <div
                      key={stop.order}
                      className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-white/[0.02] px-3 py-2 hover:bg-bg-secondary transition-colors"
                    >
                      <span className="text-[10px] font-mono text-slate-600 w-4 text-right shrink-0">
                        {stop.order}
                      </span>
                      <span className="shrink-0">
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

      {/* Station Priority */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        viewport={{ once: true }}
        className="rounded-2xl border border-white/[0.06] bg-[#0f1623] p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Station Priority</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {dataIsLive
                ? "Risk derived from live model predictions — sorted by urgency"
                : "Demo data — showing representative station risk levels"}
            </p>
          </div>
          <DataBadge isLive={dataIsLive} liveLabel="LIVE PREDICTIONS" mockLabel="DEMO DATA" />
        </div>

        <div className="grid grid-cols-[1fr_140px_80px_80px_80px_60px] gap-2 px-3 pb-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider border-b border-[var(--border)]">
          <span>Station</span>
          <span>Fill Level</span>
          <span className="text-right">Bikes</span>
          <span className="text-center">Risk</span>
          <span className="text-right">Demand 1h</span>
          <span className="text-right">Flow</span>
        </div>

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
                <span className="text-[12px] text-slate-300 truncate" title={name}>{name}</span>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-[5px] rounded-full bg-bg-tertiary overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${Math.min(100, s.fill_pct)}%`, backgroundColor: fillBarColor(s.fill_pct) }}
                    />
                  </div>
                  <span className="text-[10px] text-slate-500 tabular-nums w-7 text-right">{s.fill_pct}%</span>
                </div>
                <span className="text-[11px] text-slate-400 text-right tabular-nums">{s.current_bikes}/{cap}</span>
                <span className="flex justify-center">
                  <StatusBadge status={riskBadge(s.risk_level)} label={s.risk_level.charAt(0).toUpperCase() + s.risk_level.slice(1)} />
                </span>
                <span className="text-[11px] text-slate-400 text-right tabular-nums">{s.predicted_demand_1h.toFixed(1)}</span>
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
