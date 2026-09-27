import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bomLines, fabricationJobs, items, ledgerEntries, products } from "@/db/schema";
import { ConflictError, InsufficientInventoryError } from "@/server/errors";
import {
  cancelFabricationJob,
  completeFabricationJob,
  createFabricationJob,
  failFabricationJob,
  startFabricationJob,
} from "@/server/fabrication";
import { applyMovement, findBalanceDrift } from "@/server/inventory";
import type { Actor } from "@/server/authz";
import { balanceOf, createActor, seedReference, type Reference } from "./helpers";

let ref: Reference;
let operator: Actor;

async function stock(depotId: string, itemCode: string, qty: number) {
  await db.transaction((tx) =>
    applyMovement(tx, { depotId, itemCode, delta: qty, entryType: "production" }),
  );
}

beforeEach(async () => {
  ref = await seedReference();
  operator = await createActor("operator");
  // A two-input product to prove multi-line atomicity.
  await db.insert(items).values({
    code: "TEST-COMPOSITE",
    name: "Test composite panel",
    kind: "product",
    unit: "unit",
    unitMassKg: 20,
  });
  await db.insert(products).values({
    itemCode: "TEST-COMPOSITE",
    energyKWhPerUnit: 10,
    opsCostPerUnitCents: 1000,
    defaultDepotId: ref.depots.LSP,
  });
  await db.insert(bomLines).values([
    { productCode: "TEST-COMPOSITE", inputCode: "FE", qtyPerUnit: 12 },
    { productCode: "TEST-COMPOSITE", inputCode: "REGOLITH", qtyPerUnit: 9 },
  ]);
});

describe("fabrication jobs", () => {
  it("consumes BOM inputs on start and produces finished goods on completion", async () => {
    await stock(ref.depots.LSP!, "FE", 100);
    const job = await createFabricationJob(operator, {
      productCode: "FE-BEAM-3M",
      depotId: ref.depots.LSP,
      quantity: 2,
    });
    expect(job.status).toBe("queued");
    const started = await startFabricationJob(operator, job.id);
    expect(started.consumed).toEqual({ FE: 96 });
    expect(await balanceOf(ref.depots.LSP!, "FE")).toBe(4);
    const done = await completeFabricationJob(operator, job.id);
    expect(done.status).toBe("completed");
    expect(await balanceOf(ref.depots.LSP!, "FE-BEAM-3M")).toBe(2);
    const entries = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.fabricationJobId, job.id));
    expect(entries.map((e) => e.entryType).sort()).toEqual([
      "fabrication_consumption",
      "fabrication_output",
    ]);
    expect(await findBalanceDrift()).toEqual([]);
  });

  it("is atomic: if any input is short, nothing is consumed and the job stays queued", async () => {
    await stock(ref.depots.LSP!, "FE", 100);
    await stock(ref.depots.LSP!, "REGOLITH", 10);
    const job = await createFabricationJob(operator, {
      productCode: "TEST-COMPOSITE",
      depotId: ref.depots.LSP,
      quantity: 2,
    });
    await expect(startFabricationJob(operator, job.id)).rejects.toBeInstanceOf(
      InsufficientInventoryError,
    );
    expect(await balanceOf(ref.depots.LSP!, "FE")).toBe(100);
    expect(await balanceOf(ref.depots.LSP!, "REGOLITH")).toBe(10);
    const [row] = await db.select().from(fabricationJobs).where(eq(fabricationJobs.id, job.id));
    expect(row!.status).toBe("queued");
    expect(row!.startedAt).toBeNull();
    const entries = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.fabricationJobId, job.id));
    expect(entries).toHaveLength(0);
  });

  it("allows exactly one of several concurrent starts", async () => {
    await stock(ref.depots.LSP!, "FE", 1_000);
    const job = await createFabricationJob(operator, {
      productCode: "FE-BEAM-3M",
      depotId: ref.depots.LSP,
      quantity: 1,
    });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => startFabricationJob(operator, job.id)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await balanceOf(ref.depots.LSP!, "FE")).toBe(952);
  });

  it("enforces the state machine", async () => {
    await stock(ref.depots.LSP!, "FE", 100);
    const job = await createFabricationJob(operator, {
      productCode: "FE-BEAM-3M",
      depotId: ref.depots.LSP,
      quantity: 1,
    });
    await expect(completeFabricationJob(operator, job.id)).rejects.toBeInstanceOf(ConflictError);
    await startFabricationJob(operator, job.id);
    await expect(cancelFabricationJob(operator, job.id)).rejects.toBeInstanceOf(ConflictError);
    const failed = await failFabricationJob(operator, job.id, "Furnace breach");
    expect(failed.status).toBe("failed");
    expect(failed.failureReason).toBe("Furnace breach");
    // Inputs consumed at start are scrapped, not returned.
    expect(await balanceOf(ref.depots.LSP!, "FE")).toBe(52);
    await expect(completeFabricationJob(operator, job.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("lets queued jobs be cancelled without touching inventory", async () => {
    const job = await createFabricationJob(operator, {
      productCode: "LOX-100",
      depotId: ref.depots["EML1-GW"],
      quantity: 3,
    });
    const cancelled = await cancelFabricationJob(operator, job.id);
    expect(cancelled.status).toBe("cancelled");
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });
});
