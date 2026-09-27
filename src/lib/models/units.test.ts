import { describe, expect, it } from "vitest";
import { ceilCents, roundCents, roundKg, roundTo } from "./units";

describe("rounding conventions", () => {
  it("rounds half away from zero, avoiding float artefacts", () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(-1.005, 2)).toBe(-1.01);
    expect(roundCents(2.5)).toBe(3);
    expect(roundCents(-2.5)).toBe(-3);
  });
  it("reports kg to the gram", () => {
    expect(roundKg(1.23456)).toBe(1.235);
  });
  it("ceils prices but ignores float noise", () => {
    expect(ceilCents(100.00000000001)).toBe(100);
    expect(ceilCents(100.2)).toBe(101);
  });
  it("never returns negative zero", () => {
    expect(Object.is(roundTo(-0.0001, 2), -0)).toBe(false);
  });
});
