"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { motion } from "framer-motion";
import { Search, AlertTriangle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import ForecastLineChart from "@/components/charts/ForecastLineChart";
import DataBadge from "@/components/shared/DataBadge";
import Tooltip from "@/components/shared/Tooltip";
import { getStations, getPredictions, getStationMapping } from "@/data";
import { formatHour, formatNumber, getDemandColor } from "@/lib/utils";
import { mockStations } from "@/data/mock/stations";
import type { Station, Prediction } from "@/types";
import type { StationType } from "@/data/mock/stations";

const fade = {
  hidden: { opacity: 0, y: 8 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.06, duration: 0.3 } }),
};

const TYPE_LABELS: Record<StationType, string> = {
  transit_hub: "Transit hub", university: "University", tourist: "Tourist",
  residential: "Residential", medical: "Medical", low_cap: "Low-cap",
};

function actionLabel(d: number): string {
  if (d >= 5)  return "Stock up now";
  if (d >= 2)  return "Monitor";
  return "—";
}

export default function ForecastsPage() {
  return <Suspense><ForecastsInner /></Suspense>;
}

function ForecastsInner() {
  const searchParams = useSearchParams();
  const focusIds = useMemo(() => {
    const raw = searchParams.get("focus");
    return raw ? raw.split(",").filter(Boolean) : [];
  }, [searchParams]);

  const [stations,        setStations]        = useState<Station[]>([]);
  const [selectedId,      setSelectedId]      = useState("");
  const [predictions,     setPredictions]     = useState<Prediction[]>([]);
  const [stationMapping,  setStationMapping]  = useState<Record<string, string>>({});
  const [isLive,          setIsLive]          = useState(false);
  const [loading,         setLoading]         = useState(true);
  const [search,          setSearch]          = useState("");

  // Station type lookup
  const typeById = useMemo(() => {
    const m: Record<string, StationType> = {};
    for (const s of mockStations) m[s.station_id] = s.type;
    return m;
  }, []);

  useEffect(() => {
    Promise.all([getStations(), getStationMapping()])
      .then(([{ data }, mapping]) => {
        setStations(data);
        // Pre-select first focus station if coming from overview CTA, else first station
        const firstFocus = focusIds.length > 0 ? data.find(s => focusIds.includes(s.station_id)) : null;
        if (firstFocus) setSelectedId(firstFocus.station_id);
        else if (data.length > 0) setSelectedId(data[0].station_id);
        const lookup: Record<string, string> = {};
        for (const row of mapping) {
          if (row.gbfs_station_id) lookup[row.gbfs_station_id] = row.start_station_id;
        }
        setStationMapping(lookup);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const id = stationMapping[selectedId] || selectedId;
    getPredictions(id).then(({ data, isLive }) => { setPredictions(data); setIsLive(isLive); });
  }, [selectedId, stationMapping]);

  const selectedStation = useMemo(() => stations.find(s => s.station_id === selectedId), [stations, selectedId]);

  const peakDemand = useMemo(() => predictions.reduce((max, p) => Math.max(max, p.predicted_demand), 0), [predictions]);
  const avgDemand  = useMemo(() => predictions.length > 0 ? predictions.reduce((s, p) => s + p.predicted_demand, 0) / predictions.length : 0, [predictions]);
  const peakHour   = useMemo(() => predictions.reduce((best, p) => p.predicted_demand > best.predicted_demand ? p : best, predictions[0]), [predictions]);

  const filteredStations = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = stations.filter(s => !q || s.station_name.toLowerCase().includes(q));
    if (focusIds.length === 0) return filtered;
    // Pin focus stations to the top
    return [
      ...filtered.filter(s => focusIds.includes(s.station_id)),
      ...filtered.filter(s => !focusIds.includes(s.station_id)),
    ];
  }, [stations, search, focusIds]);

  if (loading) return (
    <div className="p-5 md:p-7 flex items-center justify-center min-h-[50vh]">
      <div className="h-6 w-6 rounded-full border-2 border-blue-400/30 border-t-blue-400 animate-spin" />
    </div>
  );

  const stationType = selectedId ? typeById[selectedId] : undefined;

  return (
    <div className="p-5 md:p-7 space-y-4">

      {/* Header */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <h1 className="text-[20px] font-semibold text-white tracking-tight">Forecasts</h1>
            <DataBadge isLive={isLive} />
          </div>
          <p className="text-[12px] text-slate-500">24-hour demand predictions per station · select to drill down</p>
        </div>

        {/* Inline search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500 pointer-events-none" />
          <input type="text" placeholder="Search station…" value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 pr-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.07] text-[12px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500/40 w-52 transition-colors" />
        </div>
      </motion.div>

      {/* Focus banner — shown when arriving from overview CTA */}
      {focusIds.length > 0 && (
        <motion.div custom={0} variants={fade} initial="hidden" animate="visible"
          className="flex items-center gap-2 rounded-xl bg-amber-500/[0.06] border border-amber-500/15 px-4 py-2.5">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <p className="text-[12px] text-amber-300/90">
            <span className="font-semibold">{focusIds.length} station{focusIds.length > 1 ? "s" : ""} trending low</span>
            {" "}— pinned to the top. Check each one to plan restocking before demand peaks.
          </p>
        </motion.div>
      )}

      {/* Station picker — horizontal scrollable pills */}
      <motion.div custom={1} variants={fade} initial="hidden" animate="visible"
        className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {filteredStations.map(s => {
          const isSelected  = s.station_id === selectedId;
          const isFocus     = focusIds.includes(s.station_id);
          return (
            <button key={s.station_id} onClick={() => setSelectedId(s.station_id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-medium whitespace-nowrap shrink-0 transition-all ${
                isSelected
                  ? "bg-blue-500/20 border-blue-500/30 text-blue-200"
                  : isFocus
                  ? "bg-amber-500/[0.08] border-amber-500/25 text-amber-300/90 hover:border-amber-500/40"
                  : "bg-white/[0.02] border-white/[0.06] text-slate-500 hover:text-slate-300 hover:border-white/[0.1]"
              }`}>
              {isFocus && !isSelected && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />}
              {s.station_name.split(" - ")[0].split(" / ")[0].split(" at ")[0].substring(0, 22)}
            </button>
          );
        })}
      </motion.div>

      {/* Verdict */}
      {predictions.length > 0 && (
        <motion.div custom={2} variants={fade} initial="hidden" animate="visible"
          className="flex items-center gap-3 rounded-xl bg-white/[0.03] border border-white/[0.07] px-4 py-2.5">
          <span className={`h-2 w-2 rounded-full shrink-0 ${peakDemand >= 5 ? "bg-amber-400 ring-2 ring-amber-400/20" : peakDemand >= 2 ? "bg-blue-400" : "bg-emerald-400"}`} />
          <p className="text-[13px] font-medium text-slate-200">
            {peakDemand >= 5
              ? `High demand — stock up before ${peakHour ? formatHour(peakHour.forecast_hour) : "peak"} · recommend ${Math.ceil(peakDemand * 1.5)} bikes on dock`
              : peakDemand >= 2
              ? `Moderate demand — monitor and top up if below 40% capacity before peak`
              : `Low demand — no immediate action needed for this station`}
          </p>
        </motion.div>
      )}

      {/* Chart + station summary side by side */}
      <motion.div custom={3} variants={fade} initial="hidden" animate="visible"
        className="grid grid-cols-[1fr_220px] gap-3">

        {/* Chart */}
        <div className="rounded-xl bg-bg-card border border-white/[0.05] p-4 min-h-[280px]">
          <ForecastLineChart
            data={predictions}
            stationName={selectedStation?.station_name ?? ""}
          />
        </div>

        {/* Station summary — clean rows, no icon circles */}
        <div className="rounded-xl bg-bg-card border border-white/[0.05] p-4 flex flex-col gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Station</p>
            <p className="text-[12px] font-semibold text-white leading-snug">{selectedStation?.station_name}</p>
            {stationType && (
              <p className="text-[10px] text-slate-500 mt-0.5">{TYPE_LABELS[stationType]}</p>
            )}
          </div>

          <div className="border-t border-white/[0.05] pt-3 space-y-2.5">
            {[
              { label: "Capacity",     value: `${selectedStation?.capacity ?? "—"} docks`,
                tip: "Total number of dock slots at this station." },
              { label: "Peak demand",  value: `${formatNumber(peakDemand, 1)} trips/hr`,
                tip: "Highest predicted pickup rate in the 24-hour forecast window.",
                highlight: peakDemand >= 3 },
              { label: "Avg demand",   value: `${formatNumber(avgDemand, 1)} trips/hr`,
                tip: "Mean pickup rate across all 24 forecast hours. Compare with peak to understand burstiness." },
              { label: "Rec. stock",   value: `${Math.ceil(peakDemand * 1.5)} bikes`,
                tip: "Peak demand × 1.5 safety buffer — covers 30-min truck delay at peak.", highlight: true },
            ].map(({ label, value, tip, highlight }) => (
              <div key={label} className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-500">{label}</span>
                  <Tooltip content={tip} />
                </div>
                <span className={`text-[12px] font-semibold font-mono ${highlight ? "text-white" : "text-slate-400"}`}>{value}</span>
              </div>
            ))}
          </div>

          {/* Kiosk indicator */}
          {selectedStation && (
            <div className="border-t border-white/[0.05] pt-2.5">
              <div className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${(selectedStation as any).has_kiosk ? "bg-emerald-400" : "bg-slate-600"}`} />
                <span className="text-[10px] text-slate-500">{(selectedStation as any).has_kiosk ? "Has kiosk" : "No kiosk"}</span>
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {/* Hourly table — 3 clean columns only */}
      <motion.div custom={4} variants={fade} initial="hidden" animate="visible"
        className="rounded-xl bg-bg-card border border-white/[0.05] overflow-hidden">
        <div className="px-4 py-3 border-b border-white/[0.05] flex items-center justify-between">
          <p className="text-[12px] font-semibold text-white">Hourly breakdown</p>
          <p className="text-[10px] text-slate-600">trips/hr · 24 hours</p>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-[80px_1fr_90px_80px] gap-3 px-4 py-2 text-[9px] font-semibold uppercase tracking-widest text-slate-600 border-b border-white/[0.03]">
          <span>Time</span>
          <span>Demand</span>
          <span className="text-right">Trips/hr</span>
          <span className="text-right">Action</span>
        </div>

        <div className="divide-y divide-white/[0.03] max-h-[400px] overflow-y-auto">
          {predictions.map((p, i) => {
            const d       = p.predicted_demand;
            const barPct  = peakDemand > 0 ? (d / peakDemand) * 100 : 0;
            const color   = getDemandColor(d);
            const action  = actionLabel(d);
            const isRush  = (() => { const h = new Date(p.forecast_hour).getHours(); return (h >= 7 && h <= 9) || (h >= 16 && h <= 19); })();

            return (
              <motion.div key={i} custom={i} variants={fade} initial="hidden" animate="visible"
                className={`grid grid-cols-[80px_1fr_90px_80px] gap-3 items-center px-4 py-2 hover:bg-white/[0.02] transition-colors ${isRush ? "bg-blue-500/[0.03]" : ""}`}>
                <span className="text-[11px] text-slate-400 font-mono">{formatHour(p.forecast_hour)}</span>
                <div className="h-1 rounded-full bg-white/[0.05] overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${barPct}%`, backgroundColor: color, opacity: 0.7 }} />
                </div>
                <span className="text-[11px] font-mono tabular-nums text-right" style={{ color }}>{formatNumber(d, 2)}</span>
                <span className={`text-[10px] text-right ${action === "Stock up now" ? "text-amber-400 font-medium" : action === "Monitor" ? "text-slate-400" : "text-slate-600"}`}>
                  {action}
                </span>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

    </div>
  );
}
