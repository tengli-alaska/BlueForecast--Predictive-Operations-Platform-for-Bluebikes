"use client";

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
  "route-alpha": "#60a5fa",
  "route-beta": "#4ade80",
  "route-gamma": "#c084fc",
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
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    html: `<div style="
      width:32px;height:32px;display:flex;align-items:center;justify-content:center;
      background:${color};border-radius:50%;border:2px solid rgba(255,255,255,0.3);
      box-shadow:0 0 12px ${color}80, 0 2px 8px rgba(0,0,0,0.4);
      font-size:16px;
    ">🚚</div>`,
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

/* Animated truck that moves along a route */
function AnimatedTruck({ route, color }: { route: RebalancingRoute; color: string }) {
  const map = useMap();
  const [progress, setProgress] = useState(0);
  const stops = [...route.stops].sort((a, b) => a.order - b.order);
  const positions: [number, number][] = stops.map((s) => [s.lat, s.lon]);

  useEffect(() => {
    if (route.status !== "active" || positions.length < 2) return;
    const interval = setInterval(() => {
      setProgress((p) => (p + 0.003) % 1);
    }, 50);
    return () => clearInterval(interval);
  }, [route.status, positions.length]);

  if (route.status !== "active" || positions.length < 2) return null;

  // Interpolate position along the polyline
  const totalSegments = positions.length - 1;
  const rawIndex = progress * totalSegments;
  const segIndex = Math.min(Math.floor(rawIndex), totalSegments - 1);
  const t = rawIndex - segIndex;
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
    <div
      style={{
        position: "absolute",
        bottom: 16,
        right: 16,
        zIndex: 1000,
        backgroundColor: "rgba(10, 14, 23, 0.9)",
        backdropFilter: "blur(8px)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: "10px",
        padding: "10px 14px",
        color: "#94a3b8",
        fontSize: "11px",
        lineHeight: 1.9,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 10, letterSpacing: "0.08em", color: "#64748b", marginBottom: 2 }}>STATIONS</div>
      {(["critical", "low", "moderate", "surplus"] as const).map((level) => (
        <div key={level} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: RISK_COLORS[level] }} />
          <span style={{ textTransform: "capitalize" }}>{level}</span>
        </div>
      ))}
      <div style={{ fontWeight: 600, fontSize: 10, letterSpacing: "0.08em", color: "#64748b", marginTop: 8, marginBottom: 2 }}>TRUCKS</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span>🚚</span><span>Active (animated)</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 14, height: 2, backgroundColor: "#c084fc", display: "inline-block", borderRadius: 1, border: "1px dashed #c084fc" }} />
        <span>Planned</span>
      </div>
    </div>
  );
}

export default function RebalancingMap({
  stations,
  routes,
  stationNames,
  height = "520px",
}: RebalancingMapProps) {
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

        {/* Route polylines */}
        {routes.map((route) => {
          const color = ROUTE_COLORS[route.route_id] || "#94a3b8";
          const positions: [number, number][] = [...route.stops]
            .sort((a, b) => a.order - b.order)
            .map((stop) => [stop.lat, stop.lon]);

          return (
            <Polyline
              key={route.route_id}
              positions={positions}
              pathOptions={{
                color,
                weight: route.status === "active" ? 3 : 2,
                opacity: route.status === "active" ? 0.7 : 0.35,
                dashArray: route.status === "planned" ? "6 8" : undefined,
              }}
            />
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
