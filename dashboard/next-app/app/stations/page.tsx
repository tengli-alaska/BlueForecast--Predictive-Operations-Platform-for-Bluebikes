"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import MapWrapper from "@/components/map/MapWrapper";
import AnimatedCounter from "@/components/shared/AnimatedCounter";
import DataBadge from "@/components/shared/DataBadge";
import { getStations, getPredictions } from "@/data";
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
    ]).then(([stationsResult, predictionsResult]) => {
      setData({ stations: stationsResult.data, predictions: predictionsResult.data, isLive: stationsResult.isLive && predictionsResult.isLive });
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
    const cur = stationMaxDemand.get(p.station_id) ?? 0;
    if (p.predicted_demand > cur) stationMaxDemand.set(p.station_id, p.predicted_demand);
  }
  const highDemandCount = Array.from(stationMaxDemand.values()).filter((d) => d >= 5).length;

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
