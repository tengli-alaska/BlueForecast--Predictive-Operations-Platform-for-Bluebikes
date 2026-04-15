"use client";

import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import ChartContainer from "@/components/shared/ChartContainer";
import { COLORS, getChartColors } from "@/lib/constants";
import { useTheme } from "@/components/ThemeProvider";

interface BarChartProps {
  data: { name: string; value: number; color?: string }[];
  title: string;
  horizontal?: boolean;
  valueFormatter?: (v: number) => string;
}

function CustomTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
  formatter?: (v: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const value = payload[0].value;
  return (
    <div className="rounded-lg border border-border bg-bg-tertiary px-4 py-3 shadow-lg">
      <p className="text-sm text-text-secondary">{label}</p>
      <p className="text-sm font-medium text-text-primary">
        {formatter ? formatter(value) : value.toLocaleString()}
      </p>
    </div>
  );
}

export default function BarChart({
  data,
  title,
  horizontal = false,
  valueFormatter,
}: BarChartProps) {
  const { theme } = useTheme();
  const C = getChartColors(theme);
  const defaultColor = COLORS.blue;

  if (horizontal) {
    return (
      <ChartContainer title={title}>
        <ResponsiveContainer width="100%" height={Math.max(300, data.length * 35)}>
          <RechartsBarChart
            data={data}
            layout="vertical"
            margin={{ top: 10, right: 30, left: 100, bottom: 10 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
            <XAxis
              type="number"
              tick={{ fill: C.textSecondary, fontSize: 12 }}
              axisLine={{ stroke: C.border }}
              tickLine={{ stroke: C.border }}
              tickFormatter={valueFormatter}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fill: C.textSecondary, fontSize: 12 }}
              axisLine={{ stroke: C.border }}
              tickLine={{ stroke: C.border }}
              width={90}
            />
            <Tooltip content={<CustomTooltip formatter={valueFormatter} />} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive animationDuration={800}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color || defaultColor} />
              ))}
            </Bar>
          </RechartsBarChart>
        </ResponsiveContainer>
      </ChartContainer>
    );
  }

  return (
    <ChartContainer title={title}>
      <ResponsiveContainer width="100%" height={350}>
        <RechartsBarChart data={data} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
          <XAxis
            dataKey="name"
            tick={{ fill: C.textSecondary, fontSize: 12 }}
            axisLine={{ stroke: C.border }}
            tickLine={{ stroke: C.border }}
            angle={-30}
            textAnchor="end"
            height={60}
          />
          <YAxis
            tick={{ fill: C.textSecondary, fontSize: 12 }}
            axisLine={{ stroke: C.border }}
            tickLine={{ stroke: C.border }}
            tickFormatter={valueFormatter}
          />
          <Tooltip content={<CustomTooltip formatter={valueFormatter} />} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={800}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color || defaultColor} />
            ))}
          </Bar>
        </RechartsBarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
