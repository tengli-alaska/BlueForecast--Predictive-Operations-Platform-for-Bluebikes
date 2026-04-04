"use client";

import { usePathname } from "next/navigation";

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

export default function TopBar() {
  const pathname = usePathname();
  const title = pageTitles[pathname] ?? "BlueForecast";

  return (
    <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-white/[0.05] bg-[#0a0e17]/90 backdrop-blur-md px-6">
      <h2 className="text-sm font-medium text-slate-300">{title}</h2>
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span className="text-xs text-slate-500">Healthy</span>
      </div>
    </header>
  );
}
