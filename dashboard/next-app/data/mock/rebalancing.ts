import type {
  StationStatus,
  RebalancingRoute,
  DemandHeatmapEntry,
} from "@/types";
import { mockStations } from "./stations";

function stationById(id: string) {
  const s = mockStations.find((st) => st.station_id === id);
  if (!s) throw new Error(`Station ${id} not found`);
  return s;
}

function riskLevel(pct: number): StationStatus["risk_level"] {
  if (pct <= 10 || pct >= 92) return "critical";
  if (pct <= 25) return "low";
  if (pct >= 75) return "surplus";
  return "moderate";
}

// ── Fill assignments ──────────────────────────────────────────────────────────
// Designed to tell a story:
//   Transit hubs are being drained by morning commuters → critical/low
//   University/residential areas filled overnight → surplus
//   Tourist spots and low-cap stations mostly moderate
//   A handful of low-cap stations critically empty (ignored by ops teams)

const fillPct: Record<string, number> = {
  // ── CRITICAL: transit hubs draining fast (commuter departure wave) ──
  A32035: 5,   // Downtown Crossing — nearly empty, 2 bikes left on 35-dock station
  A32036: 8,   // South Station — imminent stockout
  A32009: 6,   // Kendall/MIT T — grad students cleared it out
  A32046: 9,   // Broadway T Station — critical

  // ── CRITICAL: surplus overflow (bikes arriving, no space) ──
  A32007: 97,  // Harvard Square — overfull, bikes being chained to fences
  A32011: 95,  // Davis Square — overflow
  A32044: 93,  // Charlestown Navy Yard — bikes piling up

  // ── LOW: draining toward critical within 2–3h ──
  A32001: 18,  // Back Bay — low, high predicted demand next 2h
  A32002: 14,  // Copley Square — near critical
  A32016: 20,  // Tremont St — South End residential drain
  A32038: 22,  // Boston Common — tourist arrivals not yet here
  A32013: 16,  // Porter Square — commuter drain

  // ── SURPLUS: bikes accumulating, need pickup ──
  A32006: 88,  // MIT — overnight return, students not commuting yet
  A32012: 85,  // Union Square — morning influx
  A32021: 90,  // Packard's Corner — near overflow
  A32030: 82,  // Kenmore Square — filling up
  A32031: 78,  // Fenway Park — pre-game bikes arrived early
  A32043: 80,  // Bunker Hill — tourist drop-offs
  A32041: 76,  // Lewis Wharf — waterfront leisure riders returning

  // ── MODERATE: healthy range ──
  A32003: 52,  // Newbury St
  A32004: 48,  // Boylston at Arlington
  A32005: 44,  // Commonwealth Ave at Gloucester
  A32008: 55,  // Central Square
  A32010: 50,  // Cambridge Main Library
  A32014: 40,  // Teele Square
  A32015: 58,  // Magoun Square
  A32017: 46,  // Washington St at Lenox
  A32018: 53,  // Columbus Ave at Mass Ave
  A32019: 38,  // Harrison Ave
  A32020: 42,  // Peters Park
  A32022: 60,  // Harvard Ave at Brighton
  A32023: 48,  // Allston Green District
  A32024: 45,  // Commonwealth Ave at Griggs
  A32025: 50,  // N Beacon St
  A32026: 62,  // Coolidge Corner
  A32027: 55,  // Brookline Village
  A32028: 40,  // Washington Square
  A32029: 58,  // JFK Crossing
  A32032: 65,  // Longwood Medical — steady clinical staff turnover
  A32033: 48,  // Museum of Fine Arts
  A32034: 52,  // Northeastern University
  A32037: 44,  // Post Office Square
  A32039: 58,  // Faneuil Hall
  A32040: 62,  // North End — Hanover St
  A32042: 38,  // Paul Revere Park
  A32045: 54,  // Sullivan Square
  A32047: 42,  // Marine Park
  A32048: 48,  // L St at E Broadway
  A32049: 55,  // Seaport Blvd
  A32050: 36,  // Convention Center
};

export const mockStationStatuses: StationStatus[] = mockStations.map((s) => {
  const fill_pct = fillPct[s.station_id] ?? 50;
  const risk = riskLevel(fill_pct);
  const current_bikes = Math.round((s.capacity * fill_pct) / 100);

  let predicted_demand_1h: number;
  let predicted_demand_6h: number;
  let net_flow_1h: number;

  switch (risk) {
    case "critical":
      if (fill_pct <= 10) {
        // Draining — high demand, negative net flow (bikes leaving faster than arriving)
        predicted_demand_1h = +(Math.random() * 3 + 6).toFixed(1);   // 6–9
        predicted_demand_6h = +(Math.random() * 5 + 18).toFixed(1);  // 18–23
        net_flow_1h         = +(-Math.random() * 3 - 3).toFixed(1);  // -3 to -6
      } else {
        // Overfull — low demand, positive net flow (bikes arriving, no room)
        predicted_demand_1h = +(Math.random() * 1.5 + 0.5).toFixed(1); // 0.5–2
        predicted_demand_6h = +(Math.random() * 4 + 4).toFixed(1);     // 4–8
        net_flow_1h         = +(Math.random() * 3 + 2).toFixed(1);     // 2–5
      }
      break;
    case "low":
      predicted_demand_1h = +(Math.random() * 2 + 4).toFixed(1);   // 4–6
      predicted_demand_6h = +(Math.random() * 4 + 10).toFixed(1);  // 10–14
      net_flow_1h         = +(-Math.random() * 2 - 1).toFixed(1);  // -1 to -3
      break;
    case "surplus":
      predicted_demand_1h = +(Math.random() * 1.5 + 1).toFixed(1); // 1–2.5
      predicted_demand_6h = +(Math.random() * 3 + 4).toFixed(1);   // 4–7
      net_flow_1h         = +(Math.random() * 2 + 1).toFixed(1);   // 1–3
      break;
    default: // moderate
      predicted_demand_1h = +(Math.random() * 3 + 2).toFixed(1);   // 2–5
      predicted_demand_6h = +(Math.random() * 4 + 5).toFixed(1);   // 5–9
      net_flow_1h         = +(Math.random() * 2 - 1).toFixed(1);   // -1 to 1
  }

  return {
    station_id: s.station_id,
    current_bikes,
    capacity: s.capacity,
    fill_pct,
    predicted_demand_1h,
    predicted_demand_6h,
    risk_level: risk,
    net_flow_1h,
  };
});

// ── Rebalancing Routes ────────────────────────────────────────────────────────
// Truck Alpha: URGENT — picking from Harvard/Davis/MIT surplus → Downtown/Kendall/South Station critical
// Truck Beta:  ACTIVE  — Charlestown/Fenway surplus → Back Bay/Copley low
// Truck Gamma: PLANNED — Union Sq/Packard's surplus → Broadway/Porter low

function buildStop(
  id: string,
  action: "pickup" | "dropoff",
  bikes: number,
  order: number,
) {
  const s = stationById(id);
  return { station_id: s.station_id, station_name: s.station_name, lat: s.lat, lon: s.lon, action, bikes, order };
}

export const mockRebalancingRoutes: RebalancingRoute[] = [
  {
    route_id: "RB-URGENT-001",
    truck_id: "Truck Alpha",
    stops: [
      buildStop("A32007", "pickup", 12, 1),  // Harvard Sq — 97% full → take 12
      buildStop("A32011", "pickup",  9, 2),  // Davis Sq — 95% full → take 9
      buildStop("A32035", "dropoff",10, 3),  // Downtown Crossing — 5% → drop 10 (priority)
      buildStop("A32036", "dropoff", 7, 4),  // South Station — 8% → drop 7
      buildStop("A32009", "dropoff", 4, 5),  // Kendall/MIT T — 6% → drop 4
    ],
    total_distance_km: 9.2,
    estimated_duration_min: 38,
    bikes_moved: 21,
    status: "active",
  },
  {
    route_id: "RB-ACTIVE-002",
    truck_id: "Truck Beta",
    stops: [
      buildStop("A32044", "pickup",  8, 1),  // Charlestown Navy Yard — 93% → take 8
      buildStop("A32031", "pickup",  6, 2),  // Fenway Park — 78% → take 6
      buildStop("A32001", "dropoff", 7, 3),  // Back Bay — 18% → drop 7
      buildStop("A32002", "dropoff", 5, 4),  // Copley Square — 14% → drop 5
      buildStop("A32013", "dropoff", 2, 5),  // Porter Square — 16% → drop 2
    ],
    total_distance_km: 7.4,
    estimated_duration_min: 30,
    bikes_moved: 14,
    status: "active",
  },
  {
    route_id: "RB-PLANNED-003",
    truck_id: "Truck Gamma",
    stops: [
      buildStop("A32012", "pickup",  8, 1),  // Union Square — 85% → take 8
      buildStop("A32021", "pickup",  6, 2),  // Packard's Corner — 90% → take 6
      buildStop("A32046", "dropoff", 6, 3),  // Broadway T — 9% → drop 6 (critical)
      buildStop("A32016", "dropoff", 5, 4),  // Tremont St — 20% → drop 5
      buildStop("A32038", "dropoff", 3, 5),  // Boston Common — 22% → drop 3
    ],
    total_distance_km: 6.8,
    estimated_duration_min: 28,
    bikes_moved: 14,
    status: "planned",
  },
];

// ── Demand Heatmap (7 days × 24 hours) ───────────────────────────────────────
// Weekdays: sharp AM (7–9) and PM (17–19) commuter peaks
// Weekends: midday leisure plateau, no commuter spikes
// Friday evening slightly elevated (social rides)

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function demandFor(day: string, hour: number): number {
  const isWeekend = day === "Sat" || day === "Sun";
  const isFriday  = day === "Fri";
  const r = () => Math.random();

  if (hour <= 5)  return +(r() * 0.6 + 0.1).toFixed(1);   // dead overnight: 0.1–0.7

  if (isWeekend) {
    if (hour <= 9)  return +(r() * 1.5 + 0.5).toFixed(1); // slow morning: 0.5–2
    if (hour <= 15) return +(r() * 3 + 5).toFixed(1);     // leisure plateau: 5–8
    if (hour <= 19) return +(r() * 2 + 3.5).toFixed(1);   // afternoon wind-down: 3.5–5.5
    return              +(r() * 1.5 + 1).toFixed(1);       // evening: 1–2.5
  }

  // Weekday
  if (hour === 6)  return +(r() * 2 + 2).toFixed(1);      // ramp-up: 2–4
  if (hour <= 9)   return +(r() * 3 + 7).toFixed(1);      // AM commute peak: 7–10
  if (hour <= 11)  return +(r() * 2 + 3).toFixed(1);      // post-rush taper: 3–5
  if (hour <= 13)  return +(r() * 2 + 4).toFixed(1);      // lunch bump: 4–6
  if (hour <= 16)  return +(r() * 2 + 3).toFixed(1);      // afternoon: 3–5
  if (hour <= 19)  {
    const base = isFriday ? 9 : 7.5;                       // Friday PM slightly higher
    return +(r() * 3 + base).toFixed(1);                   // PM commute peak: 7.5–11
  }
  if (hour <= 21)  return +(r() * 2 + 2).toFixed(1);      // evening taper: 2–4
  return               +(r() * 1 + 0.5).toFixed(1);        // late night: 0.5–1.5
}

export const mockDemandHeatmap: DemandHeatmapEntry[] = days.flatMap((day) =>
  Array.from({ length: 24 }, (_, hour) => ({
    hour,
    day,
    demand: demandFor(day, hour),
  })),
);
