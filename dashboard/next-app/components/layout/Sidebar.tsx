"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { useState } from "react";
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
  Users,
  ShieldCheck,
  DollarSign,
} from "lucide-react";

const opsNav = [
  { label: "Overview", href: "/overview", icon: LayoutDashboard },
  { label: "Rebalancing", href: "/rebalancing", icon: Truck },
  { label: "Stations", href: "/stations", icon: MapPin },
  { label: "Forecasts", href: "/forecasts", icon: TrendingUp },
];

const adminNav = [
  { label: "Performance", href: "/performance", icon: BarChart3 },
  { label: "Features", href: "/features", icon: Layers },
  { label: "Bias", href: "/bias", icon: Scale },
  { label: "Drift", href: "/drift", icon: Activity },
  { label: "Pipeline", href: "/pipeline", icon: GitBranch },
  { label: "Cost Analysis", href: "/costs", icon: DollarSign },
];

type Role = "ops" | "admin";

export default function Sidebar() {
  const pathname = usePathname();
  const [role, setRole] = useState<Role>("ops");

  const nav = role === "ops" ? opsNav : adminNav;
  const accentColor = role === "ops" ? "blue" : "violet";

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-56 flex-col bg-bg-secondary border-r border-[var(--border)] transition-colors duration-200">
      {/* Logo */}
      <div className="px-4 py-4">
        <div className="flex items-center gap-2">
          <div className={`h-6 w-6 rounded-md ${role === "ops" ? "bg-blue-500/20" : "bg-violet-500/20"} flex items-center justify-center`}>
            <div className={`h-2 w-2 rounded-full ${role === "ops" ? "bg-blue-400" : "bg-violet-400"}`} />
          </div>
          <span className="text-[14px] font-semibold text-text-primary tracking-tight">BlueForecast</span>
        </div>
      </div>

      {/* Role Toggle */}
      <div className="px-2 pb-2">
        <div className="flex rounded-md bg-bg-tertiary p-0.5 border border-[var(--border)]">
          <button
            onClick={() => setRole("ops")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded py-1.5 text-[11px] font-medium transition-all ${
              role === "ops"
                ? "bg-blue-500/20 text-blue-300"
                : "text-slate-500 hover:text-slate-400"
            }`}
          >
            <Users className="h-3 w-3" />
            Ops Team
          </button>
          <button
            onClick={() => setRole("admin")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded py-1.5 text-[11px] font-medium transition-all ${
              role === "admin"
                ? "bg-violet-500/20 text-violet-300"
                : "text-slate-500 hover:text-slate-400"
            }`}
          >
            <ShieldCheck className="h-3 w-3" />
            Admin
          </button>
        </div>
      </div>

      {/* Section label */}
      <div className="px-4 pb-1">
        <span className={`text-[10px] font-semibold uppercase tracking-widest ${role === "ops" ? "text-blue-400/50" : "text-violet-400/50"}`}>
          {role === "ops" ? "Operations" : "Model Monitoring"}
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 pt-1 space-y-px overflow-y-auto">
        {nav.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          const activeColor = role === "ops" ? "text-blue-400" : "text-violet-400";

          return (
            <Link key={item.href} href={item.href}>
              <motion.div
                className={`relative flex items-center gap-2 rounded-md px-2.5 py-[7px] text-[13px] transition-colors ${
                  isActive ? "text-text-primary" : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="sidebar-active"
                    className="absolute inset-0 rounded-md bg-bg-tertiary"
                    transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  />
                )}
                <Icon className={`relative z-10 h-[15px] w-[15px] ${isActive ? activeColor : ""}`} />
                <span className="relative z-10 font-medium">{item.label}</span>
              </motion.div>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-[var(--border)]">
        <div className="flex items-center gap-1.5">
          <span className="h-[5px] w-[5px] rounded-full bg-accent-green" />
          <span className="text-[11px] text-text-secondary">All systems normal</span>
        </div>
      </div>
    </aside>
  );
}
