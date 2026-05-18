"use client";

import { useState, useRef } from "react";
import { Info } from "lucide-react";

interface TooltipProps {
  content: string;
  /** Optionally render a custom trigger instead of the default info icon */
  children?: React.ReactNode;
}

export default function Tooltip({ content, children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      className="relative inline-flex items-center"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children ?? (
        <Info className="h-3 w-3 text-slate-600 hover:text-slate-400 cursor-help transition-colors" />
      )}

      {visible && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none w-56">
          <div className="rounded-lg bg-slate-800 border border-white/10 shadow-xl px-3 py-2">
            <p className="text-[11px] text-slate-300 leading-relaxed">{content}</p>
          </div>
          {/* Arrow */}
          <div className="flex justify-center">
            <div className="w-2 h-2 bg-slate-800 border-r border-b border-white/10 rotate-45 -mt-1" />
          </div>
        </div>
      )}
    </div>
  );
}
