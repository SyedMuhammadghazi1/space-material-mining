import "server-only";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { type Tx, db } from "@/db";
import { depots, items, orders, user } from "@/db/schema";
import { getEnv } from "@/env";
import { logger } from "@/lib/logger";
import { sendMail } from "@/lib/mailer";
import { audit } from "./audit";
import { type Actor, OPERATIONS, STAFF_ROLES, assertRole, isStaff } from "./authz";
import { getBillingProvider } from "./billing";
import { ConflictError, NotFoundError, ensureUuid } from "./errors";
import { applyMovement, releaseReservation, reserveStock } from "./inventory";

const orderColumns = {
  order: orders,
  itemName: items.name,
  itemUnit: items.unit,
  customerName: user.name,
  customerEmail: user.email,
  customerCompany: user.company,
  reservedDepotName: depots.name,
};

function baseQuery() {
  return db
    .select(orderColumns)
    .from(orders)
    .innerJoin(items, eq(items.code, orders.itemCode))
    .innerJoin(user, eq(user.id, orders.customerId))
    .leftJoin(depots, eq(depots.id, orders.reservedDepotId));
}

/** Customers can only ever load their own orders; others' orders are indistinguishable from missing. */
export async function getOrderForActor(actor: Actor, id: string) {
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Order not found");
  const where = isStaff(actor)
    ? eq(orders.id, id)
    : and(eq(orders.id, id), eq(orders.customerId, actor.id));
  const [row] = await baseQuery().where(where);
  if (!row) throw new NotFoundError("Order not found");
  return row;
}

export async function listOrdersForCustomer(actor: Actor) {
  return baseQuery().where(eq(orders.customerId, actor.id)).orderBy(desc(orders.createdAt));
}

export async function listOrders(
  actor: Actor,
  statuses?: (typeof orders.$inferSelect)["status"][],
) {
  assertRole(actor, STAFF_ROLES);
  const q = baseQuery();
  return (statuses?.length ? q.where(inArray(orders.status, statuses)) : q).orderBy(
    desc(orders.createdAt),
  );
}

/**
 * Called from the Stripe webhook (inside its idempotency transaction): awaiting_deposit →
 * confirmed. Re-delivery of the same or a different event for a confirmed order is a no-op.
 *
 * `metadataOrderId` (set on every deposit invoice we create) covers an invoice that is reported
 * paid before its id was stored on the order — e.g. paid on finalisation from customer credit, or
 * the app failed after Stripe created it. It only matches an order with no invoice recorded.
 */
export async function confirmOrderForPaidInvoice(
  tx: Tx,
  invoiceId: string,
  eventId: string,
  metadataOrderId?: string | null,
) {
  const byMetadata =
    metadataOrderId && z.uuid().safeParse(metadataOrderId).success
      ? and(eq(orders.id, metadataOrderId), isNull(orders.invoiceId))
      : undefined;
  const [order] = await tx
    .update(orders)
    .set({
      status: "confirmed",
      confirmedAt: new Date(),
      invoiceId: sql`COALESCE(${orders.invoiceId}, ${invoiceId})`,
    })
    .where(
      and(or(eq(orders.invoiceId, invoiceId), byMetadata), eq(orders.status, "awaiting_deposit")),
    )
    .returning();
  if (!order) return null;
  await audit(
    tx,
    { system: "stripe" },
    {
      action: "order.deposit_paid",
      entityType: "order",
      entityId: order.id,
      metadata: { invoiceId, eventId },
    },
  );
  return order;
}

export async function notifyOrderConfirmed(orderId: string) {
  const [row] = await baseQuery().where(eq(orders.id, orderId));
  if (!row) return;
  await sendMail({
    to: [row.customerEmail],
    subject: `Order ${row.order.reference} confirmed`,
    text: `We received your reservation deposit. Order ${row.order.reference} is confirmed and queued for allocation. Track it at ${getEnv().APP_URL}/portal/orders/${row.order.id}`,
  }).catch((err) => logger.warn({ err }, "order confirmation email failed"));
}

async function lockOrder(tx: Tx, id: string) {
  ensureUuid(id, "Order");
  const [order] = await tx.select().from(orders).where(eq(orders.id, id)).for("update");
  if (!order) throw new NotFoundError("Order not found");
  return order;
}

export const reserveSchema = z.object({ depotId: z.uuid("Choose a depot") });

/** confirmed → reserved: earmarks free stock at a depot (locks the balance row). */
export async function reserveOrder(actor: Actor, orderId: string, raw: unknown) {
  assertRole(actor, OPERATIONS);
  const { depotId } = reserveSchema.parse(raw);
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.status !== "confirmed")
      throw new ConflictError(`Order is ${order.status.replace("_", " ")}`, "invalid_state");
    const [depot] = await tx.select({ id: depots.id }).from(depots).where(eq(depots.id, depotId));
    if (!depot) throw new NotFoundError("Depot not found");
    await reserveStock(tx, { depotId, itemCode: order.itemCode }, order.quantity);
    const [updated] = await tx
      .update(orders)
      .set({ status: "reserved", reservedDepotId: depotId, reservedAt: new Date() })
      .where(eq(orders.id, orderId))
      .returning();
    await audit(tx, actor, {
      action: "order.reserve",
      entityType: "order",
      entityId: orderId,
      metadata: { depotId, quantity: order.quantity },
    });
    return updated!;
  });
}

/** reserved → fulfilled: writes the delivery ledger entry against the reserved stock. */
export async function fulfilOrder(actor: Actor, orderId: string) {
  assertRole(actor, OPERATIONS);
  const fulfilled = await db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.status !== "reserved" || !order.reservedDepotId)
      throw new ConflictError(`Order is ${order.status.replace("_", " ")}`, "invalid_state");
    await applyMovement(tx, {
      depotId: order.reservedDepotId,
      itemCode: order.itemCode,
      delta: -order.quantity,
      entryType: "delivery",
      orderId: order.id,
      fromReserved: true,
      actorId: actor.id,
      metadata: { orderReference: order.reference, deliveryNode: order.deliveryNode },
    });
    const [updated] = await tx
      .update(orders)
      .set({ status: "fulfilled", fulfilledAt: new Date() })
      .where(eq(orders.id, orderId))
      .returning();
    await audit(tx, actor, { action: "order.fulfil", entityType: "order", entityId: orderId });
    return updated!;
  });
  const [row] = await baseQuery().where(eq(orders.id, orderId));
  if (row) {
    await sendMail({
      to: [row.customerEmail],
      subject: `Order ${row.order.reference} delivered`,
      text: `Order ${row.order.reference} has been handed over at ${row.order.deliveryNode}. The balance invoice will follow per your contract terms.`,
    }).catch((err) => logger.warn({ err }, "fulfilment email failed"));
  }
  return fulfilled;
}

export async function cancelOrder(actor: Actor, orderId: string, reason: string) {
  assertRole(actor, ["admin"]);
  const clean = z.string().trim().min(3).max(500).parse(reason);
  const { cancelled, openInvoiceId } = await db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.status === "fulfilled" || order.status === "cancelled")
      throw new ConflictError(`Order is ${order.status}`, "invalid_state");
    if (order.status === "reserved" && order.reservedDepotId) {
      await releaseReservation(
        tx,
        { depotId: order.reservedDepotId, itemCode: order.itemCode },
        order.quantity,
      );
    }
    const [updated] = await tx
      .update(orders)
      .set({ status: "cancelled" })
      .where(eq(orders.id, orderId))
      .returning();
    await audit(tx, actor, {
      action: "order.cancel",
      entityType: "order",
      entityId: orderId,
      metadata: { reason: clean, previousStatus: order.status },
    });
    const unpaid = order.status === "awaiting_deposit" ? order.invoiceId : null;
    return { cancelled: updated!, openInvoiceId: unpaid };
  });
  // The deposit invoice was emailed with a payment link: void it so the customer can't pay for a
  // cancelled order (the webhook only confirms orders awaiting their deposit and would ignore it).
  if (openInvoiceId) {
    await getBillingProvider()
      .voidInvoice(openInvoiceId)
      .catch((err) =>
        logger.error(
          { err, orderId, invoiceId: openInvoiceId },
          "could not void the deposit invoice of a cancelled order — check for payment/refund",
        ),
      );
  }
  return cancelled;
}
