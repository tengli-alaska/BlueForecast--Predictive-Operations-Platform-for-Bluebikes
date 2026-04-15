"use client";

import { motion } from "framer-motion";

interface ChartContainerProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  tint?: "blue" | "green" | "red" | "purple" | "orange" | "cyan";
}

export default function ChartContainer({
  title,
  subtitle,
  children,
  className = "",
}: ChartContainerProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      viewport={{ once: true }}
      className={`rounded-2xl border border-[var(--border)] bg-bg-card p-5 transition-colors duration-200 ${className}`}
    >
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {subtitle && (
          <p className="mt-0.5 text-xs text-text-secondary/60">{subtitle}</p>
        )}
      </div>
      {children}
    </motion.div>
  );
}
