"use client";

import ChartContainer from "@/components/shared/ChartContainer";

interface DemandHeatmapChartProps {
  data: { hour: number; day: string; demand: number }[];
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DISPLAY_HOURS = [0, 3, 6, 9, 12, 15, 18, 21];

const DAY_LABELS: Record<string, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};

function getCellColor(demand: number): string {
  if (demand >= 9) return "#a5f3fc";
  if (demand >= 7) return "#22d3ee";
  if (demand >= 5) return "#0ea5e9";
  if (demand >= 3) return "#2563eb";
  if (demand >= 1) return "#1e3a5f";
  return "#1e293b";
}

function formatHour(hour: number): string {
  if (hour === 0) return "12am";
  if (hour < 12) return `${hour}am`;
  if (hour === 12) return "12pm";
  return `${hour - 12}pm`;
}

const LEGEND_STOPS = [
  { label: "0", color: "#1e293b" },
  { label: "1", color: "#1e3a5f" },
  { label: "3", color: "#2563eb" },
  { label: "5", color: "#0ea5e9" },
  { label: "7", color: "#22d3ee" },
  { label: "9+", color: "#a5f3fc" },
];

export default function DemandHeatmapChart({ data }: DemandHeatmapChartProps) {
  // Build a lookup map for quick access
  const lookup = new Map<string, number>();
  for (const entry of data) {
    lookup.set(`${entry.day}-${entry.hour}`, entry.demand);
  }

  return (
    <ChartContainer
      title="Demand Heatmap"
      subtitle="Average hourly demand by day of week"
    >
      <div className="overflow-x-auto">
        {/* Hour labels */}
        <div className="flex">
          <div className="w-10 shrink-0" />
          <div className="grid flex-1 grid-cols-24 gap-[2px]" style={{ gridTemplateColumns: `repeat(24, minmax(0, 1fr))` }}>
            {HOURS.map((hour) => (
              <div key={hour} className="flex items-center justify-center">
                {DISPLAY_HOURS.includes(hour) ? (
                  <span className="text-[10px] text-slate-500">{hour}</span>
                ) : (
                  <span className="text-[10px] text-transparent">.</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Grid rows */}
        <div className="space-y-[2px] mt-1">
          {DAYS.map((day) => (
            <div key={day} className="flex items-center">
              <div className="w-10 shrink-0">
                <span className="text-[11px] text-slate-500">{day}</span>
              </div>
              <div className="grid flex-1 gap-[2px]" style={{ gridTemplateColumns: `repeat(24, minmax(0, 1fr))` }}>
                {HOURS.map((hour) => {
                  const demand = lookup.get(`${day}-${hour}`) ?? 0;
                  return (
                    <div
                      key={hour}
                      className="h-7 w-full rounded-[3px] border border-white/[0.02] transition-opacity hover:opacity-80"
                      style={{ backgroundColor: getCellColor(demand) }}
                      title={`${DAY_LABELS[day]} ${formatHour(hour)}: ${demand} trips/hr`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center justify-center gap-1">
        <span className="mr-1.5 text-[10px] text-slate-500">Low</span>
        {LEGEND_STOPS.map((stop) => (
          <div key={stop.label} className="flex flex-col items-center gap-0.5">
            <div
              className="h-3 w-8 rounded-[2px]"
              style={{ backgroundColor: stop.color }}
            />
            <span className="text-[9px] text-slate-500">{stop.label}</span>
          </div>
        ))}
        <span className="ml-1.5 text-[10px] text-slate-500">High</span>
      </div>
    </ChartContainer>
  );
}
