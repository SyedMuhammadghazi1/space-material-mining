import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { type Queryable, type Tx, db } from "@/db";
import { depots, inventoryBalances, items, ledgerEntries, transfers } from "@/db/schema";
import { getEnv } from "@/env";
import { nodeToNodeDeltaV, propellantForPayload, roundCents, roundKg } from "@/lib/models";
import { audit } from "./audit";
import { type Actor, OPERATIONS, STAFF_ROLES, assertRole } from "./authz";
import { InsufficientInventoryError, NotFoundError, ValidationError } from "./errors";

/** Transport stage assumptions for depot-to-depot transfers (see docs/ARCHITECTURE.md). */
export const TRANSFER_ISP_SECONDS = 450;
export const TRANSFER_TANKAGE_FRACTION = 0.1;

export type LedgerEntryType = (typeof ledgerEntries.$inferInsert)["entryType"];

export interface Movement {
  depotId: string;
  itemCode: string;
  /** Signed quantity: + adds stock, − removes stock. kg (to the gram) or whole units. */
  delta: number;
  entryType: LedgerEntryType;
  reason?: string | null;
  rigId?: string | null;
  transferId?: string | null;
  fabricationJobId?: string | null;
  orderId?: string | null;
  metadata?: Record<string, unknown>;
  actorId?: string | null;
  /** Withdraw from stock reserved for an order (deliveries) instead of free stock. */
  fromReserved?: boolean;
}

type BalanceKey = { depotId: string; itemCode: string };
const keyOf = (k: BalanceKey) => `${k.depotId}|${k.itemCode}`;

/**
 * Locks the balance rows for `keys` with SELECT … FOR UPDATE, creating missing rows first.
 * Rows are always locked in (depot, item) order so concurrent multi-row operations (transfers,
 * fabrication) cannot deadlock each other.
 */
export async function lockBalances(
  tx: Tx,
  keys: BalanceKey[],
): Promise<Map<string, { quantity: number; reserved: number }>> {
  const unique = [...new Map(keys.map((k) => [keyOf(k), k])).values()].sort((a, b) =>
    keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0,
  );
  if (unique.length === 0) return new Map();
  await tx
    .insert(inventoryBalances)
    .values(unique.map((k) => ({ ...k, quantity: 0, reserved: 0 })))
    .onConflictDoNothing();
  const out = new Map<string, { quantity: number; reserved: number }>();
  for (const k of unique) {
    const [row] = await tx
      .select({ quantity: inventoryBalances.quantity, reserved: inventoryBalances.reserved })
      .from(inventoryBalances)
      .where(
        and(eq(inventoryBalances.depotId, k.depotId), eq(inventoryBalances.itemCode, k.itemCode)),
      )
      .for("update");
    out.set(keyOf(k), row ?? { quantity: 0, reserved: 0 });
  }
  return out;
}

/**
 * Applies one stock movement inside a transaction: updates the locked balance projection and
 * appends the ledger entry. Withdrawals that would drive free (unreserved) stock negative throw
 * InsufficientInventoryError, and CHECK constraints backstop the rule at the database level.
 */
export async function applyMovement(
  tx: Tx,
  m: Movement,
): Promise<{ balanceAfter: number; entryId: number }> {
  const delta = roundKg(m.delta);
  if (!Number.isFinite(delta) || delta === 0)
    throw new ValidationError("Movement quantity must be non-zero");

  const locked = await lockBalances(tx, [m]);
  const current = locked.get(keyOf(m))!;
  let reservedDelta = 0;
  if (delta < 0) {
    const available = roundKg(
      m.fromReserved ? current.reserved : current.quantity - current.reserved,
    );
    if (available < -delta) throw new InsufficientInventoryError(m.itemCode, available, -delta);
    if (m.fromReserved) reservedDelta = delta;
  }

  const [updated] = await tx
    .update(inventoryBalances)
    .set({
      quantity: sql`${inventoryBalances.quantity} + ${delta}`,
      reserved: sql`${inventoryBalances.reserved} + ${reservedDelta}`,
      updatedAt: new Date(),
    })
    .where(
      and(eq(inventoryBalances.depotId, m.depotId), eq(inventoryBalances.itemCode, m.itemCode)),
    )
    .returning({ quantity: inventoryBalances.quantity });

  const [entry] = await tx
    .insert(ledgerEntries)
    .values({
      depotId: m.depotId,
      itemCode: m.itemCode,
      entryType: m.entryType,
      quantity: delta,
      balanceAfter: updated!.quantity,
      reason: m.reason ?? null,
      rigId: m.rigId ?? null,
      transferId: m.transferId ?? null,
      fabricationJobId: m.fabricationJobId ?? null,
      orderId: m.orderId ?? null,
      metadata: m.metadata ?? {},
      actorId: m.actorId ?? null,
    })
    .returning({ id: ledgerEntries.id });
  return { balanceAfter: updated!.quantity, entryId: entry!.id };
}

/** Moves free stock into the reserved bucket (no physical movement, so no ledger entry). */
export async function reserveStock(tx: Tx, key: BalanceKey, quantity: number): Promise<void> {
  const q = roundKg(quantity);
  const locked = await lockBalances(tx, [key]);
  const current = locked.get(keyOf(key))!;
  const available = roundKg(current.quantity - current.reserved);
  if (available < q) throw new InsufficientInventoryError(key.itemCode, available, q);
  await tx
    .update(inventoryBalances)
    .set({ reserved: sql`${inventoryBalances.reserved} + ${q}`, updatedAt: new Date() })
    .where(
      and(eq(inventoryBalances.depotId, key.depotId), eq(inventoryBalances.itemCode, key.itemCode)),
    );
}

export async function releaseReservation(tx: Tx, key: BalanceKey, quantity: number): Promise<void> {
  const q = roundKg(quantity);
  await lockBalances(tx, [key]);
  await tx
    .update(inventoryBalances)
    .set({
      reserved: sql`GREATEST(${inventoryBalances.reserved} - ${q}, 0)`,
      updatedAt: new Date(),
    })
    .where(
      and(eq(inventoryBalances.depotId, key.depotId), eq(inventoryBalances.itemCode, key.itemCode)),
    );
}

async function loadItem(q: Queryable, code: string) {
  const [item] = await q.select().from(items).where(eq(items.code, code));
  if (!item) throw new NotFoundError(`Unknown item ${code}`);
  return item;
}

async function loadDepot(q: Queryable, id: string) {
  const [depot] = await q.select().from(depots).where(eq(depots.id, id));
  if (!depot) throw new NotFoundError("Depot not found");
  return depot;
}

function assertQuantityForUnit(unit: "kg" | "unit", quantity: number) {
  if (unit === "unit" && !Number.isInteger(quantity)) {
    throw new ValidationError("Products are counted in whole units");
  }
}

// ---------------------------------------------------------------------------------------------
// Operator actions
// ---------------------------------------------------------------------------------------------

export const adjustmentSchema = z.object({
  depotId: z.uuid(),
  itemCode: z.string().min(1).max(40),
  delta: z.coerce
    .number()
    .refine((v) => Number.isFinite(v) && v !== 0, "Enter a non-zero quantity")
    .refine((v) => Math.abs(v) <= 1e9, "Quantity too large"),
  reason: z.string().trim().min(5, "Give a reason of at least 5 characters").max(500),
});

export async function recordAdjustment(actor: Actor, raw: unknown) {
  assertRole(actor, OPERATIONS);
  const input = adjustmentSchema.parse(raw);
  return db.transaction(async (tx) => {
    await loadDepot(tx, input.depotId);
    const item = await loadItem(tx, input.itemCode);
    assertQuantityForUnit(item.unit, input.delta);
    const res = await applyMovement(tx, {
      depotId: input.depotId,
      itemCode: input.itemCode,
      delta: input.delta,
      entryType: "adjustment",
      reason: input.reason,
      actorId: actor.id,
    });
    await audit(tx, actor, {
      action: "inventory.adjust",
      entityType: "ledger_entry",
      entityId: String(res.entryId),
      metadata: {
        depotId: input.depotId,
        itemCode: input.itemCode,
        delta: input.delta,
        reason: input.reason,
      },
    });
    return res;
  });
}

export const transferSchema = z
  .object({
    fromDepotId: z.uuid(),
    toDepotId: z.uuid(),
    itemCode: z.string().min(1).max(40),
    quantity: z.coerce.number().positive("Quantity must be positive").max(1e9),
    transportMission: z.string().trim().min(3, "Name the transport mission").max(120),
  })
  .refine((v) => v.fromDepotId !== v.toDepotId, {
    message: "Choose two different depots",
    path: ["toDepotId"],
  });

export interface TransferPlan {
  deltaVMs: number;
  transitDays: number;
  payloadKg: number;
  propellantKg: number;
  costCents: number;
}

export function planTransport(
  fromNode: Parameters<typeof nodeToNodeDeltaV>[0],
  toNode: Parameters<typeof nodeToNodeDeltaV>[1],
  payloadKg: number,
): TransferPlan {
  const leg = nodeToNodeDeltaV(fromNode, toNode);
  const propellantKg = propellantForPayload(
    payloadKg,
    leg.deltaVMs,
    TRANSFER_ISP_SECONDS,
    TRANSFER_TANKAGE_FRACTION,
  );
  return {
    deltaVMs: leg.deltaVMs,
    transitDays: leg.transitDays,
    payloadKg: roundKg(payloadKg),
    propellantKg: roundKg(propellantKg),
    costCents: roundCents(propellantKg * getEnv().IN_SPACE_PROPELLANT_COST_PER_KG_CENTS),
  };
}

/** Moves stock between depots, recording the transport mission and its Δv/propellant/cost. */
export async function transferStock(actor: Actor, raw: unknown) {
  assertRole(actor, OPERATIONS);
  const input = transferSchema.parse(raw);
  return db.transaction(async (tx) => {
    // Sequential on purpose: a transaction owns a single connection.
    const from = await loadDepot(tx, input.fromDepotId);
    const to = await loadDepot(tx, input.toDepotId);
    const item = await loadItem(tx, input.itemCode);
    assertQuantityForUnit(item.unit, input.quantity);
    const plan = planTransport(from.node, to.node, input.quantity * item.unitMassKg);
    await lockBalances(tx, [
      { depotId: from.id, itemCode: item.code },
      { depotId: to.id, itemCode: item.code },
    ]);
    const [transfer] = await tx
      .insert(transfers)
      .values({
        fromDepotId: from.id,
        toDepotId: to.id,
        itemCode: item.code,
        quantity: input.quantity,
        transportMission: input.transportMission,
        deltaVMs: plan.deltaVMs,
        propellantKg: plan.propellantKg,
        costCents: plan.costCents,
        createdBy: actor.id,
      })
      .returning();
    const meta = {
      transportMission: input.transportMission,
      deltaVMs: plan.deltaVMs,
      costCents: plan.costCents,
    };
    await applyMovement(tx, {
      depotId: from.id,
      itemCode: item.code,
      delta: -input.quantity,
      entryType: "transfer_out",
      transferId: transfer!.id,
      actorId: actor.id,
      metadata: meta,
    });
    await applyMovement(tx, {
      depotId: to.id,
      itemCode: item.code,
      delta: input.quantity,
      entryType: "transfer_in",
      transferId: transfer!.id,
      actorId: actor.id,
      metadata: meta,
    });
    await audit(tx, actor, {
      action: "inventory.transfer",
      entityType: "transfer",
      entityId: transfer!.id,
      metadata: { ...meta, itemCode: item.code, quantity: input.quantity },
    });
    return { transfer: transfer!, plan };
  });
}

// ---------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------

export interface BalanceRow {
  depotId: string;
  depotName: string;
  depotCode: string;
  itemCode: string;
  itemName: string;
  unit: "kg" | "unit";
  onHand: number;
  reserved: number;
  available: number;
}

/** Balances by depot and item, computed from the ledger (the source of truth). */
export async function getBalances(actor: Actor): Promise<BalanceRow[]> {
  assertRole(actor, STAFF_ROLES);
  const result = await db.execute<{
    depot_id: string;
    depot_name: string;
    depot_code: string;
    item_code: string;
    item_name: string;
    unit: "kg" | "unit";
    on_hand: string;
    reserved: string | null;
  }>(sql`
    SELECT l.depot_id, d.name AS depot_name, d.code AS depot_code, l.item_code, i.name AS item_name, i.unit,
           SUM(l.quantity) AS on_hand, MAX(b.reserved) AS reserved
    FROM ledger_entries l
    JOIN depots d ON d.id = l.depot_id
    JOIN items i ON i.code = l.item_code
    LEFT JOIN inventory_balances b ON b.depot_id = l.depot_id AND b.item_code = l.item_code
    GROUP BY l.depot_id, d.name, d.code, l.item_code, i.name, i.unit
    HAVING SUM(l.quantity) <> 0 OR MAX(b.reserved) > 0
    ORDER BY d.name, l.item_code
  `);
  return result.rows.map((r) => {
    const onHand = Number(r.on_hand);
    const reserved = Number(r.reserved ?? 0);
    return {
      depotId: r.depot_id,
      depotName: r.depot_name,
      depotCode: r.depot_code,
      itemCode: r.item_code,
      itemName: r.item_name,
      unit: r.unit,
      onHand,
      reserved,
      available: roundKg(onHand - reserved),
    };
  });
}

/** Rows where the locked projection disagrees with the ledger sum (should always be empty). */
export async function findBalanceDrift(q: Queryable = db) {
  const result = await q.execute<{
    depot_id: string;
    item_code: string;
    ledger: string;
    projection: string;
  }>(sql`
    SELECT b.depot_id, b.item_code, COALESCE(SUM(l.quantity), 0) AS ledger, b.quantity AS projection
    FROM inventory_balances b
    LEFT JOIN ledger_entries l ON l.depot_id = b.depot_id AND l.item_code = b.item_code
    GROUP BY b.depot_id, b.item_code, b.quantity
    HAVING COALESCE(SUM(l.quantity), 0) <> b.quantity
  `);
  return result.rows;
}

export async function listLedger(
  actor: Actor,
  opts: { depotId?: string; itemCode?: string; limit?: number } = {},
) {
  assertRole(actor, STAFF_ROLES);
  const conditions = [];
  if (opts.depotId) conditions.push(eq(ledgerEntries.depotId, opts.depotId));
  if (opts.itemCode) conditions.push(eq(ledgerEntries.itemCode, opts.itemCode));
  return db
    .select({
      id: ledgerEntries.id,
      createdAt: ledgerEntries.createdAt,
      depotName: depots.name,
      itemCode: ledgerEntries.itemCode,
      entryType: ledgerEntries.entryType,
      quantity: ledgerEntries.quantity,
      balanceAfter: ledgerEntries.balanceAfter,
      reason: ledgerEntries.reason,
      metadata: ledgerEntries.metadata,
    })
    .from(ledgerEntries)
    .innerJoin(depots, eq(depots.id, ledgerEntries.depotId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(ledgerEntries.id))
    .limit(Math.min(opts.limit ?? 100, 500));
}

export async function listTransfers(actor: Actor, limit = 50) {
  assertRole(actor, STAFF_ROLES);
  return db.select().from(transfers).orderBy(desc(transfers.createdAt)).limit(limit);
}

export async function listDepots() {
  return db.select().from(depots).orderBy(asc(depots.name));
}

export async function listItems(opts: { publicOnly?: boolean } = {}) {
  const rows = await db.select().from(items).orderBy(asc(items.kind), asc(items.code));
  return opts.publicOnly ? rows.filter((r) => r.isPublic) : rows;
}

export async function getItemsByCodes(codes: string[]) {
  if (codes.length === 0) return [];
  return db.select().from(items).where(inArray(items.code, codes));
}
