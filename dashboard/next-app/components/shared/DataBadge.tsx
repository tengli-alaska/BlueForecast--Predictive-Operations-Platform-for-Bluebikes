"use client";

interface DataBadgeProps {
  isLive: boolean;
  liveLabel?: string;
  mockLabel?: string;
  tooltip?: string;
  inline?: boolean;
}

export default function DataBadge({
  isLive,
  liveLabel = "LIVE",
  mockLabel = "DEMO DATA",
  tooltip,
  inline,
}: DataBadgeProps) {
  const label = isLive ? liveLabel : mockLabel;
  const cls = isLive
    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
    : "bg-slate-500/10 text-slate-400 border-slate-500/20";

  if (inline) {
    return (
      <span title={tooltip} className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${isLive ? "text-emerald-400" : "text-slate-500"}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${isLive ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
        {label}
      </span>
    );
  }

  return (
    <span
      title={tooltip ?? (isLive ? "Connected to live GCS data" : "Using demo data — connect GCS to see live predictions")}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider cursor-default border ${cls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isLive ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
      {label}
    </span>
  );
}
