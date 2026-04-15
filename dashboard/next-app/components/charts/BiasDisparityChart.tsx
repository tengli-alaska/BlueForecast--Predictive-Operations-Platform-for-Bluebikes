"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
  LabelList,
} from "recharts";
import ChartContainer from "@/components/shared/ChartContainer";
import { COLORS, THRESHOLDS, getChartColors } from "@/lib/constants";
import { useTheme } from "@/components/ThemeProvider";
import type { BiasSlice } from "@/types";

interface BiasDisparityChartProps {
  data: BiasSlice[];
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; payload: { flags: string[] } }[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const entry = payload[0];
  return (
    <div className="rounded-lg border border-border bg-bg-tertiary px-4 py-3 shadow-lg">
      <p className="mb-1 text-sm font-medium text-text-primary">{label}</p>
      <p className="text-sm text-text-secondary">
        Disparity Ratio:{" "}
        <span className="font-medium text-text-primary">
          {entry.value.toFixed(2)}
        </span>
      </p>
      {entry.payload.flags.length > 0 && (
        <div className="mt-1">
          {entry.payload.flags.map((flag, i) => (
            <p key={i} className="text-xs text-red-400">
              {flag}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BiasDisparityChart({ data }: BiasDisparityChartProps) {
  const { theme } = useTheme();
  const C = getChartColors(theme);
  const chartData = data.map((slice) => ({
    name: slice.slice_name,
    disparity_ratio: slice.disparity_ratio,
    flags: slice.flags,
  }));

  const threshold = THRESHOLDS.bias_disparity;

  return (
    <ChartContainer title="Bias Disparity Ratios">
      <ResponsiveContainer width="100%" height={350}>
        <BarChart
          data={chartData}
          margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
          <XAxis
            dataKey="name"
            tick={{ fill: C.textSecondary, fontSize: 12 }}
            axisLine={{ stroke: C.border }}
            tickLine={{ stroke: C.border }}
            angle={-20}
            textAnchor="end"
            height={60}
          />
          <YAxis
            tick={{ fill: C.textSecondary, fontSize: 12 }}
            axisLine={{ stroke: C.border }}
            tickLine={{ stroke: C.border }}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine
            y={threshold}
            stroke={COLORS.red}
            strokeDasharray="6 4"
            strokeWidth={2}
            label={{
              value: `Threshold (${threshold})`,
              position: "insideTopRight",
              fill: COLORS.red,
              fontSize: 11,
            }}
          />
          <Bar
            dataKey="disparity_ratio"
            radius={[4, 4, 0, 0]}
            isAnimationActive={true}
            animationDuration={800}
          >
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={
                  entry.disparity_ratio >= threshold
                    ? COLORS.red
                    : COLORS.blue
                }
              />
            ))}
            <LabelList
              dataKey="disparity_ratio"
              position="top"
              formatter={(value: string | number | boolean | null | undefined) =>
                typeof value === "number" ? value.toFixed(2) : String(value ?? "")
              }
              fill={C.textSecondary}
              fontSize={11}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
