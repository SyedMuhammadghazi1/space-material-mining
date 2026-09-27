/**
 * Rocket-equation helpers — FIRST-ORDER PLANNING MODEL.
 *
 * Tsiolkovsky: Δv = Isp · g0 · ln(m0 / mf).
 *
 * A single expendable stage is modelled with a tankage (structural) fraction σ: the stage's dry
 * mass is σ × its propellant mass. For a payload m_p and mass ratio R = exp(Δv / (Isp·g0)):
 *
 *   m_prop = m_p · (R − 1) / (1 − σ·(R − 1))       (feasible only while σ·(R − 1) < 1)
 *
 * Staging, reuse, boil-off, gravity/steering losses and engine mass are ignored.
 */
import { G0, ModelInputError, assertFinitePositive } from "./units";

export class InfeasibleTransferError extends ModelInputError {
  constructor(deltaVMs: number, ispSeconds: number, tankageFraction: number) {
    super(
      `A single stage with Isp ${ispSeconds} s and tankage fraction ${tankageFraction} cannot deliver ` +
        `${Math.round(deltaVMs)} m/s of Δv — split the transfer or raise Isp.`,
    );
    this.name = "InfeasibleTransferError";
  }
}

export function exhaustVelocity(ispSeconds: number): number {
  assertFinitePositive("Isp", ispSeconds);
  return ispSeconds * G0;
}

/** m0/mf for a given Δv (m/s) and specific impulse (s). */
export function massRatio(deltaVMs: number, ispSeconds: number): number {
  assertFinitePositive("Δv", deltaVMs, true);
  return Math.exp(deltaVMs / exhaustVelocity(ispSeconds));
}

/** Δv (m/s) from initial and final mass. */
export function tsiolkovskyDeltaV(
  ispSeconds: number,
  initialMassKg: number,
  finalMassKg: number,
): number {
  assertFinitePositive("initial mass", initialMassKg);
  assertFinitePositive("final mass", finalMassKg);
  if (finalMassKg > initialMassKg)
    throw new ModelInputError("final mass cannot exceed initial mass");
  return exhaustVelocity(ispSeconds) * Math.log(initialMassKg / finalMassKg);
}

/** Propellant mass (kg) needed per kg of payload for one stage with tankage fraction σ. */
export function propellantPerKgPayload(
  deltaVMs: number,
  ispSeconds: number,
  tankageFraction = 0,
): number {
  if (!Number.isFinite(tankageFraction) || tankageFraction < 0 || tankageFraction >= 1) {
    throw new ModelInputError("tankage fraction must be in [0, 1)");
  }
  const r = massRatio(deltaVMs, ispSeconds);
  const denominator = 1 - tankageFraction * (r - 1);
  if (denominator <= 0) throw new InfeasibleTransferError(deltaVMs, ispSeconds, tankageFraction);
  return (r - 1) / denominator;
}

/** Propellant mass (kg) to push `payloadKg` through `deltaVMs`. */
export function propellantForPayload(
  payloadKg: number,
  deltaVMs: number,
  ispSeconds: number,
  tankageFraction = 0,
): number {
  assertFinitePositive("payload mass", payloadKg, true);
  return payloadKg * propellantPerKgPayload(deltaVMs, ispSeconds, tankageFraction);
}

/**
 * "Gear ratio": kg that must be placed in LEO for each kg delivered to a node `deltaVMs` away
 * (payload + propellant + expended stage dry mass). Equals 1 for LEO itself.
 */
export function leoMassPerDeliveredKg(
  deltaVMs: number,
  ispSeconds: number,
  tankageFraction = 0,
): number {
  const prop = propellantPerKgPayload(deltaVMs, ispSeconds, tankageFraction);
  return 1 + prop * (1 + tankageFraction);
}
