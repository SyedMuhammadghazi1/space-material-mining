import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { rigApiKeys, rigs, telemetryReadings } from "@/db/schema";
import { roundKg } from "@/lib/models";
import { type TelemetryBatch, detectAnomalies } from "@/lib/telemetry-schema";
import { applyMovement } from "./inventory";
import type { AuthenticatedRig } from "./rigs";

export interface IngestResult {
  received: number;
  accepted: number;
  duplicates: number;
  anomalies: number;
  credited: Record<string, number>;
  lastSeq: number | null;
}

/**
 * Stores a telemetry batch and credits newly produced material to the rig's depot — all in one
 * transaction. Idempotent on (rig, seq): replayed readings hit the unique index, are skipped by
 * ON CONFLICT DO NOTHING and therefore never credited twice.
 */
export async function ingestTelemetry(
  rig: AuthenticatedRig,
  batch: TelemetryBatch,
  now = new Date(),
): Promise<IngestResult> {
  const limits = { ratedPowerKw: rig.ratedPowerKw, tempMinC: rig.tempMinC, tempMaxC: rig.tempMaxC };
  const rows = batch.readings.map((r) => ({
    rigId: rig.id,
    seq: r.seq,
    recordedAt: new Date(r.timestamp),
    receivedAt: now,
    regolithProcessedKg: roundKg(r.regolithProcessedKg),
    powerKw: r.powerKw,
    temperatureC: r.temperatureC,
    output: Object.fromEntries(Object.entries(r.outputKg).map(([k, v]) => [k, roundKg(v ?? 0)])),
    anomalies: detectAnomalies(r, limits, now),
  }));

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(telemetryReadings)
      .values(rows)
      .onConflictDoNothing({ target: [telemetryReadings.rigId, telemetryReadings.seq] })
      .returning({
        seq: telemetryReadings.seq,
        output: telemetryReadings.output,
        anomalies: telemetryReadings.anomalies,
      });

    const credited: Record<string, number> = {};
    for (const row of inserted) {
      for (const [code, kg] of Object.entries(row.output)) {
        if (kg > 0) credited[code] = roundKg((credited[code] ?? 0) + kg);
      }
    }

    const seqs = inserted.map((r) => r.seq);
    const seqFrom = seqs.length ? Math.min(...seqs) : null;
    const seqTo = seqs.length ? Math.max(...seqs) : null;
    for (const code of Object.keys(credited).sort()) {
      await applyMovement(tx, {
        depotId: rig.depotId,
        itemCode: code,
        delta: credited[code]!,
        entryType: "production",
        rigId: rig.id,
        metadata: { source: "telemetry", seqFrom, seqTo, readings: inserted.length },
      });
    }

    const [updated] = await tx
      .update(rigs)
      .set({
        lastSeenAt: now,
        lastSeq:
          seqTo === null ? rigs.lastSeq : sql`GREATEST(COALESCE(${rigs.lastSeq}, -1), ${seqTo})`,
      })
      .where(eq(rigs.id, rig.id))
      .returning({ lastSeq: rigs.lastSeq });
    await tx.update(rigApiKeys).set({ lastUsedAt: now }).where(eq(rigApiKeys.id, rig.keyId));

    return {
      received: rows.length,
      accepted: inserted.length,
      duplicates: rows.length - inserted.length,
      anomalies: inserted.filter((r) => r.anomalies.length > 0).length,
      credited,
      lastSeq: updated?.lastSeq ?? null,
    };
  });
}
