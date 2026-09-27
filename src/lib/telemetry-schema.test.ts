import { describe, expect, it } from "vitest";
import { detectAnomalies, telemetryBatchSchema } from "./telemetry-schema";

const reading = (over: Record<string, unknown> = {}) => ({
  seq: 1,
  timestamp: "2026-09-01T00:00:00Z",
  regolithProcessedKg: 100,
  powerKw: 180,
  temperatureC: 1600,
  outputKg: { O2: 20, FE: 10 },
  ...over,
});

describe("telemetry batch schema", () => {
  it("accepts a valid batch", () => {
    expect(
      telemetryBatchSchema.safeParse({ readings: [reading(), reading({ seq: 2 })] }).success,
    ).toBe(true);
  });

  it("rejects empty and oversized batches", () => {
    expect(telemetryBatchSchema.safeParse({ readings: [] }).success).toBe(false);
    const many = Array.from({ length: 501 }, (_, i) => reading({ seq: i }));
    expect(telemetryBatchSchema.safeParse({ readings: many }).success).toBe(false);
  });

  it("rejects duplicate seqs, negative masses, unknown materials and extra fields", () => {
    expect(telemetryBatchSchema.safeParse({ readings: [reading(), reading()] }).success).toBe(
      false,
    );
    expect(
      telemetryBatchSchema.safeParse({ readings: [reading({ regolithProcessedKg: -1 })] }).success,
    ).toBe(false);
    expect(
      telemetryBatchSchema.safeParse({ readings: [reading({ outputKg: { GOLD: 1 } })] }).success,
    ).toBe(false);
    expect(telemetryBatchSchema.safeParse({ readings: [reading({ extra: true })] }).success).toBe(
      false,
    );
    expect(telemetryBatchSchema.safeParse({ readings: [reading({ seq: 1.5 })] }).success).toBe(
      false,
    );
    expect(
      telemetryBatchSchema.safeParse({ readings: [reading({ timestamp: "yesterday" })] }).success,
    ).toBe(false);
  });

  it("enforces mass conservation for processed outputs (excavated regolith exempt)", () => {
    expect(
      telemetryBatchSchema.safeParse({ readings: [reading({ outputKg: { O2: 90, FE: 20 } })] })
        .success,
    ).toBe(false);
    expect(
      telemetryBatchSchema.safeParse({ readings: [reading({ outputKg: { REGOLITH: 500 } })] })
        .success,
    ).toBe(true);
  });
});

describe("anomaly detection", () => {
  const limits = { ratedPowerKw: 200, tempMinC: 1500, tempMaxC: 1750 };
  const now = new Date("2026-09-01T00:00:00Z");

  it("flags nothing for nominal readings", () => {
    const r = telemetryBatchSchema.parse({ readings: [reading()] }).readings[0]!;
    expect(detectAnomalies(r, limits, now)).toEqual([]);
  });

  it("flags temperature, power and clock skew", () => {
    const hot = telemetryBatchSchema.parse({ readings: [reading({ temperatureC: 1900 })] })
      .readings[0]!;
    const cold = telemetryBatchSchema.parse({ readings: [reading({ temperatureC: 20 })] })
      .readings[0]!;
    const power = telemetryBatchSchema.parse({ readings: [reading({ powerKw: 260 })] })
      .readings[0]!;
    const future = telemetryBatchSchema.parse({
      readings: [reading({ timestamp: "2026-09-01T01:00:00Z" })],
    }).readings[0]!;
    expect(detectAnomalies(hot, limits, now)[0]).toMatch(/above/);
    expect(detectAnomalies(cold, limits, now)[0]).toMatch(/below/);
    expect(detectAnomalies(power, limits, now)[0]).toMatch(/exceeds/);
    expect(detectAnomalies(future, limits, now)[0]).toMatch(/future/);
  });
});
