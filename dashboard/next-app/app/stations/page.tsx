"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import MapWrapper from "@/components/map/MapWrapper";
import AnimatedCounter from "@/components/shared/AnimatedCounter";
import DataBadge from "@/components/shared/DataBadge";
import { getStations, getPredictions, getStationMapping } from "@/data";
import { formatNumber } from "@/lib/utils";
import type { Station, Prediction } from "@/types";

interface StationsData {
  stations: Station[];
  predictions: Prediction[];
  isLive: boolean;
}

export default function StationsPage() {
  const [data, setData] = useState<StationsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getStations(),
      getPredictions(),
      getStationMapping(),
    ]).then(([stationsResult, predictionsResult, mapping]) => {
      // Translate A32xxx prediction IDs → GBFS UUIDs so the map can join them to stations
      const a32ToGbfs: Record<string, string> = {};
      for (const row of mapping) {
        if (row.gbfs_station_id) a32ToGbfs[row.start_station_id] = row.gbfs_station_id;
      }
      // Translate IDs and collapse to one row per station (peak demand)
      const peakByStation = new Map<string, Prediction>();
      for (const p of predictionsResult.data) {
        const sid = a32ToGbfs[p.station_id] ?? p.station_id;
        const existing = peakByStation.get(sid);
        const thisDemand = p.peak_demand ?? p.predicted_demand;
        const existingDemand = existing ? (existing.peak_demand ?? existing.predicted_demand) : -1;
        if (!existing || thisDemand > existingDemand) {
          peakByStation.set(sid, { ...p, station_id: sid, peak_demand: thisDemand });
        }
      }
      const translatedPredictions = Array.from(peakByStation.values());
      setData({ stations: stationsResult.data, predictions: translatedPredictions, isLive: stationsResult.isLive && predictionsResult.isLive });
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

  const { stations, predictions, isLive } = data;

  const avgCapacity = stations.reduce((sum, s) => sum + s.capacity, 0) / stations.length;

  const stationMaxDemand = new Map<string, number>();
  for (const p of predictions) {
    const d = p.peak_demand ?? p.predicted_demand;
    const cur = stationMaxDemand.get(p.station_id) ?? 0;
    if (d > cur) stationMaxDemand.set(p.station_id, d);
  }
  const highDemandCount = Array.from(stationMaxDemand.values()).filter((d) => d >= 3).length;

  return (
    <div className="p-5 md:p-7 space-y-5">
      {/* Header with inline stats */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] font-semibold text-white tracking-tight">Stations</h1>
            <DataBadge isLive={isLive} />
          </div>
          <p className="text-[13px] text-slate-500 mt-0.5">
            {stations.length} stations across Boston · Avg {formatNumber(avgCapacity, 0)} docks · {highDemandCount} high demand
          </p>
        </div>
      </motion.div>

      {/* Legend */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="flex items-center gap-4 text-[11px] text-slate-500 flex-wrap"
      >
        <span className="font-medium text-slate-400">Predicted demand:</span>
        {[
          { color: "#ef4444", label: "Very high (5+ trips/hr) — stock up now" },
          { color: "#f97316", label: "High (3–5)" },
          { color: "#eab308", label: "Moderate (1–3)" },
          { color: "#22c55e", label: "Low (0.5–1)" },
          { color: "#3b82f6", label: "Very low (<0.5)" },
        ].map(({ color, label }) => (
          <div key={color} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
            <span>{label}</span>
          </div>
        ))}
      </motion.div>

      {/* Map — full prominence */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="rounded-xl overflow-hidden"
      >
        <MapWrapper stations={stations} predictions={predictions} height="calc(100vh - 160px)" />
      </motion.div>
    </div>
  );
}
