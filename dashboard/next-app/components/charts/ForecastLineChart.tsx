"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import ChartContainer from "@/components/shared/ChartContainer";
import { COLORS } from "@/lib/constants";
import { formatHour } from "@/lib/utils";
import type { Prediction } from "@/types";

interface ForecastLineChartProps {
  data: Prediction[];
  stationName?: string;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-bg-tertiary px-4 py-3 shadow-lg">
      <p className="text-sm text-text-secondary">{label}</p>
      <p className="text-sm font-medium text-text-primary">
        Demand: {payload[0].value.toFixed(2)} trips
      </p>
    </div>
  );
}

export default function ForecastLineChart({
  data,
  stationName,
}: ForecastLineChartProps) {
  const chartData = data.map((d) => ({
    ...d,
    hour: formatHour(d.forecast_hour),
  }));

  const title = stationName
    ? `Demand Forecast - ${stationName}`
    : "Demand Forecast";

  return (
    <ChartContainer title={title}>
      <ResponsiveContainer width="100%" height={350}>
        <AreaChart
          data={chartData}
          margin={{ top: 10, right: 30, left: 20, bottom: 10 }}
        >
          <defs>
            <linearGradient id="forecastGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={COLORS.blue} stopOpacity={0.4} />
              <stop offset="95%" stopColor={COLORS.blue} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
          <XAxis
            dataKey="hour"
            tick={{ fill: COLORS.textSecondary, fontSize: 12 }}
            axisLine={{ stroke: COLORS.border }}
            tickLine={{ stroke: COLORS.border }}
          />
          <YAxis
            tick={{ fill: COLORS.textSecondary, fontSize: 12 }}
            axisLine={{ stroke: COLORS.border }}
            tickLine={{ stroke: COLORS.border }}
            label={{
              value: "Predicted Demand",
              angle: -90,
              position: "insideLeft",
              offset: 0,
              fill: COLORS.textSecondary,
              fontSize: 12,
            }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="predicted_demand"
            stroke={COLORS.blue}
            strokeWidth={2.5}
            fill="url(#forecastGradient)"
            dot={{
              r: 4,
              fill: COLORS.blue,
              stroke: COLORS.bgSecondary,
              strokeWidth: 2,
            }}
            activeDot={{
              r: 6,
              fill: COLORS.blue,
              stroke: COLORS.textPrimary,
              strokeWidth: 2,
            }}
            isAnimationActive={true}
            animationDuration={1000}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
