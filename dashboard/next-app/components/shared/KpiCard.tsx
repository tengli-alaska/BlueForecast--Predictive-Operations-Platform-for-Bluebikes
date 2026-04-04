"use client";

import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import AnimatedCounter from "./AnimatedCounter";

interface KpiCardProps {
  title: string;
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  trend?: "up" | "down" | "stable";
  trendValue?: string;
  icon: React.ReactNode;
  color?: string;
}

export default function KpiCard({
  title,
  value,
  decimals = 0,
  prefix,
  suffix,
  trend,
  trendValue,
  icon,
  color = "#3b82f6",
}: KpiCardProps) {
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;

  return (
    <motion.div
      className="relative overflow-hidden rounded-2xl border border-white/[0.07] p-6 transition-all duration-300 hover:border-white/[0.14]"
      style={{
        background: `linear-gradient(160deg, ${color}0a 0%, rgba(17,24,39,0.95) 60%)`,
      }}
      whileHover={{
        scale: 1.02,
        boxShadow: `0 4px 24px ${color}18`,
      }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      {/* Top accent line — thin and precise */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background: `linear-gradient(90deg, transparent 10%, ${color}80 50%, transparent 90%)`,
        }}
      />

      <div className="flex items-center gap-3">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${color}15` }}
        >
          <div style={{ color }}>{icon}</div>
        </div>
        <p className="text-sm font-medium text-text-secondary">{title}</p>
      </div>

      <p className="mt-4 text-3xl font-bold text-text-primary tracking-tight">
        <AnimatedCounter
          value={value}
          decimals={decimals}
          prefix={prefix}
          suffix={suffix}
        />
      </p>

      {trend && trendValue && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-text-secondary/70">
          <TrendIcon className="h-3 w-3" style={{ color: `${color}90` }} />
          <span>{trendValue}</span>
        </div>
      )}
    </motion.div>
  );
}
