import { describe, expect, it } from "vitest";
import {
  DEFAULT_ECONOMICS_PARAMS,
  type MissionEconomicsInput,
  annualSchedule,
  evaluateMissionEconomics,
  npv,
} from "./economics";
import { evaluateScenario } from "./scenario";
import { ModelInputError } from "./units";
import { MODEL_VERSION } from "./version";

const base: MissionEconomicsInput = {
  ...DEFAULT_ECONOMICS_PARAMS,
  deliveryNode: "EML1",
  sourceType: "lunar_mare_high_ti",
  processId: "mre",
  outboundDeltaVMs: 5910,
  returnDeltaVMs: 2510,
};

describe("NPV helpers", () => {
  it("builds annual periods with a pro-rated final year", () => {
    const s = annualSchedule(2.5, 10);
    expect(s.map((p) => p.fraction)).toEqual([1, 1, 0.5]);
    expect(s[0]!.factor).toBeCloseTo(1 / 1.1, 12);
  });

  it("equals undiscounted sum at 0%", () => {
    expect(npv(100, 30, 5, 0)).toBeCloseTo(50, 9);
  });

  it("discounts later cash flows", () => {
    expect(npv(0, 100, 3, 10)).toBeCloseTo(100 / 1.1 + 100 / 1.21 + 100 / 1.331, 9);
  });
});

describe("mission economics", () => {
  const r = evaluateMissionEconomics(base);

  it("stamps the model version", () => {
    expect(r.modelVersion).toBe(MODEL_VERSION);
  });

  it("derives production from power, uptime and duration", () => {
    const hours = base.missionDurationDays * 24 * base.uptimeFraction;
    expect(r.production.operatingHours).toBeCloseTo(hours, 1);
    expect(r.production.regolithProcessedKg).toBeCloseTo((base.powerKw / 3.2) * hours, 2);
    expect(r.production.deliveredKg).toBeCloseTo(r.production.totalRecoveredKg, 2);
  });

  it("returns integer cents for every money field", () => {
    const money = [
      ...Object.values(r.costs),
      r.unitEconomics.earthLaunchCostPerKgAtNodeCents,
      r.unitEconomics.costPerDeliveredKgCents!,
      r.finance.npvCents,
      r.finance.breakevenPricePerKgCents!,
      r.transport.transportCostPerKgCents,
    ];
    for (const m of money) expect(Number.isInteger(m)).toBe(true);
  });

  it("total cost is the sum of its parts (within rounding)", () => {
    const { hardwareCents, launchCents, opsCents, transportCents, totalCents, capexCents } =
      r.costs;
    expect(Math.abs(hardwareCents + launchCents - capexCents)).toBeLessThanOrEqual(1);
    expect(Math.abs(capexCents + opsCents + transportCents - totalCents)).toBeLessThanOrEqual(2);
  });

  it("NPV at the breakeven price is ~0", () => {
    const at = evaluateMissionEconomics({
      ...base,
      salePricePerKgCents: r.finance.breakevenPricePerKgCents!,
    });
    expect(Math.abs(at.finance.npvCents)).toBeLessThan(at.production.deliveredKg * 1); // < 1 cent per kg
  });

  it("NPV rises with sale price and falls with discount rate", () => {
    const cheap = evaluateMissionEconomics({ ...base, salePricePerKgCents: 100_000 });
    const dear = evaluateMissionEconomics({ ...base, salePricePerKgCents: 1_000_000 });
    expect(dear.finance.npvCents).toBeGreaterThan(cheap.finance.npvCents);
    const hiRate = evaluateMissionEconomics({
      ...base,
      salePricePerKgCents: 1_000_000,
      discountRatePercent: 25,
    });
    expect(hiRate.finance.npvCents).toBeLessThan(dear.finance.npvCents);
  });

  it("Earth comparison uses LEO launch price × gear ratio to the node", () => {
    expect(r.unitEconomics.earthGearRatio).toBeGreaterThan(2);
    const leo = evaluateMissionEconomics({ ...base, deliveryNode: "LEO", returnDeltaVMs: 5910 });
    expect(leo.unitEconomics.earthGearRatio).toBe(1);
    expect(leo.unitEconomics.earthLaunchCostPerKgAtNodeCents).toBe(base.launchCostPerKgCents);
  });

  it("in-space material at EML1 beats Earth launch under the default assumptions", () => {
    expect(r.unitEconomics.costRatioVsEarth!).toBeLessThan(1);
    expect(r.unitEconomics.savingsPerKgCents!).toBeGreaterThan(0);
  });

  it("cost per kg falls as the plant runs longer (capex amortisation)", () => {
    const short = evaluateMissionEconomics({ ...base, missionDurationDays: 365 });
    const long = evaluateMissionEconomics({ ...base, missionDurationDays: 3650 });
    expect(long.unitEconomics.costPerDeliveredKgCents!).toBeLessThan(
      short.unitEconomics.costPerDeliveredKgCents!,
    );
  });

  it("restricting product elements reduces delivered mass but not recovered mass", () => {
    const o2Only = evaluateMissionEconomics({ ...base, productElements: ["O"] });
    expect(o2Only.production.deliveredKg).toBeLessThan(r.production.deliveredKg);
    expect(o2Only.production.totalRecoveredKg).toBeCloseTo(r.production.totalRecoveredKg, 3);
  });

  it("reports null unit economics when nothing is recovered", () => {
    const none = evaluateMissionEconomics({ ...base, processId: "volatiles" });
    expect(none.production.deliveredKg).toBe(0);
    expect(none.unitEconomics.costPerDeliveredKgCents).toBeNull();
    expect(none.finance.breakevenPricePerKgCents).toBeNull();
    expect(none.warnings.length).toBeGreaterThan(0);
  });

  it("validates inputs", () => {
    expect(() => evaluateMissionEconomics({ ...base, uptimeFraction: 0 })).toThrow(ModelInputError);
    expect(() => evaluateMissionEconomics({ ...base, missionDurationDays: 0 })).toThrow(
      ModelInputError,
    );
    expect(() => evaluateMissionEconomics({ ...base, launchCostPerKgCents: 12.5 })).toThrow(
      ModelInputError,
    );
    expect(() => evaluateMissionEconomics({ ...base, discountRatePercent: -1 })).toThrow(
      ModelInputError,
    );
  });
});

describe("scenario evaluation", () => {
  const params = { ...DEFAULT_ECONOMICS_PARAMS, deliveryNode: "EML1" as const };

  it("wires lunar sites to the surface node", () => {
    const r = evaluateScenario(
      { kind: "lunar_site", sourceType: "lunar_mare_high_ti" },
      "mre",
      params,
    );
    expect(r.deltaV.outboundFromLeoMs).toBe(5910);
    expect(r.deltaV.returnToNodeMs).toBe(2510);
    expect(r.deltaV.nea).toBeNull();
  });

  it("wires NEAs through the patched-conic estimate", () => {
    const r = evaluateScenario(
      { kind: "nea", sourceType: "nea_c", aAu: 1.19, e: 0.19, iDeg: 5.88 },
      "volatiles",
      params,
    );
    expect(r.deltaV.nea).not.toBeNull();
    expect(r.deltaV.outboundFromLeoMs).toBe(r.deltaV.nea!.chosen.totalFromLeoMs);
    expect(r.production.yields[0]!.itemCode).toBe("H2O");
  });

  it("requires orbital elements for NEAs", () => {
    expect(() => evaluateScenario({ kind: "nea", sourceType: "nea_s" }, "mre", params)).toThrow(
      ModelInputError,
    );
  });
});
