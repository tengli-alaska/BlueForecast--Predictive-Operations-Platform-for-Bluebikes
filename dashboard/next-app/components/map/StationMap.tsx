"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import type { Station, Prediction } from "@/types";
import { getDemandColor } from "@/lib/utils";
import { BOSTON_CENTER } from "@/lib/constants";
import StationPopup from "./StationPopup";

/* ------------------------------------------------------------------ */
/*  Fix Leaflet default icon paths (prevents console errors even      */
/*  though we use CircleMarker instead of Marker)                     */
/* ------------------------------------------------------------------ */
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "",
  iconUrl: "",
  shadowUrl: "",
});

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */
interface StationMapProps {
  stations: Station[];
  predictions: Prediction[];
  height?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function clampRadius(capacity: number): number {
  const raw = capacity / 3;
  return Math.min(12, Math.max(4, raw));
}

/** Darken a hex colour by a fixed amount for the stroke */
function darken(hex: string, amount = 40): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.max(0, (num >> 16) - amount);
  const g = Math.max(0, ((num >> 8) & 0x00ff) - amount);
  const b = Math.max(0, (num & 0x0000ff) - amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/* ------------------------------------------------------------------ */
/*  Legend                                                              */
/* ------------------------------------------------------------------ */
const LEGEND_ITEMS = [
  { label: "5+ trips/hr", color: "#ef4444" },
  { label: "3 - 5", color: "#f97316" },
  { label: "1.5 - 3", color: "#eab308" },
  { label: "0.5 - 1.5", color: "#22c55e" },
  { label: "< 0.5", color: "#3b82f6" },
];

function Legend() {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 24,
        right: 24,
        zIndex: 1000,
        backgroundColor: "rgba(17, 24, 39, 0.92)",
        border: "1px solid #1e293b",
        borderRadius: "8px",
        padding: "12px 16px",
        color: "#f1f5f9",
        fontSize: "12px",
        lineHeight: 1.6,
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          fontWeight: 600,
          marginBottom: "6px",
          fontSize: "12px",
          color: "#94a3b8",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        Demand
      </div>
      {LEGEND_ITEMS.map((item) => (
        <div
          key={item.label}
          style={{ display: "flex", alignItems: "center", gap: "8px" }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              backgroundColor: item.color,
              display: "inline-block",
              flexShrink: 0,
            }}
          />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function StationMap({
  stations,
  predictions,
  height = "600px",
}: StationMapProps) {
  // Build a lookup map for O(1) access by station_id
  const predictionMap = new Map<string, Prediction>();
  for (const p of predictions) {
    if (!predictionMap.has(p.station_id)) {
      predictionMap.set(p.station_id, p);
    }
  }

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
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
        />

        {stations.map((station) => {
          const prediction = predictionMap.get(station.station_id);
          const demand = prediction?.predicted_demand ?? 0;
          const fillColor = getDemandColor(demand);
          const strokeColor = darken(fillColor);
          const radius = clampRadius(station.capacity);

          return (
            <CircleMarker
              key={station.station_id}
              center={[station.lat, station.lon]}
              radius={radius}
              pathOptions={{
                fillColor,
                fillOpacity: 0.8,
                color: strokeColor,
                weight: 1,
              }}
            >
              <Popup
                closeButton={false}
                offset={[0, -4]}
                className="station-popup"
              >
                <StationPopup station={station} prediction={prediction} />
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      <Legend />
    </div>
  );
}
