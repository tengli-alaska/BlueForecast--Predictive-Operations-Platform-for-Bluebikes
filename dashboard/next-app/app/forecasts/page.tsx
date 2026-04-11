"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { MapPin, Clock, BarChart3, Crosshair, Layers } from "lucide-react";
import ForecastLineChart from "@/components/charts/ForecastLineChart";
import ScrollReveal from "@/components/shared/ScrollReveal";
import TextReveal from "@/components/shared/TextReveal";
import { getStations, getPredictions } from "@/data";
import { formatHour, formatNumber, getDemandColor } from "@/lib/utils";
import type { Station, Prediction } from "@/types";

const tableRowVariants = {
  hidden: { opacity: 0, x: -10 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { duration: 0.3, ease: "easeOut" as const, delay: i * 0.03 },
  }),
};

export default function ForecastsPage() {
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStationId, setSelectedStationId] = useState("");
  const [predictions, setPredictions] = useState<Prediction[]>([]);

  // Load stations on mount
  useEffect(() => {
    getStations().then(({ data }) => {
      setStations(data);
      if (data.length > 0) {
        setSelectedStationId(data[0].station_id);
      }
    }).finally(() => setLoading(false));
  }, []);

  // Load predictions when station changes
  useEffect(() => {
    if (!selectedStationId) return;
    getPredictions(selectedStationId).then(({ data }) => setPredictions(data));
  }, [selectedStationId]);

  const selectedStation = useMemo(
    () => stations.find((s) => s.station_id === selectedStationId),
    [stations, selectedStationId]
  );

  const peakDemand = useMemo(
    () =>
      predictions.reduce(
        (max, p) => (p.predicted_demand > max ? p.predicted_demand : max),
        0
      ),
    [predictions]
  );

  const avgDemand = useMemo(
    () =>
      predictions.length > 0
        ? predictions.reduce((sum, p) => sum + p.predicted_demand, 0) / predictions.length
        : 0,
    [predictions]
  );

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

  return (
    <div className="min-h-screen bg-bg-primary bg-grid p-6 md:p-8 space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl heading-premium font-bold text-text-primary">
          <TextReveal text="Demand Forecasts" />
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          <TextReveal
            text="24-hour demand predictions by station. Select a station to view its forecast."
            delay={0.15}
          />
        </p>
      </div>

      {/* Station Selector */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2 }}
        className="flex flex-col gap-2"
      >
        <label
          htmlFor="station-select"
          className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-secondary/60"
        >
          Select Station
        </label>
        <select
          id="station-select"
          value={selectedStationId}
          onChange={(e) => setSelectedStationId(e.target.value)}
          className="w-full sm:w-96 rounded-xl backdrop-blur-xl bg-white/[0.05] border border-white/[0.1] px-4 py-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-blue/50 focus:border-accent-blue/50 appearance-none cursor-pointer transition-all duration-200 hover:bg-white/[0.07]"
        >
          {stations.map((s) => (
            <option key={s.station_id} value={s.station_id} className="bg-bg-primary text-text-primary">
              {s.station_name}
            </option>
          ))}
        </select>
      </motion.div>

      {/* Section Label: Forecast Chart */}
      <ScrollReveal>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-secondary/60">
          Forecast Chart
        </p>
      </ScrollReveal>

      {/* Main Chart + Station Info */}
      <ScrollReveal>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Forecast Chart */}
          <div className="lg:col-span-2">
            <ForecastLineChart
              data={predictions}
              stationName={selectedStation?.station_name}
            />
          </div>

          {/* Station Info Sidebar */}
          <motion.div
            key={selectedStationId}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3 }}
            className="relative overflow-hidden rounded-xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06] p-6 space-y-5 h-fit shadow-2xl shadow-black/20"
          >
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-px"
              style={{ background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)" }}
            />

            {/* Section Label */}
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-secondary/60">
              Station Details
            </p>

            <div className="space-y-3">
              <div className="flex items-start gap-3 bg-white/[0.03] rounded-lg p-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/20 shadow-md shadow-blue-500/20 shrink-0">
                  <MapPin className="h-4 w-4 text-accent-blue" />
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-text-secondary">Name</p>
                  <p className="text-sm text-text-primary">{selectedStation?.station_name}</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-white/[0.03] rounded-lg p-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500/20 shadow-md shadow-green-500/20 shrink-0">
                  <BarChart3 className="h-4 w-4 text-accent-green" />
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-text-secondary">Capacity</p>
                  <p className="text-sm text-text-primary">{selectedStation?.capacity} docks</p>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-white/[0.03] rounded-lg p-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-500/20 shadow-md shadow-purple-500/20 shrink-0">
                  <Crosshair className="h-4 w-4 text-accent-purple" />
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-text-secondary">Coordinates</p>
                  <p className="text-sm text-text-primary">
                    {selectedStation?.lat.toFixed(4)}, {selectedStation?.lon.toFixed(4)}
                  </p>
                </div>
              </div>
            </div>

            <div className="border-t border-white/[0.06] pt-4 space-y-3">
              <div className="flex justify-between items-center bg-white/[0.03] rounded-lg px-3 py-2">
                <span className="text-xs text-text-secondary">Peak Demand</span>
                <span className="text-sm font-semibold text-text-primary">
                  {formatNumber(peakDemand, 1)} trips/hr
                </span>
              </div>
              <div className="flex justify-between items-center bg-white/[0.03] rounded-lg px-3 py-2">
                <span className="text-xs text-text-secondary">Avg Demand</span>
                <span className="text-sm font-semibold text-text-primary">
                  {formatNumber(avgDemand, 1)} trips/hr
                </span>
              </div>
              <div className="flex justify-between items-center bg-white/[0.03] rounded-lg px-3 py-2">
                <span className="text-xs text-text-secondary">Recommended Stock</span>
                <span className="text-sm font-semibold text-text-primary">
                  {Math.ceil(peakDemand * 1.5)} bikes at peak
                </span>
              </div>
              <div className="rounded-lg px-3 py-2 bg-blue-500/[0.07] border border-blue-500/10">
                <p className="text-[11px] text-blue-300/80 leading-relaxed">
                  {peakDemand >= 5
                    ? "⚠ High demand expected — ensure full stock before peak hour"
                    : peakDemand >= 2
                    ? "Moderate demand — monitor and top up if below 40% capacity"
                    : "Low demand — no immediate action needed"}
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </ScrollReveal>

      {/* Section Label: Hourly Breakdown */}
      <ScrollReveal>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-secondary/60">
          Hourly Breakdown
        </p>
      </ScrollReveal>

      {/* Hourly Predictions Table */}
      <ScrollReveal>
        <div
          className="relative overflow-hidden rounded-2xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06] p-6 shadow-2xl shadow-black/20"
        >
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{ background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)" }}
          />
          <h3 className="text-base font-semibold text-text-primary mb-4">
            Hourly Predictions
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white/[0.04]">
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider rounded-tl-lg sticky top-0">
                    Hour
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider sticky top-0">
                    Forecast Time
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold text-text-secondary uppercase tracking-wider sticky top-0">
                    Predicted Demand
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold text-text-secondary uppercase tracking-wider sticky top-0">
                    Level
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold text-text-secondary uppercase tracking-wider rounded-tr-lg sticky top-0">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {predictions.map((p, i) => (
                  <motion.tr
                    key={`${selectedStationId}-${i}`}
                    custom={i}
                    variants={tableRowVariants}
                    initial="hidden"
                    animate="visible"
                    className="group hover:bg-white/[0.04] transition-colors relative"
                  >
                    <td className="px-4 py-3 text-text-primary font-medium relative">
                      <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent-blue/0 group-hover:bg-accent-blue transition-colors rounded-full" />
                      {String(i + 1).padStart(2, "0")}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {formatHour(p.forecast_hour)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-medium">
                      <span style={{ color: getDemandColor(p.predicted_demand) }}>
                        {formatNumber(p.predicted_demand, 2)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-[11px] font-medium ${
                        p.predicted_demand >= 5 ? "text-red-400" :
                        p.predicted_demand >= 2 ? "text-amber-400" : "text-emerald-400"
                      }`}>
                        {p.predicted_demand >= 5 ? "High" : p.predicted_demand >= 2 ? "Moderate" : "Quiet"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-[11px] text-slate-500">
                      {p.predicted_demand >= 5 ? "Stock up" : p.predicted_demand >= 2 ? "Monitor" : "—"}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </ScrollReveal>
    </div>
  );
}
