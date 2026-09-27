import { z } from "zod";

/** Item codes a rig may report as output. */
export const TELEMETRY_OUTPUT_CODES = [
  "O2",
  "SI",
  "TI",
  "FE",
  "AL",
  "MG",
  "H2O",
  "REGOLITH",
] as const;
export const MAX_READINGS_PER_BATCH = 500;

export const telemetryReadingSchema = z
  .object({
    seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    timestamp: z.iso.datetime({ offset: true }),
    regolithProcessedKg: z.number().min(0).max(1_000_000),
    powerKw: z.number().min(0).max(100_000),
    temperatureC: z.number().min(-273.15).max(5_000),
    outputKg: z
      .partialRecord(z.enum(TELEMETRY_OUTPUT_CODES), z.number().min(0).max(1_000_000))
      .default({}),
  })
  .strict()
  .refine(
    (r) => {
      const processedOutputs = Object.entries(r.outputKg)
        .filter(([code]) => code !== "REGOLITH")
        .reduce((sum, [, kg]) => sum + (kg ?? 0), 0);
      return processedOutputs <= r.regolithProcessedKg + 1e-6;
    },
    {
      message: "Processed outputs cannot exceed the mass of regolith processed",
      path: ["outputKg"],
    },
  );

export const telemetryBatchSchema = z
  .object({
    readings: z.array(telemetryReadingSchema).min(1).max(MAX_READINGS_PER_BATCH),
  })
  .strict()
  .refine((b) => new Set(b.readings.map((r) => r.seq)).size === b.readings.length, {
    message: "Sequence numbers must be unique within a batch",
    path: ["readings"],
  });

export type TelemetryReading = z.infer<typeof telemetryReadingSchema>;
export type TelemetryBatch = z.infer<typeof telemetryBatchSchema>;

export interface RigLimits {
  ratedPowerKw: number;
  tempMinC: number;
  tempMaxC: number;
}

/** Out-of-range checks: readings are still accepted, but flagged for the rig-health job. */
export function detectAnomalies(r: TelemetryReading, limits: RigLimits, now: Date): string[] {
  const out: string[] = [];
  if (r.temperatureC < limits.tempMinC)
    out.push(`temperature ${r.temperatureC}°C below ${limits.tempMinC}°C`);
  if (r.temperatureC > limits.tempMaxC)
    out.push(`temperature ${r.temperatureC}°C above ${limits.tempMaxC}°C`);
  if (r.powerKw > limits.ratedPowerKw * 1.1)
    out.push(`power ${r.powerKw} kW exceeds 110% of rated ${limits.ratedPowerKw} kW`);
  if (new Date(r.timestamp).getTime() > now.getTime() + 5 * 60_000)
    out.push("timestamp is in the future (clock skew)");
  return out;
}
