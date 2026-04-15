"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";

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
  "/costs": "Cost Analysis",
};

export default function TopBar() {
  const pathname = usePathname();
  const title = pageTitles[pathname] ?? "BlueForecast";
  const [isLive, setIsLive] = useState<boolean | null>(null);
  const { theme, toggle } = useTheme();

  useEffect(() => {
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setIsLive(d.gcs_connected === true))
      .catch(() => setIsLive(false));
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-[var(--border)] bg-bg-primary/90 backdrop-blur-md px-6 transition-colors duration-200">
      <h2 className="text-sm font-medium text-text-primary">{title}</h2>
      <div className="flex items-center gap-3">
        {/* Live / Demo badge */}
        {isLive === null ? (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-text-secondary animate-pulse" />
            <span className="text-xs text-text-secondary">Checking...</span>
          </>
        ) : isLive ? (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-accent-green animate-pulse" />
            <span className="text-xs text-accent-green">Live data</span>
          </>
        ) : (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-accent-yellow" />
            <span className="text-xs text-accent-yellow">Demo data</span>
          </>
        )}

        {/* Theme toggle */}
        <button
          onClick={toggle}
          aria-label="Toggle theme"
          className="flex items-center justify-center h-7 w-7 rounded-md border border-[var(--border)] bg-bg-secondary hover:bg-bg-tertiary transition-colors duration-150"
        >
          {theme === "dark" ? (
            <Sun className="h-3.5 w-3.5 text-text-secondary" />
          ) : (
            <Moon className="h-3.5 w-3.5 text-text-secondary" />
          )}
        </button>
      </div>
    </header>
  );
}
