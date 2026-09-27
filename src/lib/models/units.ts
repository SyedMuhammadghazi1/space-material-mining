/**
 * Physical constants and unit conventions shared by every planning model.
 *
 * Units used throughout `src/lib/models`:
 * - distance: metres (m) internally; astronomical units (AU) for orbital elements
 * - velocity / Δv: metres per second (m/s); reported values are rounded to whole m/s
 * - mass: kilograms (kg); reported values are rounded to grams (3 decimals)
 * - energy: kilowatt-hours (kWh); power: kilowatts (kW)
 * - money: integer US cents. Intermediate maths is floating point; every money value that leaves
 *   a model is rounded with `roundCents` (half away from zero) or `ceilCents` (prices — never
 *   undercharge).
 * - time: days for mission durations; years = days / 365.25
 */

/** Standard gravity, m/s² (exact by definition). */
export const G0 = 9.80665;
/** Astronomical unit, m (IAU 2012, exact). */
export const AU_M = 1.495978707e11;
/** Heliocentric gravitational parameter, m³/s². */
export const MU_SUN = 1.32712440018e20;
/** Geocentric gravitational parameter, m³/s². */
export const MU_EARTH = 3.986004418e14;
/** Earth equatorial radius, m (WGS-84). */
export const R_EARTH_M = 6_378_137;
/** Reference low Earth orbit altitude used by the models, m. */
export const LEO_ALTITUDE_M = 400_000;
/** Days per Julian year. */
export const DAYS_PER_YEAR = 365.25;
export const HOURS_PER_DAY = 24;
export const SECONDS_PER_DAY = 86_400;

export const degToRad = (deg: number): number => (deg * Math.PI) / 180;

/** Round half away from zero to `decimals` places, avoiding the classic 1.005 binary-float trap. */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** decimals;
  const shifted = Math.abs(value) * factor;
  const rounded = Math.round(Number(shifted.toPrecision(15)));
  return (Math.sign(value) * rounded) / factor || 0;
}

/** Masses are reported to the gram. */
export const roundKg = (kg: number): number => roundTo(kg, 3);
/** Δv values are reported to the whole metre per second. */
export const roundMs = (ms: number): number => roundTo(ms, 0);
/** Money: integer cents, half away from zero. */
export const roundCents = (cents: number): number => roundTo(cents, 0);
/** Prices: always round up to the next whole cent so a quote never undercharges. */
export function ceilCents(cents: number): number {
  // Guard against float noise such as 100.00000000001 → 101.
  const cleaned = Number(cents.toPrecision(12));
  return Math.ceil(cleaned);
}

export class ModelInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelInputError";
  }
}

export function assertFinitePositive(name: string, value: number, allowZero = false): void {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new ModelInputError(
      `${name} must be a finite ${allowZero ? "non-negative" : "positive"} number`,
    );
  }
}
