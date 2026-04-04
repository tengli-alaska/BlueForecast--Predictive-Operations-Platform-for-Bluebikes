"use client";

import type { Station, Prediction } from "@/types";
import { getDemandColor, formatNumber } from "@/lib/utils";

interface StationPopupProps {
  station: Station;
  prediction?: Prediction;
}

export default function StationPopup({
  station,
  prediction,
}: StationPopupProps) {
  const demandValue = prediction?.predicted_demand ?? 0;
  const demandColor = getDemandColor(demandValue);

  return (
    <div
      style={{
        backgroundColor: "#1f2937",
        color: "#f1f5f9",
        padding: "12px 16px",
        borderRadius: "8px",
        minWidth: "200px",
        fontFamily: "inherit",
      }}
    >
      <h3
        style={{
          fontWeight: 700,
          fontSize: "14px",
          marginBottom: "8px",
          lineHeight: 1.3,
          color: "#f1f5f9",
        }}
      >
        {station.station_name}
      </h3>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          fontSize: "12px",
          color: "#94a3b8",
        }}
      >
        <span>
          Capacity: <strong style={{ color: "#f1f5f9" }}>{station.capacity} docks</strong>
        </span>

        <span>
          Predicted demand:{" "}
          <strong style={{ color: demandColor }}>
            {formatNumber(demandValue)} trips/hr
          </strong>
        </span>

        {prediction?.model_version != null && (
          <span style={{ fontSize: "11px", marginTop: "4px", opacity: 0.7 }}>
            Model v{prediction.model_version}
          </span>
        )}
      </div>
    </div>
  );
}
