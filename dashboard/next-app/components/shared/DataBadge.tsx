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
      title={tooltip ?? "Connected to live GCS data"}
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider cursor-default bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
      {liveLabel}
    </span>
  );
}
