"use client";

interface DataBadgeProps {
  isLive: boolean;
  liveLabel?: string;
  tooltip?: string;
  inline?: boolean;
}

export default function DataBadge({
  isLive,
  liveLabel = "LIVE",
  tooltip,
  inline,
}: DataBadgeProps) {
  // When not live, show nothing — absence of the badge implies offline.
  // The green LIVE indicator is only meaningful when actually connected.
  if (!isLive) return null;

  if (inline) {
    return (
      <span title={tooltip ?? "Connected to live GCS data"}
        className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
        {liveLabel}
      </span>
    );
  }

  return (
    <span
      title={tooltip ?? "Connected to live GCS data"}
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider cursor-default border bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
      {liveLabel}
    </span>
  );
}
