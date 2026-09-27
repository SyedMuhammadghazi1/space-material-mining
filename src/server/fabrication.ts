import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { type Tx, db } from "@/db";
import { bomLines, depots, fabricationJobs, items, products } from "@/db/schema";
import { roundKg } from "@/lib/models";
import { audit } from "./audit";
import { type Actor, OPERATIONS, STAFF_ROLES, assertRole } from "./authz";
import { ConflictError, NotFoundError } from "./errors";
import { applyMovement, lockBalances } from "./inventory";

export const fabricationJobSchema = z.object({
  productCode: z.string().min(1).max(40),
  depotId: z.uuid(),
  quantity: z.coerce.number().int("Whole units only").min(1).max(10_000),
});

type JobStatus = (typeof fabricationJobs.$inferSelect)["status"];

export async function createFabricationJob(actor: Actor, raw: unknown) {
  assertRole(actor, OPERATIONS);
  const input = fabricationJobSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [product] = await tx
      .select()
      .from(products)
      .where(eq(products.itemCode, input.productCode));
    if (!product) throw new NotFoundError("Product not found");
    const [depot] = await tx
      .select({ id: depots.id })
      .from(depots)
      .where(eq(depots.id, input.depotId));
    if (!depot) throw new NotFoundError("Depot not found");
    const [job] = await tx
      .insert(fabricationJobs)
      .values({ ...input, createdBy: actor.id })
      .returning();
    await audit(tx, actor, {
      action: "fabrication.create",
      entityType: "fabrication_job",
      entityId: job!.id,
      metadata: input,
    });
    return job!;
  });
}

/** Atomically moves a job between states; concurrent callers lose the race with a 409. */
async function claim(
  tx: Tx,
  jobId: string,
  from: JobStatus,
  to: JobStatus,
  patch: Partial<typeof fabricationJobs.$inferInsert> = {},
) {
  const [job] = await tx
    .update(fabricationJobs)
    .set({ status: to, ...patch })
    .where(and(eq(fabricationJobs.id, jobId), eq(fabricationJobs.status, from)))
    .returning();
  if (!job) {
    const [exists] = await tx
      .select({ status: fabricationJobs.status })
      .from(fabricationJobs)
      .where(eq(fabricationJobs.id, jobId));
    if (!exists) throw new NotFoundError("Fabrication job not found");
    throw new ConflictError(
      `Job is ${exists.status.replace("_", " ")}, expected ${from.replace("_", " ")}`,
      "invalid_state",
    );
  }
  return job;
}

export async function getBom(productCode: string) {
  return db
    .select({ inputCode: bomLines.inputCode, qtyPerUnit: bomLines.qtyPerUnit })
    .from(bomLines)
    .where(eq(bomLines.productCode, productCode));
}

/**
 * queued → in_progress: consumes every BOM input in ONE transaction. If any input is short the
 * whole transaction rolls back — no partial consumption and the job stays queued.
 */
export async function startFabricationJob(actor: Actor, jobId: string) {
  assertRole(actor, OPERATIONS);
  return db.transaction(async (tx) => {
    const job = await claim(tx, jobId, "queued", "in_progress", { startedAt: new Date() });
    const bom = await tx.select().from(bomLines).where(eq(bomLines.productCode, job.productCode));
    if (bom.length === 0) throw new ConflictError("Product has no bill of materials");
    await lockBalances(
      tx,
      bom.map((l) => ({ depotId: job.depotId, itemCode: l.inputCode })),
    );
    const consumed: Record<string, number> = {};
    for (const line of [...bom].sort((a, b) => a.inputCode.localeCompare(b.inputCode))) {
      const qty = roundKg(line.qtyPerUnit * job.quantity);
      await applyMovement(tx, {
        depotId: job.depotId,
        itemCode: line.inputCode,
        delta: -qty,
        entryType: "fabrication_consumption",
        fabricationJobId: job.id,
        actorId: actor.id,
      });
      consumed[line.inputCode] = qty;
    }
    await audit(tx, actor, {
      action: "fabrication.start",
      entityType: "fabrication_job",
      entityId: job.id,
      metadata: { consumed },
    });
    return { job, consumed };
  });
}

/** in_progress → completed: finished goods are credited to the job's depot. */
export async function completeFabricationJob(actor: Actor, jobId: string) {
  assertRole(actor, OPERATIONS);
  return db.transaction(async (tx) => {
    const job = await claim(tx, jobId, "in_progress", "completed", { finishedAt: new Date() });
    await applyMovement(tx, {
      depotId: job.depotId,
      itemCode: job.productCode,
      delta: job.quantity,
      entryType: "fabrication_output",
      fabricationJobId: job.id,
      actorId: actor.id,
    });
    await audit(tx, actor, {
      action: "fabrication.complete",
      entityType: "fabrication_job",
      entityId: job.id,
      metadata: { produced: job.quantity },
    });
    return job;
  });
}

/** in_progress → failed: consumed inputs are treated as scrap (already debited at start). */
export async function failFabricationJob(actor: Actor, jobId: string, reason: string) {
  assertRole(actor, OPERATIONS);
  const clean = z.string().trim().min(3, "Give a failure reason").max(500).parse(reason);
  return db.transaction(async (tx) => {
    const job = await claim(tx, jobId, "in_progress", "failed", {
      finishedAt: new Date(),
      failureReason: clean,
    });
    await audit(tx, actor, {
      action: "fabrication.fail",
      entityType: "fabrication_job",
      entityId: job.id,
      metadata: { reason: clean },
    });
    return job;
  });
}

export async function cancelFabricationJob(actor: Actor, jobId: string) {
  assertRole(actor, OPERATIONS);
  return db.transaction(async (tx) => {
    const job = await claim(tx, jobId, "queued", "cancelled", { finishedAt: new Date() });
    await audit(tx, actor, {
      action: "fabrication.cancel",
      entityType: "fabrication_job",
      entityId: job.id,
    });
    return job;
  });
}

export async function listFabricationJobs(actor: Actor, limit = 100) {
  assertRole(actor, STAFF_ROLES);
  return db
    .select({
      id: fabricationJobs.id,
      productCode: fabricationJobs.productCode,
      productName: items.name,
      depotName: depots.name,
      quantity: fabricationJobs.quantity,
      status: fabricationJobs.status,
      failureReason: fabricationJobs.failureReason,
      createdAt: fabricationJobs.createdAt,
      startedAt: fabricationJobs.startedAt,
      finishedAt: fabricationJobs.finishedAt,
    })
    .from(fabricationJobs)
    .innerJoin(items, eq(items.code, fabricationJobs.productCode))
    .innerJoin(depots, eq(depots.id, fabricationJobs.depotId))
    .orderBy(desc(fabricationJobs.createdAt))
    .limit(limit);
}
