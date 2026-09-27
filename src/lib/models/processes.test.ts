import { describe, expect, it } from "vitest";
import { COMPOSITION_MODELS, SOURCE_TYPES } from "./composition";
import {
  PROCESS_IDS,
  computeYields,
  getProcess,
  plantMassKg,
  processSuitability,
  recoveriesFor,
  throughputKgPerHour,
} from "./processes";
import { ModelInputError } from "./units";

describe("process catalogue", () => {
  it("keeps every recovery within [0, 1]", () => {
    for (const p of PROCESS_IDS) {
      for (const s of SOURCE_TYPES) {
        for (const v of Object.values(recoveriesFor(p, s))) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("defines positive energy, mass and a sane temperature window", () => {
    for (const p of PROCESS_IDS) {
      const m = getProcess(p);
      expect(m.specificEnergyKWhPerKg).toBeGreaterThan(0);
      expect(m.specificMassKgPerKw).toBeGreaterThan(0);
      expect(m.operatingTempC.max).toBeGreaterThan(m.operatingTempC.min);
    }
  });
});

describe("yield = mass processed × wt% × recovery", () => {
  it("applies the formula exactly for MRE on high-Ti mare", () => {
    const yields = computeYields("mre", "lunar_mare_high_ti", 10_000);
    const o = yields.find((y) => y.element === "O")!;
    expect(o.kg).toBeCloseTo((10_000 * 41.6 * 0.5) / 100, 3);
    const fe = yields.find((y) => y.element === "Fe")!;
    expect(fe.kg).toBeCloseTo((10_000 * 12.4 * 0.9) / 100, 3);
    expect(yields.map((y) => y.element).sort()).toEqual(["Fe", "O", "Si", "Ti"]);
  });

  it("scales linearly with mass processed", () => {
    const a = computeYields("mre", "lunar_highland", 1_000);
    const b = computeYields("mre", "lunar_highland", 3_000);
    a.forEach((y, i) => expect(b[i]!.kg).toBeCloseTo(3 * y.kg, 2));
  });

  it("returns zero yields for zero mass", () => {
    for (const y of computeYields("mre", "nea_s", 0)) expect(y.kg).toBe(0);
  });

  it("accepts survey wt% overrides", () => {
    const y = computeYields("mre", "lunar_mare_high_ti", 1_000, { Ti: 6 });
    expect(y.find((v) => v.element === "Ti")!.kg).toBeCloseTo((1_000 * 6 * 0.6) / 100, 3);
    expect(() => computeYields("mre", "lunar_mare_high_ti", 1_000, { Ti: 120 })).toThrow(
      ModelInputError,
    );
  });

  it("hydrogen reduction yields scale with ilmenite content", () => {
    const hi = computeYields("h2_ilmenite", "lunar_mare_high_ti", 1_000);
    const lo = computeYields("h2_ilmenite", "lunar_mare_low_ti", 1_000);
    const pick = (ys: typeof hi, el: string) => ys.find((y) => y.element === el)?.kg ?? 0;
    expect(pick(hi, "O")).toBeGreaterThan(pick(lo, "O"));
    expect(pick(hi, "Ti")).toBeGreaterThan(pick(lo, "Ti"));
    // Only ilmenite's single reducible oxygen is liberated: ~1–2% of feed mass for high-Ti mare.
    expect(pick(hi, "O") / 1_000).toBeGreaterThan(0.01);
    expect(pick(hi, "O") / 1_000).toBeLessThan(0.02);
    // Ti leaves in a TiO₂-rich residue, and cannot exceed the Ti hosted in ilmenite.
    const ilm = COMPOSITION_MODELS.lunar_mare_high_ti.ilmeniteWtPct.nominal;
    expect(pick(hi, "Ti")).toBeLessThanOrEqual((1_000 * ilm * 0.3156) / 100);
    expect(hi.find((y) => y.element === "Ti")!.form).toMatch(/TiO₂-rich residue/);
  });

  it("hydrogen reduction does nothing for ilmenite-free asteroids", () => {
    for (const y of computeYields("h2_ilmenite", "nea_m", 1_000)) expect(y.kg).toBe(0);
  });

  it("magnetic separation favours M-types over S-types and recovers only Fe", () => {
    const m = computeYields("magnetic_separation", "nea_m", 1_000);
    const s = computeYields("magnetic_separation", "nea_s", 1_000);
    expect(m).toHaveLength(1);
    expect(m[0]!.element).toBe("Fe");
    expect(m[0]!.kg).toBeGreaterThan(s[0]!.kg);
  });

  it("volatiles extraction recovers water only from C-types", () => {
    const c = computeYields("volatiles", "nea_c", 1_000);
    expect(c[0]!.element).toBe("H2O");
    expect(c[0]!.kg).toBeCloseTo(1_000 * 0.1 * 0.7, 3);
    expect(computeYields("volatiles", "lunar_highland", 1_000)[0]!.kg).toBe(0);
  });
});

describe("plant sizing", () => {
  it("throughput = power / specific energy", () => {
    expect(throughputKgPerHour("mre", 320)).toBeCloseTo(100, 9);
  });

  it("plant mass = base + power × (process + power-system kg/kW)", () => {
    expect(plantMassKg("mre", 100, 15)).toBe(1500 + 100 * (8 + 15));
  });

  it("rejects non-positive power", () => {
    expect(() => throughputKgPerHour("mre", 0)).toThrow(ModelInputError);
    expect(() => plantMassKg("mre", -5, 10)).toThrow(ModelInputError);
  });

  it("warns about unsuitable feedstocks", () => {
    expect(processSuitability("volatiles", "lunar_highland").length).toBeGreaterThan(0);
    expect(processSuitability("h2_ilmenite", "lunar_mare_low_ti").join(" ")).toMatch(/Ilmenite/);
    expect(processSuitability("mre", "lunar_mare_high_ti")).toEqual([]);
  });
});
