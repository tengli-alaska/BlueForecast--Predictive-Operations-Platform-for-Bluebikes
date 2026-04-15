"use client";

import { useState, useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import HeroSplash from "@/components/hero/HeroSplash";
import { motion } from "framer-motion";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [showHero, setShowHero] = useState(true);

  // Only render hero after client mount to avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  const handleEnter = () => {
    setShowHero(false);
  };

  // SSR: render nothing (avoids hydration mismatch from Math.random in hero)
  if (!mounted) {
    return (
      <div className="flex h-full min-h-screen bg-bg-primary items-center justify-center transition-colors duration-200">
        <div className="h-6 w-6 rounded-full border-2 border-blue-400/30 border-t-blue-400 animate-spin" />
      </div>
    );
  }

  return (
    <>
      <AnimatePresence mode="wait">
        {showHero && <HeroSplash key="hero" onEnter={handleEnter} />}
      </AnimatePresence>

      {!showHero && (
        <motion.div
          className="flex h-full min-h-screen bg-bg-primary"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <Sidebar />
          <div className="ml-56 flex flex-1 flex-col overflow-y-auto">
            <TopBar />
            <main className="flex-1 bg-bg-primary">{children}</main>
          </div>
        </motion.div>
      )}
    </>
  );
}
