"use client";

import { motion } from "framer-motion";
import { AlertTriangle, XCircle, Info, X } from "lucide-react";

interface AlertBannerProps {
  type: "warning" | "error" | "info";
  title: string;
  message: string;
  onDismiss?: () => void;
}

const alertConfig = {
  warning: {
    icon: AlertTriangle,
    border: "border-amber-500/20",
    iconColor: "text-amber-400/70",
    titleColor: "text-amber-300/90",
  },
  error: {
    icon: XCircle,
    border: "border-red-500/20",
    iconColor: "text-red-400/70",
    titleColor: "text-red-300/90",
  },
  info: {
    icon: Info,
    border: "border-blue-500/20",
    iconColor: "text-blue-400/70",
    titleColor: "text-blue-300/90",
  },
};

export default function AlertBanner({
  type,
  title,
  message,
  onDismiss,
}: AlertBannerProps) {
  const config = alertConfig[type];
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={`flex items-start gap-3 rounded-xl border ${config.border} bg-white/[0.02] p-4`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${config.iconColor}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${config.titleColor}`}>{title}</p>
        <p className="mt-1 text-xs text-text-secondary/70 leading-relaxed">{message}</p>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="shrink-0 rounded-lg p-1 text-text-secondary/50 transition-colors hover:bg-white/[0.04] hover:text-text-primary"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </motion.div>
  );
}
