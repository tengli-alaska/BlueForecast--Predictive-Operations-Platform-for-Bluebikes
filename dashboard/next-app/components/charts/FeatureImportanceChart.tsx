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
import { motion } from "framer-motion";
import ChartContainer from "@/components/shared/ChartContainer";
import { COLORS } from "@/lib/constants";
import type { FeatureImportance } from "@/types";

interface FeatureImportanceChartProps {
  data: FeatureImportance[];
  metric?: "shap" | "gain";
}

const CATEGORY_COLORS: Record<string, string> = {
  lag: COLORS.blue,
  rolling: COLORS.green,
  weather: COLORS.cyan,
  time: COLORS.purple,
  station: COLORS.orange,
};

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: { feature: string; importance: number; category: string } }[];
}) {
  if (!active || !payload || payload.length === 0) return null;

  const entry = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-bg-tertiary px-4 py-3 shadow-lg">
      <p className="text-sm font-medium text-text-primary">{entry.feature}</p>
      <p className="text-sm text-text-secondary">
        Importance: {entry.importance.toFixed(4)}
      </p>
      <p className="text-sm" style={{ color: CATEGORY_COLORS[entry.category] }}>
        Category: {entry.category}
      </p>
    </div>
  );
}

export default function FeatureImportanceChart({
  data,
  metric = "shap",
}: FeatureImportanceChartProps) {
  const sorted = [...data]
    .sort((a, b) =>
      metric === "shap"
        ? b.shap_value - a.shap_value
        : b.xgboost_gain - a.xgboost_gain
    )
    .slice(0, 15);

  const chartData = sorted.map((item) => ({
    feature: item.feature,
    importance: metric === "shap" ? item.shap_value : item.xgboost_gain,
    category: item.category,
  }));

  // Reverse for horizontal bar chart so highest is at top
  const displayData = [...chartData].reverse();

  const metricLabel = metric === "shap" ? "SHAP Value" : "XGBoost Gain";

  return (
    <ChartContainer
      title="Feature Importance"
      subtitle={`Top 15 features by ${metricLabel}`}
    >
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      >
        <ResponsiveContainer width="100%" height={Math.max(400, displayData.length * 30)}>
          <BarChart
            data={displayData}
            layout="vertical"
            margin={{ top: 10, right: 30, left: 120, bottom: 10 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={COLORS.border}
              horizontal={false}
            />
            <XAxis
              type="number"
              tick={{ fill: COLORS.textSecondary, fontSize: 12 }}
              axisLine={{ stroke: COLORS.border }}
              tickLine={{ stroke: COLORS.border }}
            />
            <YAxis
              type="category"
              dataKey="feature"
              tick={{ fill: COLORS.textSecondary, fontSize: 11 }}
              axisLine={{ stroke: COLORS.border }}
              tickLine={{ stroke: COLORS.border }}
              width={110}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar
              dataKey="importance"
              radius={[0, 4, 4, 0]}
              isAnimationActive={true}
              animationDuration={1000}
            >
              {displayData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={CATEGORY_COLORS[entry.category] || COLORS.blue}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </motion.div>

      {/* Legend for categories */}
      <div className="mt-4 flex flex-wrap gap-4">
        {Object.entries(CATEGORY_COLORS).map(([category, color]) => (
          <div key={category} className="flex items-center gap-1.5">
            <div
              className="h-3 w-3 rounded-sm"
              style={{ backgroundColor: color }}
            />
            <span className="text-xs capitalize text-text-secondary">
              {category}
            </span>
          </div>
        ))}
      </div>
    </ChartContainer>
  );
}
