"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  MapPin,
  Truck,
  TrendingUp,
  BarChart3,
  Layers,
  Scale,
  Activity,
  GitBranch,
} from "lucide-react";

const nav = [
  { label: "Overview", href: "/overview", icon: LayoutDashboard },
  { label: "Rebalancing", href: "/rebalancing", icon: Truck },
  { label: "Stations", href: "/stations", icon: MapPin },
  { label: "Forecasts", href: "/forecasts", icon: TrendingUp },
  null, // separator
  { label: "Performance", href: "/performance", icon: BarChart3 },
  { label: "Features", href: "/features", icon: Layers },
  { label: "Bias", href: "/bias", icon: Scale },
  { label: "Drift", href: "/drift", icon: Activity },
  { label: "Pipeline", href: "/pipeline", icon: GitBranch },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-56 flex-col bg-[#080c14] border-r border-white/[0.04]">
      {/* Logo */}
      <div className="px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-blue-500/20 flex items-center justify-center">
            <div className="h-2 w-2 rounded-full bg-blue-400" />
          </div>
          <span className="text-[14px] font-semibold text-white/90 tracking-tight">BlueForecast</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 pt-1 space-y-px overflow-y-auto">
        {nav.map((item, i) => {
          if (!item) {
            return <div key={`sep-${i}`} className="my-2 mx-2 border-t border-white/[0.04]" />;
          }

          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;

          return (
            <Link key={item.href} href={item.href}>
              <motion.div
                whileHover={{ backgroundColor: "rgba(255,255,255,0.03)" }}
                className={`relative flex items-center gap-2 rounded-md px-2.5 py-[7px] text-[13px] transition-colors ${
                  isActive ? "text-white" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="sidebar-active"
                    className="absolute inset-0 rounded-md bg-white/[0.05]"
                    transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  />
                )}
                <Icon className={`relative z-10 h-[15px] w-[15px] ${isActive ? "text-blue-400" : ""}`} />
                <span className="relative z-10 font-medium">{item.label}</span>
              </motion.div>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-white/[0.04]">
        <div className="flex items-center gap-1.5">
          <span className="h-[5px] w-[5px] rounded-full bg-emerald-400/80" />
          <span className="text-[11px] text-slate-600">All systems normal</span>
        </div>
      </div>
    </aside>
  );
}
