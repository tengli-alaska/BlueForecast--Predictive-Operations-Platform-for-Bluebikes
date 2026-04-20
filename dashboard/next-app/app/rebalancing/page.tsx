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
import { mockStationStatuses } from "@/data/mock/rebalancing";
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
/*  Route generation from station priority data                       */
/* ------------------------------------------------------------------ */
const TRUCK_NAMES = ["Truck Alpha", "Truck Beta", "Truck Gamma"];
const TRUCK_STATUSES: RebalancingRoute["status"][] = ["active", "active", "planned"];
const ESTIMATED_KM = [8.4, 11.2, 6.8];
const ESTIMATED_MIN = [42, 55, 35];

function buildRoutes(
  statuses: StationStatus[],
  lookup: Record<string, { name: string; lat: number; lon: number; capacity: number }>,
): RebalancingRoute[] {
  // Split into critical (need bikes) and surplus (too many bikes)
  const critical = statuses.filter(s => s.risk_level === "critical" && lookup[s.station_id]);
  const surplus = statuses.filter(s => s.risk_level === "surplus" && lookup[s.station_id]);

  // If no real data, return empty (parent falls back to mock routes)
  if (critical.length === 0 && surplus.length === 0) return [];

  const routes: RebalancingRoute[] = [];
  // Distribute critical/surplus stations across 3 truck routes
  const chunkSize = Math.ceil(Math.max(critical.length, surplus.length) / 3);

  for (let t = 0; t < 3; t++) {
    const pickups = surplus.slice(t * chunkSize, (t + 1) * chunkSize).slice(0, 3);
    const dropoffs = critical.slice(t * chunkSize, (t + 1) * chunkSize).slice(0, 3);
    if (pickups.length === 0 && dropoffs.length === 0) continue;

    const stops = [
      ...pickups.map((s, i) => {
        const info = lookup[s.station_id]!;
        const bikesNeeded = Math.max(1, Math.round(s.capacity * 0.3));
        return { station_id: s.station_id, station_name: info.name, lat: info.lat, lon: info.lon, action: "pickup" as const, bikes: bikesNeeded, order: i + 1 };
      }),
      ...dropoffs.map((s, i) => {
        const info = lookup[s.station_id]!;
        const bikesDrop = Math.max(1, Math.round(s.capacity * 0.3));
        return { station_id: s.station_id, station_name: info.name, lat: info.lat, lon: info.lon, action: "dropoff" as const, bikes: bikesDrop, order: pickups.length + i + 1 };
      }),
    ];

    if (stops.length < 2) continue;
    const bikesMoved = stops.reduce((s, stop) => s + stop.bikes, 0);

    routes.push({
      route_id: `route-${["alpha", "beta", "gamma"][t]}`,
      truck_id: `truck-0${t + 1}`,
      total_distance_km: ESTIMATED_KM[t],
      estimated_duration_min: ESTIMATED_MIN[t],
      bikes_moved: bikesMoved,
      status: TRUCK_STATUSES[t],
      stops,
    });
  }
  return routes;
}

// Fallback showcase routes (used when no live data)
const FALLBACK_ROUTES: RebalancingRoute[] = [
  {
    route_id: "route-alpha", truck_id: "truck-01",
    total_distance_km: 8.4, estimated_duration_min: 42, bikes_moved: 18, status: "active",
    stops: [
      { station_id: "A32036", station_name: "South Station",         lat: 42.3523, lon: -71.0551, action: "pickup",  bikes: 8, order: 1 },
      { station_id: "A32001", station_name: "Back Bay / Stuart St",  lat: 42.3484, lon: -71.0762, action: "dropoff", bikes: 5, order: 2 },
      { station_id: "A32035", station_name: "Downtown Crossing",     lat: 42.3555, lon: -71.0604, action: "dropoff", bikes: 3, order: 3 },
      { station_id: "A32038", station_name: "Boston Common",         lat: 42.3560, lon: -71.0641, action: "pickup",  bikes: 6, order: 4 },
      { station_id: "A32009", station_name: "Kendall/MIT T Station", lat: 42.3625, lon: -71.0862, action: "dropoff", bikes: 6, order: 5 },
    ],
  },
  {
    route_id: "route-beta", truck_id: "truck-02",
    total_distance_km: 11.2, estimated_duration_min: 55, bikes_moved: 22, status: "active",
    stops: [
      { station_id: "A32007", station_name: "Harvard Square",    lat: 42.3735, lon: -71.1218, action: "pickup",  bikes: 10, order: 1 },
      { station_id: "A32006", station_name: "MIT at Mass Ave",   lat: 42.3581, lon: -71.0936, action: "dropoff", bikes: 7,  order: 2 },
      { station_id: "A32046", station_name: "Broadway T Station",lat: 42.3425, lon: -71.0571, action: "pickup",  bikes: 5,  order: 3 },
      { station_id: "A32049", station_name: "Seaport Blvd",      lat: 42.3513, lon: -71.0490, action: "dropoff", bikes: 5,  order: 4 },
    ],
  },
  {
    route_id: "route-gamma", truck_id: "truck-03",
    total_distance_km: 6.8, estimated_duration_min: 35, bikes_moved: 12, status: "planned",
    stops: [
      { station_id: "A32021", station_name: "Packard's Corner",       lat: 42.3519, lon: -71.1323, action: "pickup",  bikes: 4, order: 1 },
      { station_id: "A32031", station_name: "Fenway Park",            lat: 42.3465, lon: -71.0979, action: "dropoff", bikes: 4, order: 2 },
      { station_id: "A32040", station_name: "North End - Hanover St", lat: 42.3634, lon: -71.0548, action: "pickup",  bikes: 4, order: 3 },
      { station_id: "A32008", station_name: "Central Square",         lat: 42.3651, lon: -71.1032, action: "dropoff", bikes: 4, order: 4 },
    ],
  },
];


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
  const [routes, setRoutes] = useState<RebalancingRoute[]>(FALLBACK_ROUTES);
  const [stationsLive, setStationsLive] = useState(false);
  const [predictionsLive, setPredictionsLive] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getStations(), getPredictions(), getStationMapping()]).then(([stationsResult, predictionsResult, mapping]) => {
      setStationsLive(stationsResult.isLive);
      setPredictionsLive(predictionsResult.isLive);

      const stations = stationsResult.data;
      const predictions = predictionsResult.data;

      // Build A32xxx → GBFS UUID and reverse lookups
      const a32ToGbfs: Record<string, string> = {};
      const gbfsToA32: Record<string, string> = {};
      for (const row of mapping) {
        if (row.gbfs_station_id) {
          a32ToGbfs[row.start_station_id] = row.gbfs_station_id;
          gbfsToA32[row.gbfs_station_id] = row.start_station_id;
        }
      }

      // Build lookup keyed by BOTH GBFS UUID and A32xxx so it works regardless of which ID predictions use
      const lookup: Record<string, { name: string; lat: number; lon: number; capacity: number }> = {};
      for (const s of stations) {
        const entry = { name: s.station_name, lat: s.lat, lon: s.lon, capacity: s.capacity };
        lookup[s.station_id] = entry;
        // Also key by A32xxx if mapping available
        const a32 = gbfsToA32[s.station_id];
        if (a32) lookup[a32] = entry;
      }
      setStationLookup(lookup);

      // Translate prediction IDs to GBFS UUIDs so deriveStationStatuses works
      const translatedPredictions: Prediction[] = predictions.map((p) => ({
        ...p,
        station_id: a32ToGbfs[p.station_id] ?? p.station_id,
      }));

      // Use real predictions to derive risk; show empty if no live data
      const finalStatuses = (stationsResult.isLive && predictionsResult.isLive)
        ? deriveStationStatuses(stations, translatedPredictions)
        : mockStationStatuses;
      setStationStatuses(finalStatuses);

      const dynamicRoutes = buildRoutes(finalStatuses, lookup);
      setRoutes(dynamicRoutes.length >= 2 ? dynamicRoutes : FALLBACK_ROUTES);
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

  const activeTrucks = routes.filter((r) => r.status === "active").length;
  const totalBikesMoved = routes.reduce((sum, r) => sum + r.bikes_moved, 0);
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
            {criticalCount} stations need bikes now · {stationStatuses.filter(s => s.risk_level === "surplus").length} stations overfull · {routes.length} routes suggested by model
          </p>
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
          <DataBadge isLive={dataIsLive}  />
        </div>
        <RebalancingMapWrapper
          stations={stationStatuses}
          routes={routes}
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
          {routes.map((route) => (
            <motion.div
              key={route.route_id}
              variants={fadeUp}
              className="rounded-2xl border border-white/[0.06] bg-[#0f1623] p-5"
            >
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-[13px] font-semibold text-white">
                  {TRUCK_NAMES[["route-alpha","route-beta","route-gamma"].indexOf(route.route_id)] ?? route.truck_id}
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
              Risk derived from live model predictions — sorted by urgency
            </p>
          </div>
          <DataBadge isLive={dataIsLive}  />
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
          {priorityStations.map((s, rank) => {
            const info = stationLookup[s.station_id];
            const name = info?.name ?? `Station #${rank + 1}`;
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
