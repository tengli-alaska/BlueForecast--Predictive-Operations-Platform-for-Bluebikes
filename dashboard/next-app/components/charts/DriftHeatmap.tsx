"use client";

import { motion } from "framer-motion";
import ChartContainer from "@/components/shared/ChartContainer";
import { COLORS } from "@/lib/constants";
import { formatNumber } from "@/lib/utils";

interface DriftHeatmapProps {
  driftScores: Record<string, number>;
  threshold: number;
}

function getCellColor(score: number, threshold: number): string {
  if (score >= threshold) return COLORS.red;
  if (score >= threshold * 0.7) return COLORS.yellow;
  return COLORS.green;
}

function getCellBgClass(score: number, threshold: number): string {
  if (score >= threshold) return "bg-red-500/20 border-red-500/40";
  if (score >= threshold * 0.7) return "bg-yellow-500/20 border-yellow-500/40";
  return "bg-green-500/20 border-green-500/40";
}

export default function DriftHeatmap({
  driftScores,
  threshold,
}: DriftHeatmapProps) {
  const entries = Object.entries(driftScores).sort(([, a], [, b]) => b - a);

  return (
    <ChartContainer title="Feature Drift Scores">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {entries.map(([feature, score], index) => (
          <motion.div
            key={feature}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              duration: 0.3,
              delay: index * 0.05,
              ease: "easeOut",
            }}
            className={`rounded-lg border p-3 ${getCellBgClass(score, threshold)}`}
          >
            <p className="truncate text-xs text-text-secondary" title={feature}>
              {feature}
            </p>
            <p
              className="mt-1 text-lg font-bold"
              style={{ color: getCellColor(score, threshold) }}
            >
              {formatNumber(score, 4)}
            </p>
            <p className="text-[10px] text-text-secondary">
              {score >= threshold
                ? "DRIFTED"
                : score >= threshold * 0.7
                  ? "WARNING"
                  : "OK"}
            </p>
          </motion.div>
        ))}
      </div>
    </ChartContainer>
  );
}
