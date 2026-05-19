"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { Search } from "lucide-react";
import MapWrapper from "@/components/map/MapWrapper";
import DataBadge from "@/components/shared/DataBadge";
import Tooltip from "@/components/shared/Tooltip";
import { getStations, getPredictions } from "@/data";
import { getDemandColor } from "@/lib/utils";
import { mockStations } from "@/data/mock/stations";
import type { Station, Prediction } from "@/types";
import type { StationType } from "@/data/mock/stations";

// ── station type meta ────────────────────────────────────────────────────────
const TYPE_META: Record<StationType, { label: string; dot: string }> = {
  transit_hub:  { label: "Transit hub",  dot: "#60a5fa" },
  university:   { label: "University",   dot: "#a78bfa" },
  tourist:      { label: "Tourist",      dot: "#34d399" },
  residential:  { label: "Residential",  dot: "#94a3b8" },
  medical:      { label: "Medical",      dot: "#f97316" },
  low_cap:      { label: "Low-cap",      dot: "#64748b" },
};

const ALL_TYPES = Object.keys(TYPE_META) as StationType[];

// ── demand tier ──────────────────────────────────────────────────────────────
function demandTier(d: number): { label: string; color: string } {
  if (d >= 5)  return { label: "Very high", color: "#ef4444" };
  if (d >= 3)  return { label: "High",      color: "#f97316" };
  if (d >= 1.5)return { label: "Moderate",  color: "#eab308" };
  if (d >= 0.5)return { label: "Low",       color: "#22c55e" };
  return            { label: "Very low",  color: "#3b82f6" };
}

const PANEL_H = 580; // px — map + list share same height

// ── component ────────────────────────────────────────────────────────────────
export default function StationsPage() {
  const [stations,    setStations]    = useState<Station[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [isLive,      setIsLive]      = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState("");
  const [activeType,  setActiveType]  = useState<StationType | "all">("all");

  useEffect(() => {
    Promise.all([getStations(), getPredictions()])
      .then(([sr, pr]) => {
        setStations(sr.data);
        setPredictions(pr.data);
        setIsLive(sr.isLive && pr.isLive);
      })
      .finally(() => setLoading(false));
  }, []);

  // Peak demand per station from predictions
  const peakByStation = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of predictions) {
      const d = p.peak_demand ?? p.predicted_demand;
      if (d > (map[p.station_id] ?? 0)) map[p.station_id] = d;
    }
    return map;
  }, [predictions]);

  // Station type lookup from mock data (available even in live mode for metadata)
  const typeById = useMemo(() => {
    const m: Record<string, StationType> = {};
    for (const s of mockStations) m[s.station_id] = s.type;
    return m;
  }, []);

  // Filtered + sorted list
  const rankedList = useMemo(() => {
    const q = search.toLowerCase();
    return [...stations]
      .filter(s => {
        const matchType = activeType === "all" || typeById[s.station_id] === activeType;
        const matchSearch = !q || s.station_name.toLowerCase().includes(q) || s.station_id.toLowerCase().includes(q);
        return matchType && matchSearch;
      })
      .sort((a, b) => (peakByStation[b.station_id] ?? 0) - (peakByStation[a.station_id] ?? 0));
  }, [stations, peakByStation, typeById, search, activeType]);

  // Predictions filtered to visible stations for map coloring
  const visiblePredictions = useMemo(() => {
    const ids = new Set(rankedList.map(s => s.station_id));
    // Collapse to one prediction per station (peak)
    const best: Record<string, Prediction> = {};
    for (const p of predictions) {
      if (!ids.has(p.station_id)) continue;
      const d = p.peak_demand ?? p.predicted_demand;
      if (d > (p.peak_demand ?? (best[p.station_id]?.predicted_demand ?? 0)))
        best[p.station_id] = { ...p, peak_demand: d };
    }
    return Object.values(best);
  }, [predictions, rankedList]);

  const highDemandCount = Object.values(peakByStation).filter(d => d >= 3).length;
  const avgCapacity = stations.length ? Math.round(stations.reduce((a, s) => a + s.capacity, 0) / stations.length) : 0;

  if (loading) return (
    <div className="p-5 md:p-7 flex items-center justify-center min-h-[50vh]">
      <div className="h-6 w-6 rounded-full border-2 border-blue-400/30 border-t-blue-400 animate-spin" />
    </div>
  );

  return (
    <div className="p-5 md:p-7 space-y-4">

      {/* Header */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <h1 className="text-[20px] font-semibold text-white tracking-tight">Stations</h1>
            <DataBadge isLive={isLive} />
          </div>
          <p className="text-[12px] text-slate-500">
            {stations.length} stations · avg {avgCapacity} docks · {highDemandCount} high demand right now
          </p>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search station…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 pr-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.07] text-[12px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500/40 w-48 transition-colors"
          />
        </div>
      </motion.div>

      {/* Type filter pills */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}
        className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setActiveType("all")}
          className={`px-3 py-1 rounded-full text-[11px] font-medium border transition-all ${
            activeType === "all"
              ? "bg-blue-500/20 border-blue-500/30 text-blue-300"
              : "bg-white/[0.03] border-white/[0.07] text-slate-500 hover:text-slate-300"
          }`}>
          All ({stations.length})
        </button>
        {ALL_TYPES.map(type => {
          const count = stations.filter(s => typeById[s.station_id] === type).length;
          if (count === 0) return null;
          return (
            <button key={type}
              onClick={() => setActiveType(activeType === type ? "all" : type)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium border transition-all ${
                activeType === type
                  ? "bg-white/[0.08] border-white/[0.15] text-slate-200"
                  : "bg-white/[0.02] border-white/[0.06] text-slate-500 hover:text-slate-300"
              }`}>
              <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: TYPE_META[type].dot }} />
              {TYPE_META[type].label} ({count})
            </button>
          );
        })}
      </motion.div>

      {/* ── Main split panel ──────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="grid grid-cols-[3fr_2fr] gap-3"
        style={{ height: PANEL_H }}
      >
        {/* Left — map */}
        <div className="rounded-xl overflow-hidden border border-white/[0.05]">
          <MapWrapper
            stations={rankedList}
            predictions={visiblePredictions}
            height={`${PANEL_H}px`}
          />
        </div>

        {/* Right — ranked list */}
        <div className="rounded-xl bg-bg-card border border-white/[0.05] flex flex-col overflow-hidden">

          {/* List header */}
          <div className="px-4 py-3 border-b border-white/[0.05] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1.5">
              <p className="text-[12px] font-semibold text-white">
                {rankedList.length} station{rankedList.length !== 1 ? "s" : ""}
                {activeType !== "all" ? ` · ${TYPE_META[activeType].label}` : ""}
              </p>
              <Tooltip content="Sorted by peak predicted demand (trips/hr) across the next 24 h. Dot colour matches the map — click any station on the map to see details." />
            </div>
            <p className="text-[10px] text-slate-600 uppercase tracking-widest">by demand ↓</p>
          </div>

          {/* Column labels */}
          <div className="grid grid-cols-[1fr_70px_44px] gap-2 px-4 py-1.5 text-[9px] font-semibold uppercase tracking-widest text-slate-600 border-b border-white/[0.03] shrink-0">
            <span>Station</span>
            <span>Peak demand</span>
            <span className="text-right">Cap.</span>
          </div>

          {/* Rows */}
          <div className="overflow-y-auto flex-1 divide-y divide-white/[0.03]">
            {rankedList.map((s, i) => {
              const peak  = peakByStation[s.station_id] ?? 0;
              const tier  = demandTier(peak);
              const type  = typeById[s.station_id];
              const typeDot = type ? TYPE_META[type].dot : "#64748b";
              const maxPeak = Math.max(...Object.values(peakByStation), 1);

              return (
                <div key={s.station_id}
                  className="grid grid-cols-[1fr_70px_44px] gap-2 items-center px-4 py-2.5 hover:bg-white/[0.025] transition-colors group">

                  {/* Name + type dot */}
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: typeDot }} />
                    <div className="min-w-0">
                      <p className="text-[11px] text-slate-300 truncate leading-tight" title={s.station_name}>
                        {s.station_name}
                      </p>
                    </div>
                  </div>

                  {/* Demand bar + value */}
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                      <motion.div className="h-full rounded-full"
                        style={{ backgroundColor: tier.color, opacity: 0.7 }}
                        initial={{ width: 0 }}
                        animate={{ width: `${(peak / maxPeak) * 100}%` }}
                        transition={{ duration: 0.5, delay: i * 0.01, ease: "easeOut" as const }} />
                    </div>
                    <span className="text-[10px] tabular-nums shrink-0" style={{ color: tier.color }}>
                      {peak.toFixed(1)}
                    </span>
                  </div>

                  {/* Capacity */}
                  <span className="text-[10px] text-slate-600 tabular-nums text-right">{s.capacity}</span>
                </div>
              );
            })}

            {rankedList.length === 0 && (
              <div className="flex items-center justify-center h-24 text-[12px] text-slate-600">
                No stations match your filter
              </div>
            )}
          </div>

          {/* Footer legend */}
          <div className="px-4 py-2.5 border-t border-white/[0.05] shrink-0">
            <div className="flex items-center gap-3 flex-wrap">
              {[
                { color: "#ef4444", label: "5+" },
                { color: "#f97316", label: "3–5" },
                { color: "#eab308", label: "1.5–3" },
                { color: "#22c55e", label: "0.5–1.5" },
                { color: "#3b82f6", label: "<0.5" },
              ].map(({ color, label }) => (
                <div key={label} className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-[9px] text-slate-600">{label} trips/hr</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </motion.div>

    </div>
  );
}
