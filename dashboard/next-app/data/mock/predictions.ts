import type { Prediction } from "@/types";
import { mockStations } from "./stations";
import type { StationType } from "./stations";

const GENERATED_AT = new Date(Date.now() - 12 * 60 * 1000).toISOString(); // generated ~12 min ago
const MODEL_VERSION = 1;

// ── Demand curves by station type ────────────────────────────────────────────
// Values represent avg pickups per hour as a multiplier; scaled per station below.
// transit_hub : sharp twin peaks (8–9am, 5–6pm), dead overnight
// university  : strong weekday AM peak, flat evenings, almost zero weekends
// tourist     : midday plateau, weekend > weekday, low overnight
// residential : inverse commuter (outflow AM → bikes leave, inflow PM → bikes return)
// medical     : steady 7am–6pm, small lunch dip, no commuter spike
// low_cap     : gentle bell, low overall, capped by small capacity

const DEMAND_CURVES: Record<StationType, number[]> = {
  //                   0     1     2     3     4     5     6     7     8     9    10    11
  transit_hub:   [0.04, 0.02, 0.01, 0.01, 0.02, 0.08, 0.30, 0.75, 1.00, 0.60, 0.38, 0.32,
  //             12    13    14    15    16    17    18    19    20    21    22    23
                  0.35, 0.30, 0.28, 0.42, 0.68, 1.00, 0.85, 0.52, 0.28, 0.18, 0.10, 0.06],

  university:    [0.02, 0.01, 0.01, 0.01, 0.02, 0.06, 0.22, 0.62, 0.88, 0.55, 0.38, 0.34,
                  0.36, 0.32, 0.30, 0.34, 0.46, 0.72, 0.60, 0.38, 0.22, 0.14, 0.08, 0.04],

  tourist:       [0.03, 0.02, 0.01, 0.01, 0.02, 0.04, 0.10, 0.18, 0.28, 0.42, 0.65, 0.80,
                  0.85, 0.80, 0.75, 0.70, 0.62, 0.50, 0.40, 0.30, 0.20, 0.14, 0.08, 0.05],

  residential:   [0.03, 0.02, 0.01, 0.01, 0.02, 0.06, 0.18, 0.50, 0.72, 0.42, 0.28, 0.25,
                  0.30, 0.28, 0.26, 0.32, 0.45, 0.68, 0.55, 0.38, 0.25, 0.16, 0.10, 0.05],

  medical:       [0.02, 0.01, 0.01, 0.01, 0.02, 0.06, 0.20, 0.55, 0.70, 0.65, 0.60, 0.55,
                  0.48, 0.55, 0.62, 0.60, 0.55, 0.45, 0.30, 0.18, 0.10, 0.06, 0.04, 0.02],

  low_cap:       [0.02, 0.01, 0.01, 0.01, 0.01, 0.03, 0.08, 0.15, 0.22, 0.18, 0.16, 0.18,
                  0.20, 0.18, 0.16, 0.18, 0.22, 0.25, 0.20, 0.14, 0.10, 0.06, 0.04, 0.02],
};

// Peak demand (pickups/hr at 100% curve) per station type
const PEAK_DEMAND: Record<StationType, number> = {
  transit_hub: 12,
  university:  8,
  tourist:     6,
  residential: 5,
  medical:     5,
  low_cap:     2,
};

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function generatePredictions(): Prediction[] {
  const predictions: Prediction[] = [];

  // Anchor forecast to the current hour so timestamps look live
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const startUTC = now;

  for (const station of mockStations) {
    const stationSeed = parseInt(station.station_id.replace("A32", ""), 10);
    const rand = seededRandom(stationSeed * 7919);
    const curve = DEMAND_CURVES[station.type];
    const peak = PEAK_DEMAND[station.type] * (station.capacity / 24); // scale by capacity

    for (let h = 0; h < 24; h++) {
      const forecastDate = new Date(startUTC.getTime() + h * 60 * 60 * 1000);
      const hourOfDay = forecastDate.getHours();

      const base = curve[hourOfDay] * peak;
      const noise = 1 + (rand() - 0.5) * 0.18; // ±9% noise
      const demand = Math.max(0, Math.round(base * noise * 100) / 100);

      const iso = forecastDate.toISOString();

      predictions.push({
        station_id: station.station_id,
        forecast_hour: iso,
        predicted_demand: demand,
        model_version: MODEL_VERSION,
        generated_at: GENERATED_AT,
      });
    }
  }

  return predictions;
}

export const mockPredictions: Prediction[] = generatePredictions();
