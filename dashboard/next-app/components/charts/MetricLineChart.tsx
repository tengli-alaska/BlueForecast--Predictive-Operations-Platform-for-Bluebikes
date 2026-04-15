"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import ChartContainer from "@/components/shared/ChartContainer";
import { COLORS, getChartColors } from "@/lib/constants";
import { useTheme } from "@/components/ThemeProvider";

interface MetricLineChartProps {
  data: { label: string; rmse: number; r2: number; mae: number }[];
  title: string;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { color: string; name: string; value: number }[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-bg-tertiary px-4 py-3 shadow-lg">
      <p className="mb-2 text-sm font-medium text-text-primary">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="text-sm" style={{ color: entry.color }}>
          {entry.name}: {entry.value.toFixed(4)}
        </p>
      ))}
    </div>
  );
}

export default function MetricLineChart({ data, title }: MetricLineChartProps) {
  const { theme } = useTheme();
  const C = getChartColors(theme);
  return (
    <ChartContainer title={title}>
      <ResponsiveContainer width="100%" height={350}>
        <LineChart
          data={data}
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
          <XAxis
            dataKey="label"
            tick={{ fill: C.textSecondary, fontSize: 12 }}
            axisLine={{ stroke: C.border }}
            tickLine={{ stroke: C.border }}
          />
          <YAxis
            tick={{ fill: C.textSecondary, fontSize: 12 }}
            axisLine={{ stroke: C.border }}
            tickLine={{ stroke: C.border }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ color: C.textSecondary, fontSize: 12 }}
          />
          <Line
            type="monotone"
            dataKey="rmse"
            name="RMSE"
            stroke={COLORS.blue}
            strokeWidth={2}
            dot={{ r: 4, fill: COLORS.blue }}
            activeDot={{ r: 6 }}
            isAnimationActive={true}
            animationDuration={1000}
          />
          <Line
            type="monotone"
            dataKey="r2"
            name="R2"
            stroke={COLORS.green}
            strokeWidth={2}
            dot={{ r: 4, fill: COLORS.green }}
            activeDot={{ r: 6 }}
            isAnimationActive={true}
            animationDuration={1000}
          />
          <Line
            type="monotone"
            dataKey="mae"
            name="MAE"
            stroke={COLORS.orange}
            strokeWidth={2}
            dot={{ r: 4, fill: COLORS.orange }}
            activeDot={{ r: 6 }}
            isAnimationActive={true}
            animationDuration={1000}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
