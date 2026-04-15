"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { BrainCircuit, Layers, CloudSun, Clock, MapPin, BarChart3 } from "lucide-react";
import { getFeatureImportance } from "@/data";
import FeatureImportanceChart from "@/components/charts/FeatureImportanceChart";
import ScrollReveal from "@/components/shared/ScrollReveal";
import TextReveal from "@/components/shared/TextReveal";
import { COLORS } from "@/lib/constants";
import type { FeatureImportance } from "@/types";

const CATEGORY_META: Record<
  string,
  { label: string; color: string; icon: React.ReactNode; description: string }
> = {
  lag: {
    label: "Lag Features",
    color: COLORS.blue,
    icon: <BarChart3 className="h-5 w-5" />,
    description: "Historical demand at previous time steps",
  },
  rolling: {
    label: "Rolling Averages",
    color: COLORS.green,
    icon: <Layers className="h-5 w-5" />,
    description: "Smoothed demand over rolling time windows",
  },
  weather: {
    label: "Weather Features",
    color: COLORS.cyan,
    icon: <CloudSun className="h-5 w-5" />,
    description: "Temperature, precipitation, humidity, and wind",
  },
  time: {
    label: "Time Features",
    color: COLORS.purple,
    icon: <Clock className="h-5 w-5" />,
    description: "Cyclical and calendar time encodings",
  },
  station: {
    label: "Station Features",
    color: COLORS.orange,
    icon: <MapPin className="h-5 w-5" />,
    description: "Station-level attributes like capacity and ID",
  },
};

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } },
};

export default function FeaturesPage() {
  const [features, setFeatures] = useState<FeatureImportance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getFeatureImportance().then((f) => {
      setFeatures(f);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-5 md:p-7 flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 rounded-full border-2 border-blue-400/30 border-t-blue-400 animate-spin" />
          <p className="text-sm text-slate-500">Loading data...</p>
        </div>
      </div>
    );
  }

  // Group features by category
  const grouped: Record<string, FeatureImportance[]> = {};
  for (const f of features) {
    if (!grouped[f.category]) grouped[f.category] = [];
    grouped[f.category].push(f);
  }

  // Sort each group by SHAP descending
  for (const cat of Object.keys(grouped)) {
    grouped[cat].sort((a, b) => b.shap_value - a.shap_value);
  }

  return (
    <div className="min-h-screen bg-bg-primary bg-grid p-6 md:p-8 space-y-8">
      {/* Title Section */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-500/20 shadow-[0_0_20px_rgba(168,85,247,0.15)]">
            <BrainCircuit className="h-5 w-5 text-purple-400" />
          </div>
          <h1 className="text-3xl font-bold text-text-primary heading-premium">
            <TextReveal text="Feature Importance" />
          </h1>
        </div>
        <p className="text-text-secondary max-w-3xl leading-relaxed">
          SHAP (SHapley Additive exPlanations) values quantify each feature's marginal
          contribution to individual predictions, while XGBoost Gain measures the total
          improvement in loss from splits on each feature. Together, they reveal which
          inputs the model relies on most and how different feature categories drive
          demand forecasting accuracy.
        </p>
      </div>

      {/* SHAP Analysis Charts */}
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-text-secondary mb-4">
          SHAP ANALYSIS
        </p>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ScrollReveal direction="left">
            <FeatureImportanceChart data={features} metric="shap" />
          </ScrollReveal>
          <ScrollReveal direction="right" delay={0.1}>
            <FeatureImportanceChart data={features} metric="gain" />
          </ScrollReveal>
        </div>
      </div>

      {/* Category Breakdown */}
      <ScrollReveal>
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-text-secondary mb-4">
            FEATURE CATEGORIES
          </p>
          <p className="text-sm text-text-secondary mb-6">
            Breakdown of all 30 engineered features across 5 categories
          </p>

          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
          >
            {(["lag", "rolling", "weather", "time", "station"] as const).map((cat) => {
              const meta = CATEGORY_META[cat];
              const catFeatures = grouped[cat] || [];
              return (
                <motion.div
                  key={cat}
                  variants={itemVariants}
                  className="backdrop-blur-xl bg-bg-tertiary rounded-2xl p-5 border border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.3)]"
                  style={{ borderLeftWidth: 3, borderLeftStyle: "solid", borderLeftColor: meta.color }}
                >
                  {/* Card Header */}
                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-lg"
                      style={{ backgroundColor: `${meta.color}20`, color: meta.color }}
                    >
                      {meta.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-text-primary">{meta.label}</h3>
                    </div>
                    <span
                      className="inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-bold"
                      style={{ backgroundColor: `${meta.color}20`, color: meta.color }}
                    >
                      {catFeatures.length}
                    </span>
                  </div>

                  <p className="text-xs text-text-secondary mb-4">{meta.description}</p>

                  <div className="space-y-0">
                    {catFeatures.map((f, idx) => (
                      <div key={f.feature}>
                        <div className="flex items-center justify-between px-4 py-2.5 rounded-lg hover:bg-bg-tertiary transition-colors">
                          <span className="text-xs text-text-secondary truncate mr-2">
                            {f.feature}
                          </span>
                          <span
                            className="text-xs font-mono font-semibold shrink-0"
                            style={{ color: meta.color }}
                          >
                            {f.shap_value.toFixed(4)}
                          </span>
                        </div>
                        {idx < catFeatures.length - 1 && (
                          <div className="mx-4 border-t border-white/[0.06]" />
                        )}
                      </div>
                    ))}
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </ScrollReveal>
    </div>
  );
}
