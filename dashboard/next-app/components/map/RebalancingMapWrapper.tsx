"use client";

import dynamic from "next/dynamic";
import type { StationStatus, RebalancingRoute } from "@/types";

const RebalancingMap = dynamic(() => import("./RebalancingMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[520px] bg-bg-secondary rounded-xl animate-pulse" />
  ),
});

interface RebalancingMapWrapperProps {
  stations: StationStatus[];
  routes: RebalancingRoute[];
  stationNames: Record<string, { name: string; lat: number; lon: number; capacity: number }>;
  height?: string;
}

export default function RebalancingMapWrapper(props: RebalancingMapWrapperProps) {
  return <RebalancingMap {...props} />;
}
