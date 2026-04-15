import type { Prediction } from "@/types";
import { mockStations } from "./stations";

const GENERATED_AT = "2026-04-15T03:36:04Z";
const MODEL_VERSION = 1;
const FORECAST_START = "2026-04-15T08:00:00-04:00";

/**
 * Demand multiplier curve for each hour of the day (0-23).
 * Simulates realistic bike-share usage with morning and evening peaks.
 */
const HOURLY_DEMAND_CURVE: Record<number, number> = {
  0: 0.08,
  1: 0.05,
  2: 0.03,
  3: 0.02,
  4: 0.02,
  5: 0.05,
  6: 0.15,
  7: 0.45,
  8: 0.85,    // morning peak
  9: 0.65,
  10: 0.40,
  11: 0.35,
  12: 0.45,   // lunch bump
  13: 0.40,
  14: 0.35,
  15: 0.40,
  16: 0.55,
  17: 0.90,   // evening peak
  18: 0.80,   // evening peak
  19: 0.55,
  20: 0.35,
  21: 0.25,
  22: 0.18,
  23: 0.12,
};

/**
 * Simple seeded pseudo-random number generator for deterministic output.
 */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function generatePredictions(): Prediction[] {
  const predictions: Prediction[] = [];
  const startDate = new Date("2026-04-15T12:00:00Z"); // 8 AM EDT = 12:00 UTC

  for (const station of mockStations) {
    // Capacity-based scaling: higher capacity stations see more demand
    const capacityScale = station.capacity / 20; // normalise around 20-dock station

    // Each station gets a slightly different random seed for variety
    const stationSeed = parseInt(station.station_id.replace("A32", ""), 10);
    const rand = seededRandom(stationSeed * 7919);

    for (let h = 0; h < 24; h++) {
      const forecastDate = new Date(startDate.getTime() + h * 60 * 60 * 1000);

      // Hour of day in EST (UTC-5)
      const hourOfDay = (forecastDate.getUTCHours() - 5 + 24) % 24;

      // Scale to match real data range: max ~2.55, avg ~0.32
      const baseDemand = HOURLY_DEMAND_CURVE[hourOfDay] * 0.38;

      // Add some noise: +/- 15%
      const noise = 1 + (rand() - 0.5) * 0.3;
      const demand = Math.max(0, Math.round(baseDemand * noise * 100) / 100);

      // Format forecast hour in EST (ISO 8601 with offset)
      const estHour = forecastDate.getUTCHours() - 5;
      const forecastISO = formatESTDate(forecastDate);

      predictions.push({
        station_id: station.station_id,
        forecast_hour: forecastISO,
        predicted_demand: demand,
        model_version: MODEL_VERSION,
        generated_at: GENERATED_AT,
      });
    }
  }

  return predictions;
}

/**
 * Format a UTC Date as an ISO string in EST (UTC-5).
 */
function formatESTDate(utcDate: Date): string {
  const est = new Date(utcDate.getTime() - 5 * 60 * 60 * 1000);
  const year = est.getUTCFullYear();
  const month = String(est.getUTCMonth() + 1).padStart(2, "0");
  const day = String(est.getUTCDate()).padStart(2, "0");
  const hours = String(est.getUTCHours()).padStart(2, "0");
  const minutes = String(est.getUTCMinutes()).padStart(2, "0");
  const seconds = String(est.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}-05:00`;
}

export const mockPredictions: Prediction[] = generatePredictions();
