import { describe, expect, it } from "vitest";
import {
  formatDeltaV,
  formatMass,
  formatMoney,
  formatQuantity,
  formatRelative,
  humanize,
} from "./format";

describe("formatting", () => {
  it("formats integer cents as dollars", () => {
    expect(formatMoney(123456)).toBe("$1,235");
    expect(formatMoney(1999)).toBe("$19.99");
    expect(formatMoney(123456, { exact: true })).toBe("$1,234.56");
    expect(formatMoney(2_500_000_000, { compact: true })).toBe("$25M");
    expect(formatMoney(null)).toBe("—");
  });
  it("formats masses with sensible units", () => {
    expect(formatMass(0.25)).toBe("250 g");
    expect(formatMass(12.34)).toBe("12.3 kg");
    expect(formatMass(25_000)).toBe("25 t");
    expect(formatQuantity(3, "unit")).toBe("3 units");
    expect(formatQuantity(1, "unit")).toBe("1 unit");
  });
  it("formats Δv and relative time", () => {
    expect(formatDeltaV(5910)).toBe("5.91 km/s");
    const now = new Date("2026-01-01T01:00:00Z");
    expect(formatRelative(new Date("2026-01-01T00:30:00Z"), now)).toBe("30 min ago");
    expect(formatRelative(null)).toBe("never");
    expect(humanize("awaiting_deposit")).toBe("Awaiting deposit");
  });
});
