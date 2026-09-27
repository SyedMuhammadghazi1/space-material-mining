import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { items, orders, quotes, user } from "@/db/schema";
import { getEnv } from "@/env";
import { ORBITAL_NODES, depositCents } from "@/lib/models";
import { logger } from "@/lib/logger";
import { sendMail } from "@/lib/mailer";
import { audit } from "./audit";
import { type Actor, ENGINEERING, assertRole, isStaff } from "./authz";
import { getBillingProvider } from "./billing";
import { priceItem } from "./catalog";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { enforceRateLimit } from "./rate-limit";
import { makeReference } from "./references";

const todayIso = () => new Date().toISOString().slice(0, 10);

export const quoteRequestSchema = z.object({
  itemCode: z.string().min(1, "Choose a product or material").max(40),
  quantity: z.coerce.number().positive("Quantity must be positive").max(10_000_000),
  deliveryNode: z.enum(ORBITAL_NODES, "Choose a delivery node"),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .refine((d) => d > todayIso(), "Target date must be in the future")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  notes: z.string().trim().max(2_000).optional(),
});

export const issueQuoteSchema = z.object({
  marginPercent: z.coerce.number().min(0).max(500),
  reviewerNotes: z.string().trim().max(2_000).optional(),
});

/** Customers request a quote; pricing is only computed server-side when staff issue it. */
export async function requestQuote(actor: Actor, raw: unknown) {
  assertRole(actor, ["customer"]);
  await enforceRateLimit(`rfq:${actor.id}`, getEnv().PUBLIC_WRITE_RATE_LIMIT_PER_HOUR, 3600);
  const input = quoteRequestSchema.parse(raw);
  const [item] = await db.select().from(items).where(eq(items.code, input.itemCode));
  if (!item || !item.isPublic) throw new ValidationError("That item is not in the public catalog");
  if (item.unit === "unit" && !Number.isInteger(input.quantity)) {
    throw new ValidationError("Products are quoted in whole units", {
      quantity: ["Enter a whole number of units"],
    });
  }
  return db.transaction(async (tx) => {
    const [quote] = await tx
      .insert(quotes)
      .values({
        reference: makeReference("Q"),
        customerId: actor.id,
        itemCode: item.code,
        quantity: input.quantity,
        deliveryNode: input.deliveryNode,
        targetDate: input.targetDate ?? null,
        customerNotes: input.notes || null,
      })
      .returning();
    await audit(tx, actor, {
      action: "quote.request",
      entityType: "quote",
      entityId: quote!.id,
      metadata: { itemCode: item.code, quantity: input.quantity },
    });
    return quote!;
  });
}

const quoteColumns = {
  quote: quotes,
  itemName: items.name,
  itemUnit: items.unit,
  customerName: user.name,
  customerEmail: user.email,
  customerCompany: user.company,
};

/** Customers see only their own quotes; staff see all. Anything else is a 404 (no existence leak). */
export async function getQuoteForActor(actor: Actor, id: string) {
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Quote not found");
  const where = isStaff(actor)
    ? eq(quotes.id, id)
    : and(eq(quotes.id, id), eq(quotes.customerId, actor.id));
  const [row] = await db
    .select(quoteColumns)
    .from(quotes)
    .innerJoin(items, eq(items.code, quotes.itemCode))
    .innerJoin(user, eq(user.id, quotes.customerId))
    .where(where);
  if (!row) throw new NotFoundError("Quote not found");
  return row;
}

export async function listQuotesForCustomer(actor: Actor) {
  return db
    .select(quoteColumns)
    .from(quotes)
    .innerJoin(items, eq(items.code, quotes.itemCode))
    .innerJoin(user, eq(user.id, quotes.customerId))
    .where(eq(quotes.customerId, actor.id))
    .orderBy(desc(quotes.createdAt));
}

export async function listQuoteQueue(actor: Actor) {
  assertRole(actor, ENGINEERING);
  return db
    .select(quoteColumns)
    .from(quotes)
    .innerJoin(items, eq(items.code, quotes.itemCode))
    .innerJoin(user, eq(user.id, quotes.customerId))
    .orderBy(
      sql`CASE WHEN ${quotes.status} = 'requested' THEN 0 ELSE 1 END`,
      desc(quotes.createdAt),
    );
}

/** Draft pricing for the review screen (not persisted). */
export async function draftQuotePricing(actor: Actor, id: string, marginPercent?: number) {
  assertRole(actor, ENGINEERING);
  const { quote } = await getQuoteForActor(actor, id);
  return priceItem({
    itemCode: quote.itemCode,
    quantity: quote.quantity,
    deliveryNode: quote.deliveryNode,
    marginPercent,
    targetDate: quote.targetDate,
  });
}

export async function issueQuote(actor: Actor, id: string, raw: unknown) {
  assertRole(actor, ENGINEERING);
  const input = issueQuoteSchema.parse(raw);
  const issued = await db.transaction(async (tx) => {
    const [quote] = await tx.select().from(quotes).where(eq(quotes.id, id)).for("update");
    if (!quote) throw new NotFoundError("Quote not found");
    if (quote.status !== "requested")
      throw new ConflictError(`Quote is already ${quote.status}`, "invalid_state");
    const pricing = await priceItem({
      itemCode: quote.itemCode,
      quantity: quote.quantity,
      deliveryNode: quote.deliveryNode,
      marginPercent: input.marginPercent,
      targetDate: quote.targetDate,
    });
    const [updated] = await tx
      .update(quotes)
      .set({
        status: "issued",
        pricing: pricing as unknown as Record<string, unknown>,
        unitPriceCents: pricing.unitPriceCents,
        totalCents: pricing.totalCents,
        marginPercent: input.marginPercent,
        validUntil: new Date(pricing.validUntil),
        reviewerNotes: input.reviewerNotes || null,
        issuedBy: actor.id,
        issuedAt: new Date(),
      })
      .where(eq(quotes.id, id))
      .returning();
    await audit(tx, actor, {
      action: "quote.issue",
      entityType: "quote",
      entityId: id,
      metadata: { totalCents: pricing.totalCents, marginPercent: input.marginPercent },
    });
    return updated!;
  });
  const [customer] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, issued.customerId));
  if (customer) {
    await sendMail({
      to: [customer.email],
      subject: `Your quote ${issued.reference} is ready`,
      text: `Your quote ${issued.reference} has been issued and is valid until ${issued.validUntil?.toISOString().slice(0, 10)}. Sign in to review and accept it: ${getEnv().APP_URL}/portal/quotes/${issued.id}`,
    }).catch((err) => logger.warn({ err }, "quote email failed"));
  }
  return issued;
}

export async function declineQuote(actor: Actor, id: string) {
  assertRole(actor, ["customer"]);
  return db.transaction(async (tx) => {
    const [quote] = await tx
      .select()
      .from(quotes)
      .where(and(eq(quotes.id, id), eq(quotes.customerId, actor.id)))
      .for("update");
    if (!quote) throw new NotFoundError("Quote not found");
    if (quote.status !== "issued")
      throw new ConflictError(`Quote is ${quote.status}`, "invalid_state");
    const [updated] = await tx
      .update(quotes)
      .set({ status: "declined", decidedAt: new Date() })
      .where(eq(quotes.id, id))
      .returning();
    await audit(tx, actor, { action: "quote.decline", entityType: "quote", entityId: id });
    return updated!;
  });
}

/**
 * Customer accepts an issued, unexpired quote → order (awaiting deposit) → deposit invoice.
 * The order is committed first; invoice creation happens after commit and can be retried.
 */
export async function acceptQuote(actor: Actor, id: string, now = new Date()) {
  assertRole(actor, ["customer"]);
  const env = getEnv();
  const outcome = await db.transaction(async (tx) => {
    const [quote] = await tx
      .select()
      .from(quotes)
      .where(and(eq(quotes.id, id), eq(quotes.customerId, actor.id)))
      .for("update");
    if (!quote) throw new NotFoundError("Quote not found");
    if (quote.status !== "issued")
      throw new ConflictError(`Quote is ${quote.status}`, "invalid_state");
    if (!quote.validUntil || quote.validUntil.getTime() < now.getTime()) {
      await tx.update(quotes).set({ status: "expired" }).where(eq(quotes.id, id));
      return { expired: true as const };
    }
    const total = quote.totalCents!;
    const [order] = await tx
      .insert(orders)
      .values({
        reference: makeReference("O"),
        quoteId: quote.id,
        customerId: actor.id,
        itemCode: quote.itemCode,
        quantity: quote.quantity,
        deliveryNode: quote.deliveryNode,
        totalCents: total,
        depositCents: depositCents(total, env.DEPOSIT_PERCENT),
      })
      .returning();
    await tx.update(quotes).set({ status: "accepted", decidedAt: now }).where(eq(quotes.id, id));
    await audit(tx, actor, {
      action: "quote.accept",
      entityType: "order",
      entityId: order!.id,
      metadata: { quoteId: id, totalCents: total, depositCents: order!.depositCents },
    });
    return { expired: false as const, order: order! };
  });
  if (outcome.expired)
    throw new ConflictError("This quote has expired — request a new one", "quote_expired");
  const order = await createDepositInvoice(actor, outcome.order.id).catch((err) => {
    logger.error(
      { err, orderId: outcome.order.id },
      "deposit invoice creation failed; can be retried",
    );
    return outcome.order;
  });
  return order;
}

/** Creates (or re-tries) the Stripe deposit invoice for an order awaiting its deposit. */
export async function createDepositInvoice(actor: Actor, orderId: string) {
  const [row] = await db
    .select({
      order: orders,
      name: user.name,
      email: user.email,
      company: user.company,
      itemName: items.name,
    })
    .from(orders)
    .innerJoin(user, eq(user.id, orders.customerId))
    .innerJoin(items, eq(items.code, orders.itemCode))
    .where(eq(orders.id, orderId));
  if (!row || (row.order.customerId !== actor.id && actor.role !== "admin"))
    throw new NotFoundError("Order not found");
  if (row.order.status !== "awaiting_deposit")
    throw new ConflictError("Order is not awaiting a deposit", "invalid_state");
  if (row.order.invoiceId) return row.order;
  const invoice = await getBillingProvider().createDepositInvoice({
    orderId: row.order.id,
    orderReference: row.order.reference,
    customer: { id: row.order.customerId, email: row.email, name: row.name, company: row.company },
    amountCents: row.order.depositCents,
    description: `Reservation deposit (${getEnv().DEPOSIT_PERCENT}%) for order ${row.order.reference}: ${row.order.quantity} × ${row.itemName} delivered to ${row.order.deliveryNode}`,
  });
  const [updated] = await db
    .update(orders)
    .set({ invoiceId: invoice.invoiceId, invoiceUrl: invoice.hostedInvoiceUrl })
    .where(and(eq(orders.id, orderId), sql`${orders.invoiceId} IS NULL`))
    .returning();
  await audit(db, actor, {
    action: "order.invoice_created",
    entityType: "order",
    entityId: orderId,
    metadata: { invoiceId: invoice.invoiceId },
  });
  return updated ?? row.order;
}
