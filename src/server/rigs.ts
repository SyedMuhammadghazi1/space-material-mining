import "server-only";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { alerts, depots, missions, rigApiKeys, rigs, telemetryReadings } from "@/db/schema";
import { PROCESS_IDS, getProcess } from "@/lib/models";
import { audit } from "./audit";
import { generateRigKey, hashRigKey } from "./api-keys";
import { type Actor, OPERATIONS, STAFF_ROLES, assertRole } from "./authz";
import { ConflictError, NotFoundError, ensureUuid } from "./errors";

export const rigSchema = z.object({
  missionId: z.uuid(),
  name: z.string().trim().min(2).max(80),
  processId: z.enum(PROCESS_IDS),
  ratedPowerKw: z.coerce.number().positive().max(100_000),
  depotId: z
    .uuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export async function createRig(actor: Actor, raw: unknown) {
  assertRole(actor, OPERATIONS);
  const input = rigSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [mission] = await tx.select().from(missions).where(eq(missions.id, input.missionId));
    if (!mission) throw new NotFoundError("Mission not found");
    const depotId = input.depotId ?? mission.depotId;
    const [depot] = await tx.select({ id: depots.id }).from(depots).where(eq(depots.id, depotId));
    if (!depot) throw new NotFoundError("Depot not found");
    const temps = getProcess(input.processId).operatingTempC;
    const [rig] = await tx
      .insert(rigs)
      .values({
        missionId: mission.id,
        depotId,
        name: input.name,
        processId: input.processId,
        ratedPowerKw: input.ratedPowerKw,
        tempMinC: temps.min,
        tempMaxC: temps.max,
      })
      .returning();
    await audit(tx, actor, {
      action: "rig.create",
      entityType: "rig",
      entityId: rig!.id,
      metadata: { name: input.name, missionId: mission.id },
    });
    return rig!;
  });
}

/** Issues a new API key for a rig. The plaintext is returned ONCE and never stored. */
export async function issueRigKey(actor: Actor, rigId: string, label?: string) {
  assertRole(actor, OPERATIONS);
  ensureUuid(rigId, "Rig");
  return db.transaction(async (tx) => {
    const [rig] = await tx.select().from(rigs).where(eq(rigs.id, rigId));
    if (!rig) throw new NotFoundError("Rig not found");
    if (rig.status !== "active") throw new ConflictError("Retired rigs cannot receive keys");
    const key = generateRigKey();
    const [row] = await tx
      .insert(rigApiKeys)
      .values({
        rigId,
        keyPrefix: key.prefix,
        keyHash: key.hash,
        label: label?.slice(0, 80) ?? null,
        createdBy: actor.id,
      })
      .returning({
        id: rigApiKeys.id,
        keyPrefix: rigApiKeys.keyPrefix,
        createdAt: rigApiKeys.createdAt,
      });
    await audit(tx, actor, {
      action: "rig_key.issue",
      entityType: "rig_api_key",
      entityId: row!.id,
      metadata: { rigId, prefix: key.prefix },
    });
    return { ...row!, plaintext: key.plaintext };
  });
}

export async function revokeRigKey(actor: Actor, keyId: string) {
  assertRole(actor, OPERATIONS);
  ensureUuid(keyId, "Key");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(rigApiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(rigApiKeys.id, keyId), isNull(rigApiKeys.revokedAt)))
      .returning({ id: rigApiKeys.id, rigId: rigApiKeys.rigId });
    if (!row) throw new NotFoundError("Active key not found");
    await audit(tx, actor, {
      action: "rig_key.revoke",
      entityType: "rig_api_key",
      entityId: row.id,
      metadata: { rigId: row.rigId },
    });
    return row;
  });
}

export async function retireRig(actor: Actor, rigId: string) {
  assertRole(actor, OPERATIONS);
  ensureUuid(rigId, "Rig");
  return db.transaction(async (tx) => {
    const [rig] = await tx
      .update(rigs)
      .set({ status: "retired" })
      .where(eq(rigs.id, rigId))
      .returning();
    if (!rig) throw new NotFoundError("Rig not found");
    await tx
      .update(rigApiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(rigApiKeys.rigId, rigId), isNull(rigApiKeys.revokedAt)));
    await tx
      .update(alerts)
      .set({ status: "resolved", resolvedAt: new Date() })
      .where(and(eq(alerts.rigId, rigId), eq(alerts.status, "open")));
    await audit(tx, actor, { action: "rig.retire", entityType: "rig", entityId: rigId });
    return rig;
  });
}

export type AuthenticatedRig = typeof rigs.$inferSelect & { keyId: string };

/** Resolves a plaintext bearer key to an active rig (null if unknown, revoked or retired). */
export async function authenticateRigKey(plaintext: string): Promise<AuthenticatedRig | null> {
  const [row] = await db
    .select({ rig: rigs, keyId: rigApiKeys.id, revokedAt: rigApiKeys.revokedAt })
    .from(rigApiKeys)
    .innerJoin(rigs, eq(rigs.id, rigApiKeys.rigId))
    .where(eq(rigApiKeys.keyHash, hashRigKey(plaintext)));
  if (!row || row.revokedAt || row.rig.status !== "active") return null;
  return { ...row.rig, keyId: row.keyId };
}

export async function listRigs(actor: Actor) {
  assertRole(actor, STAFF_ROLES);
  return db
    .select({
      id: rigs.id,
      name: rigs.name,
      processId: rigs.processId,
      status: rigs.status,
      ratedPowerKw: rigs.ratedPowerKw,
      lastSeenAt: rigs.lastSeenAt,
      lastSeq: rigs.lastSeq,
      missionName: missions.name,
      depotName: depots.name,
      openAlerts: sql<number>`(SELECT count(*)::int FROM alerts a WHERE a.rig_id = ${rigs.id} AND a.status = 'open')`,
      activeKeys: sql<number>`(SELECT count(*)::int FROM rig_api_keys k WHERE k.rig_id = ${rigs.id} AND k.revoked_at IS NULL)`,
    })
    .from(rigs)
    .innerJoin(missions, eq(missions.id, rigs.missionId))
    .innerJoin(depots, eq(depots.id, rigs.depotId))
    .orderBy(desc(rigs.createdAt));
}

export async function getRigDetail(actor: Actor, rigId: string) {
  assertRole(actor, STAFF_ROLES);
  ensureUuid(rigId, "Rig");
  const [rig] = await db
    .select({ rig: rigs, missionName: missions.name, depotName: depots.name })
    .from(rigs)
    .innerJoin(missions, eq(missions.id, rigs.missionId))
    .innerJoin(depots, eq(depots.id, rigs.depotId))
    .where(eq(rigs.id, rigId));
  if (!rig) throw new NotFoundError("Rig not found");
  const [keys, readings, rigAlerts, [{ total } = { total: 0 }]] = await Promise.all([
    db
      .select({
        id: rigApiKeys.id,
        keyPrefix: rigApiKeys.keyPrefix,
        label: rigApiKeys.label,
        createdAt: rigApiKeys.createdAt,
        lastUsedAt: rigApiKeys.lastUsedAt,
        revokedAt: rigApiKeys.revokedAt,
      })
      .from(rigApiKeys)
      .where(eq(rigApiKeys.rigId, rigId))
      .orderBy(desc(rigApiKeys.createdAt)),
    db
      .select()
      .from(telemetryReadings)
      .where(eq(telemetryReadings.rigId, rigId))
      .orderBy(desc(telemetryReadings.seq))
      .limit(25),
    db
      .select()
      .from(alerts)
      .where(eq(alerts.rigId, rigId))
      .orderBy(desc(alerts.createdAt))
      .limit(20),
    db.select({ total: count() }).from(telemetryReadings).where(eq(telemetryReadings.rigId, rigId)),
  ]);
  return { ...rig, keys, readings, alerts: rigAlerts, readingCount: total };
}
