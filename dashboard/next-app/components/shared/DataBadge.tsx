"use client";

interface DataBadgeProps {
  isLive: boolean;
  liveLabel?: string;
  mockLabel?: string;
  tooltip?: string;
}

export default function DataBadge({
  isLive,
  liveLabel = "LIVE",
  mockLabel = "DEMO DATA",
  tooltip,
}: DataBadgeProps) {
  return (
    <span
      title={tooltip ?? (isLive ? "Connected to live GCS data" : "API unavailable — showing representative demo data. Not real-time.")}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider cursor-default ${
        isLive
          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
          : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isLive ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
      {isLive ? liveLabel : mockLabel}
    </span>
  );
}
