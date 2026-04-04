"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import ChartContainer from "@/components/shared/ChartContainer";
import { COLORS } from "@/lib/constants";

interface ResidualHistogramProps {
  data: { range: string; count: number }[];
}

function getBarColor(range: string): string {
  const lower = range.toLowerCase();
  // Near-zero residuals (ranges containing "0" as a boundary or small values)
  if (
    lower.includes("0.0") ||
    lower.includes("-0.") ||
    lower === "0" ||
    lower.includes("~0")
  ) {
    // Check if it straddles zero or is very close
    const parts = range.split(/\s*(?:to|–|-(?=\d))\s*/);
    if (parts.length === 2) {
      const lo = parseFloat(parts[0]);
      const hi = parseFloat(parts[1]);
      if (!isNaN(lo) && !isNaN(hi) && lo <= 0 && hi >= 0) {
        return COLORS.green;
      }
      if (!isNaN(lo) && !isNaN(hi) && Math.abs(lo) < 0.5 && Math.abs(hi) < 0.5) {
        return COLORS.green;
      }
    }
  }

  // Try to parse the range to determine sign
  const firstNum = parseFloat(range.replace(/[[\]()]/g, ""));
  if (!isNaN(firstNum)) {
    if (firstNum < -0.5) return COLORS.red;
    if (firstNum > 0.5) return COLORS.blue;
    return COLORS.green;
  }

  // Fallback: check for negative sign
  if (range.startsWith("-") || range.startsWith("(-") || range.startsWith("[-")) {
    return COLORS.red;
  }
  return COLORS.blue;
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
      <p className="text-sm text-text-secondary">Range: {label}</p>
      <p className="text-sm font-medium text-text-primary">
        Count: {payload[0].value.toLocaleString()}
      </p>
    </div>
  );
}

export default function ResidualHistogram({ data }: ResidualHistogramProps) {
  return (
    <ChartContainer title="Residual Distribution">
      <ResponsiveContainer width="100%" height={350}>
        <BarChart
          data={data}
          margin={{ top: 10, right: 30, left: 20, bottom: 20 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
          <XAxis
            dataKey="range"
            tick={{ fill: COLORS.textSecondary, fontSize: 11 }}
            axisLine={{ stroke: COLORS.border }}
            tickLine={{ stroke: COLORS.border }}
            angle={-30}
            textAnchor="end"
            height={60}
          />
          <YAxis
            tick={{ fill: COLORS.textSecondary, fontSize: 12 }}
            axisLine={{ stroke: COLORS.border }}
            tickLine={{ stroke: COLORS.border }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar
            dataKey="count"
            radius={[4, 4, 0, 0]}
            isAnimationActive={true}
            animationDuration={800}
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={getBarColor(entry.range)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
