import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { inventoryBalances, transfers } from "@/db/schema";
import {
  InsufficientInventoryError,
  ForbiddenError,
  ValidationError,
  toAppError,
} from "@/server/errors";
import {
  applyMovement,
  findBalanceDrift,
  getBalances,
  recordAdjustment,
  transferStock,
} from "@/server/inventory";
import { balanceOf, createActor, expectDbError, seedReference, type Reference } from "./helpers";

let ref: Reference;

beforeEach(async () => {
  ref = await seedReference();
});

async function stock(depotId: string, itemCode: string, qty: number) {
  await db.transaction((tx) =>
    applyMovement(tx, { depotId, itemCode, delta: qty, entryType: "production" }),
  );
}

describe("inventory ledger", () => {
  it("never lets concurrent withdrawals drive a balance negative (SELECT … FOR UPDATE)", async () => {
    const depot = ref.depots.LSP!;
    await stock(depot, "O2", 100);
    const attempts = Array.from({ length: 12 }, () =>
      db
        .transaction((tx) =>
          applyMovement(tx, { depotId: depot, itemCode: "O2", delta: -15, entryType: "delivery" }),
        )
        .then(
          () => "ok" as const,
          (err) => {
            expect(err).toBeInstanceOf(InsufficientInventoryError);
            return "rejected" as const;
          },
        ),
    );
    const outcomes = await Promise.all(attempts);
    expect(outcomes.filter((o) => o === "ok")).toHaveLength(6);
    expect(outcomes.filter((o) => o === "rejected")).toHaveLength(6);
    expect(await balanceOf(depot, "O2")).toBe(10);
    const [row] = await db
      .select()
      .from(inventoryBalances)
      .where(eq(inventoryBalances.depotId, depot));
    expect(row!.quantity).toBe(10);
    expect(await findBalanceDrift()).toEqual([]);
  });

  it("rejects withdrawals from empty stock and leaves no stray rows", async () => {
    await expect(
      db.transaction((tx) =>
        applyMovement(tx, {
          depotId: ref.depots.LSP!,
          itemCode: "TI",
          delta: -1,
          entryType: "delivery",
        }),
      ),
    ).rejects.toBeInstanceOf(InsufficientInventoryError);
    const rows = await db.select().from(inventoryBalances);
    expect(rows).toHaveLength(0);
  });

  it("has a database backstop against negative balances", async () => {
    await stock(ref.depots.LSP!, "FE", 5);
    await expectDbError(
      db.execute(sql`UPDATE inventory_balances SET quantity = -1`),
      /balance_non_negative|reserved_within_balance/,
    );
  });

  it("makes the ledger append-only", async () => {
    await stock(ref.depots.LSP!, "FE", 5);
    await expectDbError(db.execute(sql`UPDATE ledger_entries SET quantity = 500`), /append-only/);
    await expectDbError(db.execute(sql`DELETE FROM ledger_entries`), /append-only/);
  });

  it("keeps the audit log append-only but lets user erasure null the actor", async () => {
    const operator = await createActor("operator");
    await recordAdjustment(operator, {
      depotId: ref.depots.LSP!,
      itemCode: "FE",
      delta: 3,
      reason: "Audit trail test",
    });
    await expectDbError(db.execute(sql`UPDATE audit_log SET action = 'tampered'`), /append-only/);
    await expectDbError(db.execute(sql`DELETE FROM audit_log`), /append-only/);
    await db.execute(sql`DELETE FROM "user" WHERE id = ${operator.id}`);
    const rows = await db.execute<{ actor_id: string | null; actor_label: string }>(
      sql`SELECT actor_id, actor_label FROM audit_log`,
    );
    expect(rows.rows[0]!.actor_id).toBeNull();
    const ledger = await db.execute<{ actor_id: string | null }>(
      sql`SELECT actor_id FROM ledger_entries`,
    );
    expect(ledger.rows.every((r) => r.actor_id === null)).toBe(true);
  });

  it("requires a reason for adjustments and records the actor", async () => {
    const operator = await createActor("operator");
    await expect(
      recordAdjustment(operator, {
        depotId: ref.depots.LSP!,
        itemCode: "FE",
        delta: 10,
        reason: "",
      }),
    ).rejects.toThrow();
    await recordAdjustment(operator, {
      depotId: ref.depots.LSP!,
      itemCode: "FE",
      delta: 10,
      reason: "Initial stock count",
    });
    await expect(
      recordAdjustment(operator, {
        depotId: ref.depots.LSP!,
        itemCode: "FE",
        delta: -11,
        reason: "Write-off test",
      }),
    ).rejects.toBeInstanceOf(InsufficientInventoryError);
    expect(await balanceOf(ref.depots.LSP!, "FE")).toBe(10);
  });

  it("rejects fractional quantities of counted products", async () => {
    const operator = await createActor("operator");
    await expect(
      recordAdjustment(operator, {
        depotId: ref.depots.LSP!,
        itemCode: "FE-BEAM-3M",
        delta: 1.5,
        reason: "Count",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects sub-gram transfers as invalid input instead of a database error", async () => {
    const operator = await createActor("operator");
    await stock(ref.depots.LSP!, "O2", 10);
    const err = await transferStock(operator, {
      fromDepotId: ref.depots.LSP!,
      toDepotId: ref.depots["EML1-GW"]!,
      itemCode: "O2",
      quantity: 0.0004,
      transportMission: "Crumbs",
    }).catch((e: unknown) => e);
    expect(toAppError(err).status).toBe(422);
    expect(await db.select().from(transfers)).toHaveLength(0);
  });

  it("transfers stock between depots and records the transport Δv and cost", async () => {
    const operator = await createActor("operator");
    await stock(ref.depots.TRQ!, "O2", 1_000);
    const { transfer, plan } = await transferStock(operator, {
      fromDepotId: ref.depots.TRQ,
      toDepotId: ref.depots["EML1-GW"],
      itemCode: "O2",
      quantity: 400,
      transportMission: "Tug T-1 flight 7",
    });
    expect(plan.deltaVMs).toBe(2510);
    expect(transfer.deltaVMs).toBe(2510);
    expect(transfer.costCents).toBeGreaterThan(0);
    expect(transfer.propellantKg).toBeGreaterThan(0);
    expect(await balanceOf(ref.depots.TRQ!, "O2")).toBe(600);
    expect(await balanceOf(ref.depots["EML1-GW"]!, "O2")).toBe(400);
    const balances = await getBalances(operator);
    expect(balances.find((b) => b.depotCode === "EML1-GW" && b.itemCode === "O2")?.onHand).toBe(
      400,
    );
    await expect(
      transferStock(operator, {
        fromDepotId: ref.depots.TRQ,
        toDepotId: ref.depots["EML1-GW"],
        itemCode: "O2",
        quantity: 601,
        transportMission: "Too big",
      }),
    ).rejects.toBeInstanceOf(InsufficientInventoryError);
    expect(await db.select().from(transfers)).toHaveLength(1);
  });

  it("runs opposing concurrent transfers without deadlocking", async () => {
    const operator = await createActor("operator");
    await stock(ref.depots.TRQ!, "FE", 100);
    await stock(ref.depots.LSP!, "FE", 100);
    const jobs = Array.from({ length: 10 }, (_, i) =>
      transferStock(operator, {
        fromDepotId: i % 2 ? ref.depots.TRQ : ref.depots.LSP,
        toDepotId: i % 2 ? ref.depots.LSP : ref.depots.TRQ,
        itemCode: "FE",
        quantity: 5,
        transportMission: `Rover run ${i}`,
      }),
    );
    await Promise.all(jobs);
    expect(
      (await balanceOf(ref.depots.TRQ!, "FE")) + (await balanceOf(ref.depots.LSP!, "FE")),
    ).toBe(200);
    expect(await findBalanceDrift()).toEqual([]);
  });

  it("forbids customers and engineers from moving stock", async () => {
    const customer = await createActor("customer");
    const engineer = await createActor("engineer");
    const input = {
      depotId: ref.depots.LSP!,
      itemCode: "FE",
      delta: 10,
      reason: "Sneaky increase",
    };
    await expect(recordAdjustment(customer, input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordAdjustment(engineer, input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getBalances(customer)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
