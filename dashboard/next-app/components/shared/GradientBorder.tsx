"use client";

import { motion } from "framer-motion";

interface GradientBorderProps {
  children: React.ReactNode;
  className?: string;
  borderWidth?: number;
  animate?: boolean;
}

export default function GradientBorder({
  children,
  className = "",
  borderWidth = 1,
  animate = false,
}: GradientBorderProps) {
  return (
    <motion.div
      className={`relative rounded-2xl ${className}`}
      style={{ padding: borderWidth }}
    >
      {/* Gradient border layer */}
      <motion.div
        className="absolute inset-0 rounded-2xl"
        style={{
          background:
            "conic-gradient(from 0deg, #3b82f6, #a855f7, #06b6d4, #3b82f6)",
        }}
        animate={animate ? { rotate: 360 } : undefined}
        transition={
          animate
            ? { duration: 8, repeat: Infinity, ease: "linear" }
            : undefined
        }
      />
      {/* Inner content with solid background */}
      <div className="relative rounded-2xl bg-bg-primary" style={{ zIndex: 1 }}>
        {children}
      </div>
    </motion.div>
  );
}
