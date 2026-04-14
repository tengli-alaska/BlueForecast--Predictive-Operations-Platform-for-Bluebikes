"use client";

import dynamic from "next/dynamic";
import type { Station, Prediction } from "@/types";

const StationMap = dynamic(() => import("./StationMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[600px] bg-bg-secondary rounded-xl animate-pulse" />
  ),
});

interface MapWrapperProps {
  stations: Station[];
  predictions: Prediction[];
  height?: string;
}

export default function MapWrapper(props: MapWrapperProps) {
  return <StationMap {...props} />;
}
