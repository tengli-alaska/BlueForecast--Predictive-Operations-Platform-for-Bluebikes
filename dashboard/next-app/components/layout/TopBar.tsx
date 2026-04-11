"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const pageTitles: Record<string, string> = {
  "/overview": "Overview",
  "/stations": "Stations",
  "/rebalancing": "Rebalancing",
  "/forecasts": "Forecasts",
  "/performance": "Model Performance",
  "/features": "Feature Importance",
  "/bias": "Bias & Fairness",
  "/drift": "Drift Detection",
  "/pipeline": "Pipeline Status",
};

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function TopBar() {
  const pathname = usePathname();
  const title = pageTitles[pathname] ?? "BlueForecast";
  const [isLive, setIsLive] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(`${API}/api/health`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setIsLive(d.gcs_connected === true))
      .catch(() => setIsLive(false));
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-white/[0.05] bg-[#0a0e17]/90 backdrop-blur-md px-6">
      <h2 className="text-sm font-medium text-slate-300">{title}</h2>
      <div className="flex items-center gap-2">
        {isLive === null ? (
          // Still checking
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-slate-500 animate-pulse" />
            <span className="text-xs text-slate-500">Checking...</span>
          </>
        ) : isLive ? (
          // Live GCS data
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-emerald-400/80">Live data</span>
          </>
        ) : (
          // API unavailable — demo mode
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            <span className="text-xs text-amber-400/80">Demo data</span>
          </>
        )}
      </div>
    </header>
  );
}
