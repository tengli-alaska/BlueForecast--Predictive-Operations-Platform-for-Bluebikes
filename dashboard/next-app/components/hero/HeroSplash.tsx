"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MapPin,
  Zap,
  Activity,
  BarChart3,
  ArrowRight,
} from "lucide-react";

/* ================================================================== */
/*  SEEDED RNG                                                         */
/* ================================================================== */
function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

/* ================================================================== */
/*  SCRAMBLE TEXT COMPONENT                                            */
/* ================================================================== */
const CHARS = "!@#$%^&*01ABXZabxz<>{}|~";

function ScrambleText({
  text,
  className,
  delay = 0,
  duration = 2000,
  trigger = true,
}: {
  text: string;
  className?: string;
  delay?: number;
  duration?: number;
  trigger?: boolean;
}) {
  const [display, setDisplay] = useState("");
  const frameRef = useRef<number>(0);

  useEffect(() => {
    if (!trigger) {
      setDisplay("");
      return;
    }

    const startTime = performance.now() + delay;
    const charDuration = duration / text.length;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      if (elapsed < 0) {
        // Before delay: show scrambled
        const scrambled = text
          .split("")
          .map((ch) =>
            ch === " " ? " " : CHARS[Math.floor(Math.random() * CHARS.length)]
          )
          .join("");
        setDisplay(scrambled);
        frameRef.current = requestAnimationFrame(tick);
        return;
      }

      const lockedCount = Math.min(
        text.length,
        Math.floor(elapsed / charDuration)
      );

      if (lockedCount >= text.length) {
        setDisplay(text);
        return;
      }

      const result = text.split("").map((ch, i) => {
        if (ch === " ") return " ";
        if (i < lockedCount) return ch;
        return CHARS[Math.floor(Math.random() * CHARS.length)];
      });

      setDisplay(result.join(""));
      frameRef.current = requestAnimationFrame(tick);
    };

    // Start scramble animation ~200ms before delay so user sees the noise
    const preStart = Math.max(0, delay - 200);
    const timeout = setTimeout(() => {
      frameRef.current = requestAnimationFrame(tick);
    }, preStart);

    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(frameRef.current);
    };
  }, [trigger, text, delay, duration]);

  return (
    <span className={className} aria-label={text}>
      {display || "\u00A0"}
    </span>
  );
}

/* ================================================================== */
/*  ANIMATED 3D GLOBE / ORB                                            */
/* ================================================================== */
function GlobeOrb({ visible }: { visible: boolean }) {
  const SIZE = 250;
  const R = 100;
  const CX = 125;
  const CY = 125;

  // Generate latitude lines
  const latitudes = useMemo(() => {
    const lines: string[] = [];
    for (let lat = -60; lat <= 60; lat += 30) {
      const y = CY + R * Math.sin((lat * Math.PI) / 180);
      const rx = R * Math.cos((lat * Math.PI) / 180);
      const ry = rx * 0.3; // perspective flattening
      lines.push(
        `M ${CX - rx} ${y} A ${rx} ${ry} 0 0 1 ${CX + rx} ${y} A ${rx} ${ry} 0 0 1 ${CX - rx} ${y}`
      );
    }
    return lines;
  }, []);

  // Generate longitude lines
  const longitudes = useMemo(() => {
    const lines: string[] = [];
    for (let lon = 0; lon < 180; lon += 30) {
      const radLon = (lon * Math.PI) / 180;
      const rx = R * Math.sin(radLon) || 1;
      const ry = R;
      lines.push(
        `M ${CX} ${CY - R} A ${rx} ${ry} 0 0 1 ${CX} ${CY + R} A ${rx} ${ry} 0 0 0 ${CX} ${CY - R}`
      );
    }
    return lines;
  }, []);

  // Data points (station locations on globe)
  const stationDots = useMemo(() => {
    const rng = makeRng(77);
    return Array.from({ length: 14 }, (_, i) => {
      const lat = -50 + rng() * 100;
      const lon = rng() * 360;
      const radLat = (lat * Math.PI) / 180;
      const radLon = (lon * Math.PI) / 180;
      const x = CX + R * Math.cos(radLat) * Math.sin(radLon) * 0.85;
      const y = CY - R * Math.sin(radLat) * 0.85;
      return { id: i, x, y, delay: 0.3 + i * 0.12, size: 2 + rng() * 2.5 };
    });
  }, []);

  // Route arcs connecting pairs of points
  const arcs = useMemo(() => {
    const pairs = [
      [0, 3],
      [1, 5],
      [2, 7],
      [4, 9],
      [6, 11],
      [8, 13],
      [10, 12],
    ];
    return pairs.map(([a, b], i) => {
      const pa = stationDots[a];
      const pb = stationDots[b];
      const mx = (pa.x + pb.x) / 2;
      const my = (pa.y + pb.y) / 2 - 20 - Math.random() * 15;
      return {
        id: i,
        d: `M ${pa.x} ${pa.y} Q ${mx} ${my} ${pb.x} ${pb.y}`,
        delay: 1.0 + i * 0.15,
      };
    });
  }, [stationDots]);

  return (
    <motion.div
      className="relative mx-auto mb-8"
      style={{ width: SIZE, height: SIZE }}
      initial={{ scale: 0, opacity: 0 }}
      animate={visible ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
      transition={{ type: "spring", stiffness: 120, damping: 14, mass: 1 }}
    >
      {/* Blur glow behind orb */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(59,130,246,0.35) 0%, rgba(139,92,246,0.18) 40%, transparent 70%)",
          filter: "blur(30px)",
          transform: "scale(1.4)",
        }}
      />

      <motion.svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="relative w-full h-full"
        animate={{ rotate: 360 }}
        transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
      >
        <defs>
          <radialGradient id="orbGrad" cx="40%" cy="35%" r="60%">
            <stop offset="0%" stopColor="#818cf8" stopOpacity="0.3" />
            <stop offset="40%" stopColor="#3b82f6" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#1e1b4b" stopOpacity="0.05" />
          </radialGradient>
          <radialGradient id="orbEdge" cx="50%" cy="50%" r="50%">
            <stop offset="85%" stopColor="transparent" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.25" />
          </radialGradient>
          <filter id="globeGlow">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="arcGlow">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <clipPath id="globeClip">
            <circle cx={CX} cy={CY} r={R} />
          </clipPath>
        </defs>

        {/* Globe sphere */}
        <circle cx={CX} cy={CY} r={R} fill="url(#orbGrad)" />
        <circle cx={CX} cy={CY} r={R} fill="url(#orbEdge)" />
        <circle
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          stroke="rgba(139,92,246,0.2)"
          strokeWidth="1"
        />

        {/* Grid lines clipped to globe */}
        <g clipPath="url(#globeClip)" opacity="0.35">
          {latitudes.map((d, i) => (
            <motion.path
              key={`lat-${i}`}
              d={d}
              fill="none"
              stroke="#6366f1"
              strokeWidth="0.5"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              transition={{ delay: 0.8 + i * 0.08, duration: 0.6 }}
            />
          ))}
          {longitudes.map((d, i) => (
            <motion.path
              key={`lon-${i}`}
              d={d}
              fill="none"
              stroke="#818cf8"
              strokeWidth="0.4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              transition={{ delay: 0.9 + i * 0.06, duration: 0.6 }}
            />
          ))}
        </g>

        {/* Route arcs */}
        <g clipPath="url(#globeClip)">
          {arcs.map((arc) => (
            <motion.path
              key={`arc-${arc.id}`}
              d={arc.d}
              fill="none"
              stroke="#06b6d4"
              strokeWidth="1"
              filter="url(#arcGlow)"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: [0, 0.8, 0.5] }}
              transition={{
                duration: 1.5,
                delay: arc.delay,
                ease: "easeOut",
              }}
            />
          ))}
        </g>

        {/* Station dots */}
        <g clipPath="url(#globeClip)">
          {stationDots.map((dot) => (
            <motion.circle
              key={`dot-${dot.id}`}
              cx={dot.x}
              cy={dot.y}
              r={dot.size}
              fill="#3b82f6"
              filter="url(#globeGlow)"
              initial={{ opacity: 0, scale: 0 }}
              animate={{
                opacity: [0, 1, 0.6, 1],
                scale: [0, 1.3, 1, 1.15, 1],
              }}
              transition={{
                duration: 2.5,
                delay: dot.delay,
                repeat: Infinity,
                repeatDelay: 2 + dot.id * 0.3,
              }}
            />
          ))}
        </g>

        {/* Travelling pulses along arcs */}
        {arcs.slice(0, 4).map((arc, i) => (
          <motion.circle
            key={`tpulse-${arc.id}`}
            r="2.5"
            fill="#22d3ee"
            filter="url(#arcGlow)"
            opacity={0}
            animate={{
              offsetDistance: ["0%", "100%"],
              opacity: [0, 1, 0],
            }}
            transition={{
              duration: 2.5,
              delay: 2 + i * 0.6,
              repeat: Infinity,
              repeatDelay: 3,
              ease: "linear",
            }}
            style={{ offsetPath: `path("${arc.d}")` }}
          />
        ))}
      </motion.svg>
    </motion.div>
  );
}

/* ================================================================== */
/*  ENHANCED PARTICLE SYSTEM WITH CONSTELLATION CONNECTIONS            */
/* ================================================================== */
interface Particle {
  id: number;
  baseX: number;
  baseY: number;
  size: number;
  color: string;
  phaseX: number;
  phaseY: number;
  freqX: number;
  freqY: number;
  ampX: number;
  ampY: number;
  speed: number;
}

function Particles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const rng = makeRng(314);
    const colors = [
      "59,130,246", // blue
      "139,92,246", // purple
      "6,182,212", // cyan
      "255,255,255", // white
    ];

    particlesRef.current = Array.from({ length: 60 }, (_, i) => ({
      id: i,
      baseX: rng() * 100,
      baseY: rng() * 100,
      size: 1 + rng() * 5,
      color: colors[Math.floor(rng() * colors.length)],
      phaseX: rng() * Math.PI * 2,
      phaseY: rng() * Math.PI * 2,
      freqX: 0.0003 + rng() * 0.0008,
      freqY: 0.0002 + rng() * 0.0007,
      ampX: 1.5 + rng() * 3.5,
      ampY: 1.5 + rng() * 3.5,
      speed: 0.5 + rng() * 1.0,
    }));

    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const CONNECTION_DIST = 120;

    const draw = (time: number) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const positions: { x: number; y: number; color: string; size: number }[] = [];

      // Compute positions with organic movement
      for (const p of particlesRef.current) {
        const t = time * p.speed;
        // Combine multiple sin/cos for perlin-noise-like movement
        const ox =
          Math.sin(t * p.freqX + p.phaseX) * p.ampX +
          Math.sin(t * p.freqX * 1.7 + p.phaseY) * p.ampX * 0.5 +
          Math.cos(t * p.freqY * 0.8 + p.phaseX * 2) * p.ampX * 0.3;
        const oy =
          Math.cos(t * p.freqY + p.phaseY) * p.ampY +
          Math.cos(t * p.freqY * 1.3 + p.phaseX) * p.ampY * 0.5 +
          Math.sin(t * p.freqX * 0.6 + p.phaseY * 1.5) * p.ampY * 0.3;

        const x = ((p.baseX + ox) / 100) * w;
        const y = ((p.baseY + oy) / 100) * h;

        // Breathing opacity
        const alpha =
          0.25 + 0.4 * (0.5 + 0.5 * Math.sin(time * 0.001 + p.phaseX));

        positions.push({ x, y, color: p.color, size: p.size });

        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color},${alpha})`;
        ctx.fill();
      }

      // Constellation connection lines
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const dx = positions[i].x - positions[j].x;
          const dy = positions[i].y - positions[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONNECTION_DIST) {
            const lineAlpha = (1 - dist / CONNECTION_DIST) * 0.12;
            ctx.beginPath();
            ctx.moveTo(positions[i].x, positions[i].y);
            ctx.lineTo(positions[j].x, positions[j].y);
            ctx.strokeStyle = `rgba(139,92,246,${lineAlpha})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ opacity: 0.6 }}
    />
  );
}

/* ================================================================== */
/*  SUBTLE NEURAL NETWORK BACKGROUND                                   */
/* ================================================================== */
function generateNetwork() {
  const nodes: { id: number; x: number; y: number; delay: number; size: number }[] = [];
  const edges: { id: string; x1: number; y1: number; x2: number; y2: number; delay: number }[] = [];
  const rand = makeRng(42);

  for (let i = 0; i < 30; i++) {
    nodes.push({
      id: i,
      x: rand() * 100,
      y: rand() * 100,
      delay: rand() * 2,
      size: 2 + rand() * 3,
    });
  }

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 22) {
        edges.push({
          id: `${i}-${j}`,
          x1: nodes[i].x,
          y1: nodes[i].y,
          x2: nodes[j].x,
          y2: nodes[j].y,
          delay: rand() * 1.5,
        });
      }
    }
  }
  return { nodes, edges };
}

const network = generateNetwork();

function NeuralBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden opacity-15">
      <svg
        className="h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {network.edges.map((edge) => (
          <motion.line
            key={edge.id}
            x1={edge.x1}
            y1={edge.y1}
            x2={edge.x2}
            y2={edge.y2}
            stroke="url(#edgeGrad)"
            strokeWidth="0.12"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: [0, 0.4, 0.2] }}
            transition={{
              duration: 2,
              delay: edge.delay,
              ease: "easeOut",
            }}
          />
        ))}
        {network.nodes.map((node) => (
          <motion.circle
            key={node.id}
            cx={node.x}
            cy={node.y}
            r={node.size * 0.12}
            fill="url(#nodeGrad)"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: [0, 0.6, 0.3], scale: [0, 1.2, 1] }}
            transition={{
              duration: 1.5,
              delay: node.delay,
              ease: "easeOut",
            }}
          />
        ))}
        {/* Travelling data pulses */}
        {network.edges.slice(0, 8).map((edge, i) => (
          <motion.circle
            key={`pulse-${edge.id}`}
            r="0.25"
            fill="#6366f1"
            initial={{ cx: edge.x1, cy: edge.y1, opacity: 0 }}
            animate={{
              cx: [edge.x1, edge.x2],
              cy: [edge.y1, edge.y2],
              opacity: [0, 0.8, 0],
            }}
            transition={{
              duration: 2.5 + i * 0.3,
              delay: 2 + edge.delay,
              repeat: Infinity,
              repeatDelay: 3 + i * 0.5,
              ease: "linear",
            }}
          />
        ))}
        <defs>
          <linearGradient id="edgeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#a855f7" stopOpacity="0.2" />
          </linearGradient>
          <radialGradient id="nodeGrad">
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
          </radialGradient>
        </defs>
      </svg>
    </div>
  );
}

/* ================================================================== */
/*  AMBIENT GRID BACKGROUND                                            */
/* ================================================================== */
function AmbientGrid() {
  return (
    <div className="absolute inset-0 overflow-hidden opacity-[0.04]">
      <svg className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern
            id="grid"
            width="60"
            height="60"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 60 0 L 0 0 0 60"
              fill="none"
              stroke="#6366f1"
              strokeWidth="0.5"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
    </div>
  );
}

/* ================================================================== */
/*  BREATHING RADIAL GRADIENT                                          */
/* ================================================================== */
function BreathingGlow() {
  return (
    <motion.div
      className="absolute"
      style={{
        width: 800,
        height: 800,
        borderRadius: "50%",
        background:
          "radial-gradient(circle, rgba(99,102,241,0.12) 0%, rgba(59,130,246,0.06) 30%, transparent 70%)",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      }}
      animate={{
        opacity: [0.4, 0.8, 0.4],
        scale: [0.95, 1.08, 0.95],
      }}
      transition={{
        duration: 6,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    />
  );
}

/* ================================================================== */
/*  HORIZONTAL SCROLLING TICKER                                        */
/* ================================================================== */
function ScrollingTicker() {
  const text =
    "XGBoost  \u00B7  MLflow  \u00B7  Apache Airflow  \u00B7  SHAP  \u00B7  Real-time Forecasting  \u00B7  600+ Stations  \u00B7  Drift Detection  \u00B7  Bias Monitoring";
  // Repeat for seamless loop
  const repeated = `${text}  \u00B7  ${text}  \u00B7  ${text}  \u00B7  ${text}`;

  return (
    <div className="absolute bottom-8 left-0 right-0 overflow-hidden pointer-events-none">
      <motion.div
        className="whitespace-nowrap text-sm font-mono tracking-widest"
        style={{ opacity: 0.25, color: "#818cf8" }}
        animate={{ x: ["0%", "-50%"] }}
        transition={{
          duration: 40,
          repeat: Infinity,
          ease: "linear",
        }}
      >
        {repeated}
      </motion.div>
    </div>
  );
}

/* ================================================================== */
/*  STAT CARDS                                                         */
/* ================================================================== */
const stats = [
  { icon: MapPin, label: "Stations", value: "600+", color: "#3b82f6", glow: "59,130,246" },
  { icon: Activity, label: "Predictions/hr", value: "14K+", color: "#22c55e", glow: "34,197,94" },
  { icon: BarChart3, label: "Uptime", value: "99.9%", color: "#a855f7", glow: "168,85,247" },
  { icon: Zap, label: "Data Refresh", value: "Hourly", color: "#06b6d4", glow: "6,182,212" },
];

function StatCard({
  stat,
  index,
  visible,
}: {
  stat: (typeof stats)[number];
  index: number;
  visible: boolean;
}) {
  const Icon = stat.icon;
  const [hovered, setHovered] = useState(false);

  return (
    <motion.div
      className="relative rounded-2xl overflow-hidden cursor-default"
      initial={{ opacity: 0, y: 40, scale: 0.85 }}
      animate={
        visible
          ? { opacity: 1, y: 0, scale: 1 }
          : { opacity: 0, y: 40, scale: 0.85 }
      }
      transition={{
        duration: 0.6,
        delay: index * 0.12,
        type: "spring",
        stiffness: 180,
        damping: 18,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      whileHover={{ scale: 1.04, y: -2 }}
    >
      {/* Gradient border effect */}
      <motion.div
        className="absolute inset-0 rounded-2xl"
        style={{
          background: hovered
            ? `linear-gradient(135deg, ${stat.color}40, transparent 40%, transparent 60%, ${stat.color}30)`
            : "transparent",
          padding: "1px",
        }}
        animate={{
          opacity: hovered ? 1 : 0,
        }}
        transition={{ duration: 0.3 }}
      />

      {/* Card body */}
      <div
        className="relative rounded-2xl p-6 h-full"
        style={{
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          background: "rgba(255,255,255,0.04)",
          border: hovered
            ? `1px solid rgba(${stat.glow},0.25)`
            : "1px solid rgba(255,255,255,0.08)",
          transition: "border-color 0.3s ease",
        }}
      >
        {/* Icon with colored glow */}
        <div className="relative mx-auto mb-3 w-fit">
          <div
            className="absolute inset-0 rounded-full blur-lg"
            style={{
              background: `rgba(${stat.glow},0.25)`,
              transform: "scale(2.5)",
            }}
          />
          <Icon
            className="relative mx-auto h-6 w-6"
            style={{ color: stat.color }}
          />
        </div>

        {/* Inner glow */}
        <motion.div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[60%] h-[1px]"
          style={{
            background: `linear-gradient(90deg, transparent, rgba(${stat.glow},0.4), transparent)`,
          }}
          animate={{
            opacity: hovered ? 1 : 0.3,
          }}
          transition={{ duration: 0.3 }}
        />

        <p className="text-2xl font-bold text-text-primary tracking-tight">
          {stat.value}
        </p>
        <p className="text-xs text-text-secondary mt-1 uppercase tracking-wider">
          {stat.label}
        </p>
      </div>
    </motion.div>
  );
}

/* ================================================================== */
/*  PREMIUM CTA BUTTON                                                 */
/* ================================================================== */
function CTAButton({
  visible,
  onClick,
}: {
  visible: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="mt-12"
          initial={{ opacity: 0, y: 25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
        >
          <motion.button
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            className="group relative inline-flex items-center gap-3 rounded-full px-10 py-5 text-base font-semibold text-white overflow-hidden"
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
          >
            {/* Animated gradient background */}
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{
                background:
                  "linear-gradient(135deg, #3b82f6 0%, #7c3aed 33%, #06b6d4 66%, #3b82f6 100%)",
                backgroundSize: "300% 300%",
              }}
              animate={{
                backgroundPosition: hovered
                  ? ["0% 50%", "100% 50%"]
                  : "0% 50%",
              }}
              transition={{
                duration: 2,
                repeat: hovered ? Infinity : 0,
                ease: "linear",
              }}
            />

            {/* Glow behind button */}
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{
                background:
                  "linear-gradient(135deg, #3b82f6 0%, #7c3aed 50%, #06b6d4 100%)",
                filter: "blur(20px)",
              }}
              animate={{
                opacity: hovered ? 0.7 : 0.35,
                scale: hovered ? 1.15 : 1,
              }}
              transition={{ duration: 0.3 }}
            />

            {/* Animated border */}
            <motion.div
              className="absolute inset-[1px] rounded-full"
              style={{
                border: "1px solid rgba(255,255,255,0.15)",
              }}
              animate={{
                borderColor: hovered
                  ? "rgba(255,255,255,0.35)"
                  : "rgba(255,255,255,0.15)",
              }}
              transition={{ duration: 0.3 }}
            />

            {/* Pulse ring animation */}
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{
                border: "1px solid rgba(99,102,241,0.4)",
              }}
              animate={{
                scale: [1, 1.15, 1],
                opacity: [0.4, 0, 0.4],
              }}
              transition={{
                duration: 2.5,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />

            <span className="relative z-10 tracking-wide">
              Command Center
            </span>
            <motion.span
              className="relative z-10"
              animate={{ x: hovered ? 4 : 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              <ArrowRight className="h-6 w-6" />
            </motion.span>
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ================================================================== */
/*  WORD-BY-WORD STAGGER TEXT                                          */
/* ================================================================== */
function StaggerWords({
  text,
  className,
  visible,
  staggerDelay = 0.08,
  startDelay = 0,
}: {
  text: string;
  className?: string;
  visible: boolean;
  staggerDelay?: number;
  startDelay?: number;
}) {
  const words = text.split(" ");
  return (
    <span className={className}>
      {words.map((word, i) => (
        <motion.span
          key={i}
          className="inline-block"
          initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
          animate={
            visible
              ? { opacity: 1, y: 0, filter: "blur(0px)" }
              : { opacity: 0, y: 12, filter: "blur(4px)" }
          }
          transition={{
            duration: 0.45,
            delay: startDelay + i * staggerDelay,
            ease: "easeOut",
          }}
        >
          {word}
          {i < words.length - 1 ? "\u00A0" : ""}
        </motion.span>
      ))}
    </span>
  );
}

/* ================================================================== */
/*  PHASE DEFINITIONS                                                  */
/* ================================================================== */
type Phase = 0 | 1 | 2 | 3 | 4 | 5;

/* ================================================================== */
/*  MAIN HERO SPLASH                                                   */
/* ================================================================== */
export default function HeroSplash({ onEnter }: { onEnter: () => void }) {
  const [phase, setPhase] = useState<Phase>(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),   // Globe scales in
      setTimeout(() => setPhase(2), 1500),   // Scramble text decodes
      setTimeout(() => setPhase(3), 3000),   // Subtitle + tagline
      setTimeout(() => setPhase(4), 4000),   // Stat cards
      setTimeout(() => setPhase(5), 5000),   // CTA button
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const handleEnter = useCallback(() => {
    onEnter();
  }, [onEnter]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden"
      style={{
        background:
          "linear-gradient(135deg, #030712 0%, #0a0e1a 35%, #0f172a 100%)",
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.05 }}
      transition={{ duration: 0.6, ease: "easeInOut" }}
    >
      {/* ---- Background layers ---- */}
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.2 }}
      >
        <AmbientGrid />
        <NeuralBackground />
        <Particles />
        <BreathingGlow />
      </motion.div>

      {/* ---- Content ---- */}
      <div className="relative z-10 text-center max-w-3xl px-8">
        {/* Globe Orb */}
        <GlobeOrb visible={phase >= 1} />

        {/* Title - Scramble effect */}
        <div className="mb-4">
          <h1 className="text-5xl font-bold tracking-tight sm:text-7xl">
            <ScrambleText
              text="BlueForecast"
              className="bg-gradient-to-r from-blue-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent"
              trigger={phase >= 2}
              delay={0}
              duration={1800}
            />
          </h1>
        </div>

        {/* Subtitle - word stagger */}
        <div className="h-8 sm:h-10 mb-2">
          <p className="text-lg sm:text-xl text-text-secondary">
            <StaggerWords
              text="Predictive Operations Platform for the Bluebikes Ops Team"
              visible={phase >= 3}
              staggerDelay={0.07}
              startDelay={0}
            />
          </p>
        </div>

        {/* Tagline */}
        <div className="h-12 mb-2">
          <p className="text-sm text-text-secondary/60">
            <StaggerWords
              text="Built for operations staff and admins for real-time demand forecasting and faster refill."
              visible={phase >= 3}
              staggerDelay={0.03}
              startDelay={0.5}
            />
          </p>
        </div>

        {/* Stat cards */}
        <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {stats.map((stat, i) => (
            <StatCard
              key={stat.label}
              stat={stat}
              index={i}
              visible={phase >= 4}
            />
          ))}
        </div>

        {/* CTA Button */}
        <CTAButton visible={phase >= 5} onClick={handleEnter} />

        {/* Powered by line */}
        <AnimatePresence>
          {phase >= 5 && (
            <motion.p
              className="mt-5 text-xs text-text-secondary/40 tracking-wider uppercase"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.5 }}
            >
              Powered by XGBoost + MLflow + Apache Airflow
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* ---- Scrolling ticker ---- */}
      <ScrollingTicker />

      {/* ---- Bottom gradient fade ---- */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#030712] to-transparent pointer-events-none" />

      {/* ---- Top vignette ---- */}
      <div className="absolute top-0 left-0 right-0 h-40 bg-gradient-to-b from-[#030712]/60 to-transparent pointer-events-none" />
    </motion.div>
  );
}
