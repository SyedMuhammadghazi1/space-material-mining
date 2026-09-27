import { describe, expect, it } from "vitest";
import { DEFAULT_ECONOMICS_PARAMS } from "@/lib/models";
import { DEFAULT_SCENARIO_FORM, scenarioParamsSchema, toEconomicsParams } from "./scenario-input";

describe("scenario form conversion", () => {
  it("round-trips the defaults to the model's canonical units", () => {
    const params = toEconomicsParams(scenarioParamsSchema.parse(DEFAULT_SCENARIO_FORM));
    expect(params.launchCostPerKgCents).toBe(DEFAULT_ECONOMICS_PARAMS.launchCostPerKgCents);
    expect(params.uptimeFraction).toBeCloseTo(DEFAULT_ECONOMICS_PARAMS.uptimeFraction, 12);
    expect(params.opsCostPerYearCents).toBe(DEFAULT_ECONOMICS_PARAMS.opsCostPerYearCents);
  });

  it("coerces form strings and converts dollars to integer cents", () => {
    const parsed = scenarioParamsSchema.parse({
      ...DEFAULT_SCENARIO_FORM,
      salePricePerKgUsd: "1234.567",
      powerKw: "150",
    });
    const params = toEconomicsParams(parsed);
    expect(params.salePricePerKgCents).toBe(123457);
    expect(params.powerKw).toBe(150);
  });

  it("rejects out-of-range values", () => {
    expect(
      scenarioParamsSchema.safeParse({ ...DEFAULT_SCENARIO_FORM, uptimePercent: 0 }).success,
    ).toBe(false);
    expect(
      scenarioParamsSchema.safeParse({ ...DEFAULT_SCENARIO_FORM, deliveryNode: "MARS" }).success,
    ).toBe(false);
    expect(
      scenarioParamsSchema.safeParse({ ...DEFAULT_SCENARIO_FORM, missionDurationDays: 99999 })
        .success,
    ).toBe(false);
  });
});
