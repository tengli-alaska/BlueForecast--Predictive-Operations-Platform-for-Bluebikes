"use client";

interface StatusBadgeProps {
  status: "success" | "warning" | "error" | "pending" | "running";
  label?: string;
}

const statusConfig: Record<
  StatusBadgeProps["status"],
  { dot: string; text: string; defaultLabel: string }
> = {
  success: {
    dot: "bg-emerald-400",
    text: "text-emerald-400/80",
    defaultLabel: "Success",
  },
  warning: {
    dot: "bg-amber-400",
    text: "text-amber-400/80",
    defaultLabel: "Warning",
  },
  error: {
    dot: "bg-red-400",
    text: "text-red-400/80",
    defaultLabel: "Error",
  },
  running: {
    dot: "bg-blue-400",
    text: "text-blue-400/80",
    defaultLabel: "Running",
  },
  pending: {
    dot: "bg-slate-500",
    text: "text-slate-400/80",
    defaultLabel: "Pending",
  },
};

export default function StatusBadge({ status, label }: StatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-[11px] font-medium ${config.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      {label ?? config.defaultLabel}
    </span>
  );
}
