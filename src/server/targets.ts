import "server-only";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { targets } from "@/db/schema";
import { SOURCE_TYPES } from "@/lib/models";
import { SbdbError, fetchSbdbTarget } from "@/lib/sbdb";
import { audit } from "./audit";
import { type Actor, ENGINEERING, STAFF_ROLES, assertRole } from "./authz";
import { NotFoundError, ServiceUnavailableError, ValidationError, ensureUuid } from "./errors";

export type Target = typeof targets.$inferSelect;

export async function listTargets(actor: Actor): Promise<Target[]> {
  assertRole(actor, STAFF_ROLES);
  return db.select().from(targets).orderBy(asc(targets.kind), asc(targets.name));
}

export async function getTarget(actor: Actor, id: string): Promise<Target> {
  assertRole(actor, STAFF_ROLES);
  ensureUuid(id, "Target");
  const [t] = await db.select().from(targets).where(eq(targets.id, id));
  if (!t) throw new NotFoundError("Target not found");
  return t;
}

export const sbdbImportSchema = z.object({
  designation: z.string().trim().min(1).max(40),
  sourceType: z
    .enum(SOURCE_TYPES)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "target";

/**
 * Imports (or refreshes) an NEA from JPL SBDB. The engineer may override the spectral-class
 * mapping; objects without a usable spectral class require an explicit composition model.
 */
export async function importTargetFromSbdb(
  actor: Actor,
  raw: unknown,
  fetchImpl?: typeof fetch,
): Promise<Target> {
  assertRole(actor, ENGINEERING);
  const input = sbdbImportSchema.parse(raw);
  let sb;
  try {
    sb = await fetchSbdbTarget(input.designation, fetchImpl);
  } catch (err) {
    if (err instanceof SbdbError) {
      if (/reach|HTTP 5/.test(err.message)) throw new ServiceUnavailableError(err.message);
      throw new ValidationError(err.message);
    }
    throw err;
  }
  const sourceType = input.sourceType ?? sb.sourceType;
  if (!sourceType) {
    throw new ValidationError(`${sb.mappingNote} Select a composition model and import again.`);
  }
  const values = {
    name: sb.name,
    kind: "nea" as const,
    sourceType,
    designation: sb.designation,
    spectralClass: sb.spectralClass,
    aAu: sb.aAu,
    e: sb.e,
    iDeg: sb.iDeg,
    hMag: sb.hMag,
    diameterKm: sb.diameterKm,
    elementsEpoch: sb.elementsEpoch,
    dataSource: "jpl_sbdb" as const,
    sourceNote: `Imported from JPL SBDB. ${input.sourceType ? "Composition model chosen manually." : sb.mappingNote} Composition values remain nominal planning values.`,
    refreshedAt: new Date(),
  };
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(targets)
      .values({
        ...values,
        slug: `${slugify(sb.designation)}-${Date.now().toString(36)}`,
        description: `${sb.orbitClass ?? "NEA"} imported from JPL SBDB.`,
      })
      .onConflictDoUpdate({ target: targets.designation, set: values })
      .returning();
    await audit(tx, actor, {
      action: "target.sbdb_import",
      entityType: "target",
      entityId: row!.id,
      metadata: { designation: sb.designation },
    });
    return row!;
  });
}
