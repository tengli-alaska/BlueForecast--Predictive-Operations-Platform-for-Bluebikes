"use client";

import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import ChartContainer from "@/components/shared/ChartContainer";
import { COLORS, getChartColors } from "@/lib/constants";
import { useTheme } from "@/components/ThemeProvider";

interface ScatterPlotProps {
  data: { actual: number; predicted: number }[];
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload: { actual: number; predicted: number } }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-bg-tertiary px-4 py-3 shadow-lg">
      <p className="text-sm text-text-primary">Actual: <span className="font-medium">{point.actual.toFixed(2)}</span></p>
      <p className="text-sm text-text-primary">Predicted: <span className="font-medium">{point.predicted.toFixed(2)}</span></p>
    </div>
  );
}

export default function ScatterPlot({ data }: ScatterPlotProps) {
  const { theme } = useTheme();
  const C = getChartColors(theme);
  const maxVal = Math.max(...data.map((d) => Math.max(d.actual, d.predicted)), 1);

  return (
    <ChartContainer title="Predicted vs Actual">
      <ResponsiveContainer width="100%" height={400}>
        <ScatterChart margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
          <XAxis type="number" dataKey="actual" name="Actual" tick={{ fill: C.textSecondary, fontSize: 12 }} axisLine={{ stroke: C.border }} tickLine={{ stroke: C.border }} label={{ value: "Actual", position: "insideBottom", offset: -10, fill: C.textSecondary, fontSize: 12 }} />
          <YAxis type="number" dataKey="predicted" name="Predicted" tick={{ fill: C.textSecondary, fontSize: 12 }} axisLine={{ stroke: C.border }} tickLine={{ stroke: C.border }} label={{ value: "Predicted", angle: -90, position: "insideLeft", offset: 0, fill: C.textSecondary, fontSize: 12 }} />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine segment={[{ x: 0, y: 0 }, { x: maxVal, y: maxVal }]} stroke={C.textSecondary} strokeDasharray="6 4" strokeWidth={1.5} />
          <Scatter data={data} fill={COLORS.blue} fillOpacity={0.6} isAnimationActive animationDuration={1000} />
        </ScatterChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
