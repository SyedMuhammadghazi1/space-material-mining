import { describe, expect, it } from "vitest";
import {
  InfeasibleTransferError,
  leoMassPerDeliveredKg,
  massRatio,
  propellantForPayload,
  propellantPerKgPayload,
  tsiolkovskyDeltaV,
} from "./rocket";
import { G0, ModelInputError } from "./units";

describe("Tsiolkovsky rocket equation", () => {
  it("mass ratio is 1 for zero Δv", () => {
    expect(massRatio(0, 450)).toBe(1);
  });

  it("mass ratio is e when Δv equals exhaust velocity", () => {
    expect(massRatio(450 * G0, 450)).toBeCloseTo(Math.E, 12);
  });

  it("round-trips Δv → propellant → Δv with zero tankage", () => {
    const payload = 1000;
    const dv = 3770;
    const prop = propellantForPayload(payload, dv, 450, 0);
    expect(tsiolkovskyDeltaV(450, payload + prop, payload)).toBeCloseTo(dv, 6);
  });

  it("round-trips including the stage dry mass", () => {
    const payload = 500;
    const sigma = 0.1;
    const dv = 2510;
    const prop = propellantForPayload(payload, dv, 360, sigma);
    const dry = sigma * prop;
    expect(tsiolkovskyDeltaV(360, payload + prop + dry, payload + dry)).toBeCloseTo(dv, 6);
  });

  it("higher Isp needs less propellant", () => {
    expect(propellantPerKgPayload(4000, 450, 0.1)).toBeLessThan(
      propellantPerKgPayload(4000, 320, 0.1),
    );
  });

  it("propellant grows monotonically with Δv", () => {
    let prev = -1;
    for (let dv = 0; dv <= 8000; dv += 500) {
      const p = propellantPerKgPayload(dv, 450, 0.1);
      expect(p).toBeGreaterThan(prev);
      prev = p;
    }
  });

  it("flags transfers a single stage cannot achieve", () => {
    expect(() => propellantPerKgPayload(12_000, 320, 0.1)).toThrow(InfeasibleTransferError);
  });

  it("rejects nonsense inputs", () => {
    expect(() => massRatio(-1, 450)).toThrow(ModelInputError);
    expect(() => massRatio(100, 0)).toThrow(ModelInputError);
    expect(() => propellantPerKgPayload(100, 450, 1)).toThrow(ModelInputError);
    expect(() => tsiolkovskyDeltaV(450, 10, 20)).toThrow(ModelInputError);
  });
});

describe("gear ratio (LEO mass per delivered kg)", () => {
  it("is exactly 1 for LEO itself", () => {
    expect(leoMassPerDeliveredKg(0, 450, 0.1)).toBe(1);
  });

  it("is ~5 for the lunar surface with LOX/LH2 and 10% tankage", () => {
    const g = leoMassPerDeliveredKg(5910, 450, 0.1);
    expect(g).toBeGreaterThan(4.5);
    expect(g).toBeLessThan(6);
  });
});
