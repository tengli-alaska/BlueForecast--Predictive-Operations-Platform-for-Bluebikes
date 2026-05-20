"use client";

import React from "react";
import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { useEffect, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, Marker, useMap } from "react-leaflet";
import type { StationStatus, RebalancingRoute } from "@/types";
import { BOSTON_CENTER } from "@/lib/constants";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl: "", iconUrl: "", shadowUrl: "" });

interface RebalancingMapProps {
  stations: StationStatus[];
  routes: RebalancingRoute[];
  stationNames: Record<string, { name: string; lat: number; lon: number; capacity: number }>;
  height?: string;
}

const RISK_COLORS: Record<string, string> = {
  critical: "#ef4444",
  low: "#f59e0b",
  moderate: "#10b981",
  surplus: "#3b82f6",
};

const ROUTE_COLORS: Record<string, string> = {
  "route-alpha":  "#60a5fa",
  "route-beta":   "#4ade80",
  "route-gamma":  "#c084fc",
  "RB-URGENT-001": "#60a5fa",  // Truck Alpha — blue
  "RB-ACTIVE-002": "#4ade80",  // Truck Beta  — green
  "RB-PLANNED-003": "#c084fc", // Truck Gamma — purple
};

function clampRadius(capacity: number): number {
  return Math.min(10, Math.max(4, capacity / 3));
}

function fillBarColor(pct: number): string {
  if (pct < 15 || pct > 90) return "#ef4444";
  if (pct < 30 || pct > 80) return "#f59e0b";
  return "#10b981";
}

function createTruckIcon(color: string) {
  return L.divIcon({
    className: "",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    html: `<div style="
      width:14px;height:14px;border-radius:50%;
      background:${color};
      box-shadow:0 0 0 3px ${color}40, 0 0 10px ${color}60;
      border:2px solid rgba(255,255,255,0.6);
    "></div>`,
  });
}

function createStopIcon(action: "pickup" | "dropoff", order: number) {
  const bg = action === "pickup" ? "#3b82f6" : "#22c55e";
  return L.divIcon({
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<div style="
      width:22px;height:22px;display:flex;align-items:center;justify-content:center;
      background:${bg};border-radius:50%;border:2px solid rgba(255,255,255,0.4);
      color:white;font-size:10px;font-weight:700;font-family:system-ui;
    ">${order}</div>`,
  });
}

/* Route progress indicator — advances one segment every 4 seconds */
function AnimatedTruck({ route, color }: { route: RebalancingRoute; color: string }) {
  const stops = [...route.stops].sort((a, b) => a.order - b.order);
  const positions: [number, number][] = stops.map((s) => [s.lat, s.lon]);
  const [segIndex, setSegIndex] = useState(0);
  const [t, setT] = useState(0);

  useEffect(() => {
    if (route.status !== "active" || positions.length < 2) return;
    // Smooth interpolation within each segment (60 steps × ~67ms = ~4s per segment)
    let step = 0;
    const STEPS = 60;
    const interval = setInterval(() => {
      step = (step + 1);
      const totalSteps = (positions.length - 1) * STEPS;
      const overall = step % totalSteps;
      setSegIndex(Math.min(Math.floor(overall / STEPS), positions.length - 2));
      setT((overall % STEPS) / STEPS);
    }, 67);
    return () => clearInterval(interval);
  }, [route.status, positions.length]);

  if (route.status !== "active" || positions.length < 2) return null;

  const lat = positions[segIndex][0] + t * (positions[segIndex + 1][0] - positions[segIndex][0]);
  const lng = positions[segIndex][1] + t * (positions[segIndex + 1][1] - positions[segIndex][1]);

  return (
    <Marker
      position={[lat, lng]}
      icon={createTruckIcon(color)}
      zIndexOffset={1000}
    />
  );
}

function Legend() {
  return (
    <div style={{
      position: "absolute", bottom: 16, right: 16, zIndex: 1000,
      backgroundColor: "rgba(10,14,23,0.92)", backdropFilter: "blur(8px)",
      border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px",
      padding: "10px 14px", color: "#94a3b8", fontSize: "11px", lineHeight: 1.9,
    }}>
      <div style={{ fontWeight: 700, fontSize: 9, letterSpacing: "0.08em", color: "#475569", marginBottom: 4, textTransform: "uppercase" }}>Station fill</div>
      {(["critical","low","moderate","surplus"] as const).map((level) => (
        <div key={level} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: RISK_COLORS[level], flexShrink: 0 }} />
          <span style={{ textTransform: "capitalize", fontSize: 10 }}>{level}</span>
        </div>
      ))}
      <div style={{ fontWeight: 700, fontSize: 9, letterSpacing: "0.08em", color: "#475569", marginTop: 10, marginBottom: 4, textTransform: "uppercase" }}>Model-suggested routes</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 16, height: 3, backgroundColor: "#60a5fa", display: "inline-block", borderRadius: 2, boxShadow: "0 0 6px #60a5fa80" }} />
        <span style={{ fontSize: 10 }}>Priority route</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 16, height: 2, backgroundColor: "#4ade80", display: "inline-block", borderRadius: 2 }} />
        <span style={{ fontSize: 10 }}>Active route</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 16, height: 1, backgroundColor: "#c084fc", display: "inline-block", borderRadius: 1, borderTop: "1px dashed #c084fc" }} />
        <span style={{ fontSize: 10 }}>Planned route</span>
      </div>
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.05)", fontSize: 9, color: "#334155", lineHeight: 1.5 }}>
        Routes are model-generated.<br/>Review before dispatching.
      </div>
    </div>
  );
}

/** Priority route = the active route whose stops include the most critical stations
 *  (lowest fill%). Derived purely from station status data — no truck tracking needed. */
function getPriorityRouteId(routes: RebalancingRoute[], stations: StationStatus[]): string | null {
  const criticalIds = new Set(
    stations.filter(s => s.risk_level === "critical" && s.fill_pct <= 10).map(s => s.station_id)
  );

  let mostCritical = -1;
  let priorityId: string | null = null;

  for (const route of routes) {
    if (route.status !== "active") continue;
    const criticalCount = route.stops.filter(s => criticalIds.has(s.station_id)).length;
    if (criticalCount > mostCritical) {
      mostCritical = criticalCount;
      priorityId = route.route_id;
    }
  }
  return priorityId;
}

export default function RebalancingMap({
  stations,
  routes,
  stationNames,
  height = "520px",
}: RebalancingMapProps) {
  const priorityRouteId = getPriorityRouteId(routes, stations);
  return (
    <div style={{ position: "relative", width: "100%", height }}>
      <MapContainer
        center={[BOSTON_CENTER.lat, BOSTON_CENTER.lng]}
        zoom={13}
        style={{ width: "100%", height: "100%", borderRadius: "12px" }}
        zoomControl={true}
        attributionControl={false}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; CARTO'
        />

        {/* Station markers */}
        {stations.map((s) => {
          const info = stationNames[s.station_id];
          if (!info) return null;
          const color = RISK_COLORS[s.risk_level] || "#94a3b8";
          return (
            <CircleMarker
              key={s.station_id}
              center={[info.lat, info.lon]}
              radius={clampRadius(info.capacity)}
              pathOptions={{ fillColor: color, fillOpacity: 0.6, color: "transparent", weight: 0 }}
            >
              <Popup closeButton={false} className="station-popup">
                <div style={{ backgroundColor: "#111827", color: "#e2e8f0", padding: "10px 14px", borderRadius: 8, minWidth: 180, fontSize: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{info.name}</div>
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b", marginBottom: 3 }}>
                      <span>Fill</span><span>{s.fill_pct}%</span>
                    </div>
                    <div style={{ width: "100%", height: 4, borderRadius: 2, backgroundColor: "#1e293b" }}>
                      <div style={{ width: `${Math.min(100, s.fill_pct)}%`, height: "100%", borderRadius: 2, backgroundColor: fillBarColor(s.fill_pct) }} />
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>
                    {s.current_bikes}/{info.capacity} bikes · <span style={{ color, textTransform: "capitalize" }}>{s.risk_level}</span>
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}

        {/* Route polylines — priority route gets glow treatment */}
        {routes.map((route) => {
          const color     = ROUTE_COLORS[route.route_id] || "#94a3b8";
          const isPriority = route.route_id === priorityRouteId;
          const isPlanned  = route.status === "planned";
          const positions: [number, number][] = [...route.stops]
            .sort((a, b) => a.order - b.order)
            .map((stop) => [stop.lat, stop.lon]);

          return (
            <React.Fragment key={route.route_id}>
              {/* Glow layer for priority route */}
              {isPriority && (
                <Polyline
                  positions={positions}
                  pathOptions={{ color, weight: 14, opacity: 0.12, dashArray: undefined }}
                />
              )}
              <Polyline
                positions={positions}
                pathOptions={{
                  color,
                  weight: isPriority ? 5 : isPlanned ? 1.5 : 2.5,
                  opacity: isPriority ? 0.9 : isPlanned ? 0.3 : 0.6,
                  dashArray: isPlanned ? "6 8" : undefined,
                }}
              />
            </React.Fragment>
          );
        })}

        {/* Stop markers with numbers */}
        {routes.flatMap((route) =>
          route.stops.map((stop) => (
            <Marker
              key={`${route.route_id}-${stop.order}`}
              position={[stop.lat, stop.lon]}
              icon={createStopIcon(stop.action, stop.order)}
            >
              <Popup closeButton={false} className="station-popup">
                <div style={{ backgroundColor: "#111827", color: "#e2e8f0", padding: "8px 12px", borderRadius: 8, fontSize: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 3 }}>{stop.station_name}</div>
                  <div style={{ color: "#64748b", fontSize: 11 }}>
                    {stop.action === "pickup" ? "⬆ Pick up" : "⬇ Drop off"} <strong style={{ color: "#e2e8f0" }}>{stop.bikes}</strong> bikes
                  </div>
                </div>
              </Popup>
            </Marker>
          ))
        )}

        {/* Animated trucks on active routes */}
        {routes.map((route) => (
          <AnimatedTruck
            key={`truck-${route.route_id}`}
            route={route}
            color={ROUTE_COLORS[route.route_id] || "#94a3b8"}
          />
        ))}
      </MapContainer>

      <Legend />
    </div>
  );
}
