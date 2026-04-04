import type {
  StationStatus,
  RebalancingRoute,
  DemandHeatmapEntry,
} from "@/types";
import { mockStations } from "./stations";

// ---------------------------------------------------------------------------
// Helper – look up a station by ID (used for route building)
// ---------------------------------------------------------------------------
function stationById(id: string) {
  const s = mockStations.find((st) => st.station_id === id);
  if (!s) throw new Error(`Station ${id} not found`);
  return s;
}

// ---------------------------------------------------------------------------
// 1. Station Statuses
// ---------------------------------------------------------------------------

// We assign a hand-crafted fill_pct to every station so that the distribution
// matches the requested breakdown:
//   ~8 critical  (fill_pct < 15 % or > 90 %)
//   ~12 low      (15-30 %)
//   ~20 moderate  (30-70 %)
//   ~10 surplus   (70-90 %)

const fillAssignments: Record<string, number> = {
  // Critical – very empty (< 15 %)
  A32001: 8,   // Back Bay / Stuart St
  A32016: 10,  // Tremont St at West Brookline St (South End)
  A32035: 7,   // Downtown Crossing
  A32047: 5,   // Marine Park (South Boston)
  // Critical – overfull (> 90 %)
  A32007: 95,  // Harvard Square
  A32011: 93,  // Davis Square
  A32044: 92,  // Charlestown Navy Yard
  A32030: 94,  // Kenmore Square

  // Low (15-30 %)
  A32002: 18,  // Copley Square
  A32004: 22,  // Boylston St at Arlington St
  A32017: 20,  // Washington St at Lenox St
  A32019: 25,  // Harrison Ave
  A32037: 17,  // Post Office Square
  A32038: 28,  // Boston Common
  A32046: 24,  // Broadway T Station
  A32048: 19,  // L St at E Broadway
  A32049: 27,  // Seaport Blvd
  A32050: 22,  // Convention Center
  A32039: 16,  // Faneuil Hall
  A32042: 26,  // Paul Revere Park

  // Surplus (70-90 %)
  A32006: 85,  // MIT at Mass Ave
  A32008: 78,  // Central Square
  A32012: 82,  // Union Square
  A32013: 76,  // Porter Square
  A32021: 88,  // Packard's Corner
  A32022: 80,  // Harvard Ave at Brighton Ave
  A32031: 75,  // Fenway Park
  A32040: 83,  // North End – Hanover St
  A32041: 79,  // Lewis Wharf
  A32043: 77,  // Bunker Hill Monument

  // Moderate (30-70 %) – everything else
  A32003: 55,  // Newbury St
  A32005: 42,  // Commonwealth Ave at Gloucester
  A32009: 60,  // Kendall/MIT T
  A32010: 48,  // Cambridge Main Library
  A32014: 38,  // Teele Square
  A32015: 65,  // Magoun Square
  A32018: 50,  // Columbus Ave at Mass Ave
  A32020: 45,  // Peters Park
  A32023: 52,  // Allston Green District
  A32024: 58,  // Commonwealth Ave at Griggs
  A32025: 40,  // N Beacon St
  A32026: 62,  // Coolidge Corner
  A32027: 35,  // Brookline Village
  A32028: 44,  // Washington Square
  A32029: 68,  // JFK Crossing
  A32032: 53,  // Longwood Medical
  A32033: 47,  // Museum of Fine Arts
  A32034: 56,  // Northeastern University
  A32036: 41,  // South Station
  A32045: 63,  // Sullivan Square
};

function riskLevel(pct: number): StationStatus["risk_level"] {
  if (pct < 15 || pct > 90) return "critical";
  if (pct < 30) return "low";
  if (pct > 70) return "surplus";
  return "moderate";
}

export const mockStationStatuses: StationStatus[] = mockStations.map((s) => {
  const fill_pct = fillAssignments[s.station_id] ?? 50;
  const risk = riskLevel(fill_pct);
  const current_bikes = Math.round((s.capacity * fill_pct) / 100);

  // Demand and flow scaled by risk
  let predicted_demand_1h: number;
  let predicted_demand_6h: number;
  let net_flow_1h: number;

  switch (risk) {
    case "critical":
      predicted_demand_1h = +(Math.random() * 3 + 5).toFixed(1); // 5-8
      predicted_demand_6h = +(Math.random() * 4 + 4).toFixed(1); // 4-8
      net_flow_1h = fill_pct < 15 ? +(-Math.random() * 3 - 2).toFixed(1) : +(Math.random() * 2 + 1).toFixed(1);
      break;
    case "low":
      predicted_demand_1h = +(Math.random() * 2 + 3).toFixed(1); // 3-5
      predicted_demand_6h = +(Math.random() * 3 + 3).toFixed(1); // 3-6
      net_flow_1h = +(-Math.random() * 2 - 0.5).toFixed(1);
      break;
    case "surplus":
      predicted_demand_1h = +(Math.random() * 2 + 1).toFixed(1); // 1-3
      predicted_demand_6h = +(Math.random() * 2 + 2).toFixed(1); // 2-4
      net_flow_1h = +(Math.random() * 3 + 1).toFixed(1);
      break;
    default: // moderate
      predicted_demand_1h = +(Math.random() * 3 + 2).toFixed(1); // 2-5
      predicted_demand_6h = +(Math.random() * 3 + 2.5).toFixed(1); // 2.5-5.5
      net_flow_1h = +(Math.random() * 2 - 1).toFixed(1); // -1 to 1
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

// ---------------------------------------------------------------------------
// 2. Rebalancing Routes
// ---------------------------------------------------------------------------

// Route 1 – Truck Alpha (active): Cambridge/Somerville surplus → Downtown/South End critical
const alpha_pickups = ["A32007", "A32011", "A32012"]; // Harvard Sq, Davis Sq, Union Sq
const alpha_dropoffs = ["A32035", "A32016", "A32001"]; // Downtown Crossing, Tremont St, Back Bay

// Route 2 – Truck Beta (active): Fenway/Allston surplus → Back Bay critical/low
const beta_pickups = ["A32031", "A32021"]; // Fenway Park, Packard's Corner
const beta_dropoffs = ["A32002", "A32004"]; // Copley Square, Boylston at Arlington

// Route 3 – Truck Gamma (planned): Charlestown/North End surplus → South Boston critical
const gamma_pickups = ["A32043", "A32040"]; // Bunker Hill, North End Hanover
const gamma_dropoffs = ["A32047", "A32048", "A32046"]; // Marine Park, L St, Broadway T

function buildStop(
  id: string,
  action: "pickup" | "dropoff",
  bikes: number,
  order: number,
) {
  const s = stationById(id);
  return {
    station_id: s.station_id,
    station_name: s.station_name,
    lat: s.lat,
    lon: s.lon,
    action,
    bikes,
    order,
  };
}

export const mockRebalancingRoutes: RebalancingRoute[] = [
  {
    route_id: "RB-20260403-001",
    truck_id: "Truck Alpha",
    stops: [
      buildStop(alpha_pickups[0], "pickup", 10, 1),
      buildStop(alpha_pickups[1], "pickup", 8, 2),
      buildStop(alpha_pickups[2], "pickup", 6, 3),
      buildStop(alpha_dropoffs[0], "dropoff", 9, 4),
      buildStop(alpha_dropoffs[1], "dropoff", 8, 5),
      buildStop(alpha_dropoffs[2], "dropoff", 7, 6),
    ],
    total_distance_km: 8.5,
    estimated_duration_min: 35,
    bikes_moved: 24,
    status: "active",
  },
  {
    route_id: "RB-20260403-002",
    truck_id: "Truck Beta",
    stops: [
      buildStop(beta_pickups[0], "pickup", 9, 1),
      buildStop(beta_pickups[1], "pickup", 7, 2),
      buildStop(beta_dropoffs[0], "dropoff", 8, 3),
      buildStop(beta_dropoffs[1], "dropoff", 8, 4),
    ],
    total_distance_km: 5.2,
    estimated_duration_min: 22,
    bikes_moved: 16,
    status: "active",
  },
  {
    route_id: "RB-20260403-003",
    truck_id: "Truck Gamma",
    stops: [
      buildStop(gamma_pickups[0], "pickup", 10, 1),
      buildStop(gamma_pickups[1], "pickup", 10, 2),
      buildStop(gamma_dropoffs[0], "dropoff", 7, 3),
      buildStop(gamma_dropoffs[1], "dropoff", 6, 4),
      buildStop(gamma_dropoffs[2], "dropoff", 7, 5),
    ],
    total_distance_km: 7.1,
    estimated_duration_min: 30,
    bikes_moved: 20,
    status: "planned",
  },
];

// ---------------------------------------------------------------------------
// 3. Demand Heatmap   (7 days × 24 hours = 168 entries)
// ---------------------------------------------------------------------------

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function demandFor(day: string, hour: number): number {
  const isWeekend = day === "Sat" || day === "Sun";

  // Night: 0-5
  if (hour >= 0 && hour <= 5) {
    return +(Math.random() * 0.8 + 0.2).toFixed(1); // 0.2-1.0
  }

  if (isWeekend) {
    // Weekend early morning: 6-9
    if (hour >= 6 && hour <= 9) {
      return +(Math.random() * 2 + 1).toFixed(1); // 1-3
    }
    // Weekend midday peak: 10-15
    if (hour >= 10 && hour <= 15) {
      return +(Math.random() * 2 + 5).toFixed(1); // 5-7
    }
    // Weekend afternoon/evening: 16-20
    if (hour >= 16 && hour <= 20) {
      return +(Math.random() * 2 + 3).toFixed(1); // 3-5
    }
    // Weekend late evening: 21-23
    return +(Math.random() * 1.5 + 1).toFixed(1); // 1-2.5
  }

  // Weekday patterns
  // Early morning ramp-up: 6
  if (hour === 6) {
    return +(Math.random() * 1.5 + 2.5).toFixed(1); // 2.5-4
  }
  // Morning commute: 7-9
  if (hour >= 7 && hour <= 9) {
    return +(Math.random() * 3 + 6).toFixed(1); // 6-9
  }
  // Midday: 10-16
  if (hour >= 10 && hour <= 16) {
    return +(Math.random() * 2 + 3).toFixed(1); // 3-5
  }
  // Evening commute: 17-19
  if (hour >= 17 && hour <= 19) {
    return +(Math.random() * 3 + 7).toFixed(1); // 7-10
  }
  // Late evening: 20-23
  return +(Math.random() * 1.5 + 1.5).toFixed(1); // 1.5-3
}

export const mockDemandHeatmap: DemandHeatmapEntry[] = days.flatMap((day) =>
  Array.from({ length: 24 }, (_, hour) => ({
    hour,
    day,
    demand: demandFor(day, hour),
  })),
);
