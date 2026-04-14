"use client";

import { motion } from "framer-motion";

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  glowColor?: string;
  padding?: string;
  tint?: "blue" | "green" | "red" | "purple" | "orange" | "cyan";
}

export default function GlassCard({
  children,
  className = "",
  hover = false,
  glowColor = "59, 130, 246",
  padding = "p-6",
  tint,
}: GlassCardProps) {
  const glassClass = tint
    ? `glass-${tint}`
    : "backdrop-blur-xl bg-white/[0.03] border border-white/[0.06]";

  return (
    <motion.div
      className={`
        relative overflow-hidden rounded-2xl
        ${glassClass}
        shadow-2xl shadow-black/20
        transition-colors duration-300
        ${hover ? "hover:border-white/[0.12]" : ""}
        ${padding} ${className}
      `}
      whileHover={
        hover
          ? {
              scale: 1.02,
              boxShadow: `0 0 30px rgba(${glowColor}, 0.15)`,
            }
          : undefined
      }
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      {/* Subtle top gradient overlay for glass reflection */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)",
        }}
      />
      <div className="relative z-10">{children}</div>
    </motion.div>
  );
}
