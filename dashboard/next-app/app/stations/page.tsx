"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import MapWrapper from "@/components/map/MapWrapper";
import AnimatedCounter from "@/components/shared/AnimatedCounter";
import { getStations, getPredictions } from "@/data";
import { formatNumber } from "@/lib/utils";
import type { Station, Prediction } from "@/types";

interface StationsData {
  stations: Station[];
  predictions: Prediction[];
}

export default function StationsPage() {
  const [data, setData] = useState<StationsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getStations(),
      getPredictions(),
    ]).then(([stations, predictions]) => {
      setData({ stations, predictions });
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

  const { stations, predictions } = data;

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
          <h1 className="text-[22px] font-semibold text-white tracking-tight">Stations</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">
            {stations.length} stations across Boston · Avg {formatNumber(avgCapacity, 0)} docks · {highDemandCount} high demand
          </p>
        </div>
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
