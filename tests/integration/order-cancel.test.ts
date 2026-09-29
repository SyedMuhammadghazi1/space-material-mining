import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, orders } from "@/db/schema";
import type { BillingProvider } from "@/server/billing";
import { cancelOrder } from "@/server/orders";
import { processStripeEvent } from "@/server/stripe-webhook";
import { acceptQuote, createDepositInvoice, issueQuote, requestQuote } from "@/server/quotes";
import type { Actor } from "@/server/authz";
import { ConflictError } from "@/server/errors";
import type { Stripe } from "@/server/billing";
import { createActor, seedReference } from "./helpers";

// Record what the order flow asks the billing provider to do.
const billing = vi.hoisted(() => ({
  voided: [] as string[],
  failVoid: false,
  failCreate: false,
  /** Runs while Stripe is "creating" the invoice — i.e. between the pre-check and recording it. */
  duringCreate: null as ((orderId: string, invoiceId: string) => Promise<unknown>) | null,
}));
vi.mock("@/server/billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/billing")>();
  const provider: BillingProvider = {
    mode: "test-bypass",
    async createDepositInvoice(req) {
      if (billing.failCreate) throw new Error("Stripe is unavailable");
      const invoiceId = fakeInvoiceId(req.orderId);
      await billing.duringCreate?.(req.orderId, invoiceId);
      return { invoiceId, hostedInvoiceUrl: null };
    },
    async voidInvoice(invoiceId) {
      if (billing.failVoid) throw new Error("invoice is already paid");
      billing.voided.push(invoiceId);
    },
  };
  return { ...actual, getBillingProvider: () => provider };
});

function fakeInvoiceId(orderId: string) {
  return `in_fake_${orderId.replace(/-/g, "")}`;
}

function invoicePaid(invoiceId: string, eventId: string, orderId?: string) {
  return processStripeEvent({
    id: eventId,
    object: "event",
    type: "invoice.paid",
    data: { object: { id: invoiceId, object: "invoice", metadata: orderId ? { orderId } : {} } },
  } as unknown as Stripe.Event);
}

async function orderRow(id: string) {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  return row!;
}

let customer: Actor;
let engineer: Actor;
let admin: Actor;

beforeEach(async () => {
  billing.voided.length = 0;
  billing.failVoid = false;
  billing.failCreate = false;
  billing.duringCreate = null;
  await seedReference();
  customer = await createActor("customer");
  engineer = await createActor("engineer");
  admin = await createActor("admin");
});

async function placeOrder() {
  const q = await requestQuote(customer, { itemCode: "O2", quantity: 50, deliveryNode: "EML1" });
  await issueQuote(engineer, q.id, { marginPercent: 20 });
  return acceptQuote(customer, q.id);
}

describe("cancelling an order", () => {
  it("voids the emailed deposit invoice so a cancelled order cannot be paid", async () => {
    const order = await placeOrder();
    expect(order.invoiceId).toMatch(/^in_fake_/);
    const cancelled = await cancelOrder(admin, order.id, "Customer withdrew");
    expect(cancelled.status).toBe("cancelled");
    expect(billing.voided).toEqual([order.invoiceId]);
  });

  it("does not void an invoice that has already been paid", async () => {
    const order = await placeOrder();
    await processStripeEvent({
      id: "evt_paid_before_cancel",
      object: "event",
      type: "invoice.paid",
      data: { object: { id: order.invoiceId, object: "invoice", metadata: {} } },
    } as unknown as Stripe.Event);
    await cancelOrder(admin, order.id, "Out of stock");
    expect(billing.voided).toEqual([]);
  });

  it("keeps the cancellation when Stripe refuses to void", async () => {
    const order = await placeOrder();
    billing.failVoid = true;
    await cancelOrder(admin, order.id, "Customer withdrew");
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row!.status).toBe("cancelled");
  });
});

describe("an order cancelled while its deposit invoice is being created", () => {
  it("voids the new invoice instead of recording it as payable", async () => {
    billing.duringCreate = (orderId) => cancelOrder(admin, orderId, "Customer withdrew");
    const order = await placeOrder();
    const invoiceId = fakeInvoiceId(order.id);

    const row = await orderRow(order.id);
    expect(row.status).toBe("cancelled");
    expect(row.invoiceId).toBeNull();
    expect(billing.voided).toEqual([invoiceId]);
    const [discarded] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, order.id), eq(auditLog.action, "order.invoice_voided")));
    expect(discarded!.metadata).toMatchObject({ invoiceId, orderStatus: "cancelled" });

    // Even if the customer managed to pay it first, a cancelled order is never confirmed.
    expect((await invoicePaid(invoiceId, "evt_paid_after_cancel", order.id)).handled).toBe(false);
    expect((await orderRow(order.id)).status).toBe("cancelled");
  });

  it("refuses a retried invoice for an order cancelled meanwhile", async () => {
    billing.failCreate = true;
    const order = await placeOrder();
    expect(order.invoiceId).toBeNull();
    billing.failCreate = false;
    billing.duringCreate = (orderId) => cancelOrder(admin, orderId, "Customer withdrew");

    await expect(createDepositInvoice(customer, order.id)).rejects.toBeInstanceOf(ConflictError);
    expect(billing.voided).toEqual([fakeInvoiceId(order.id)]);
    expect((await orderRow(order.id)).invoiceId).toBeNull();
  });

  it("keeps the cancellation when voiding the late invoice fails", async () => {
    billing.failVoid = true;
    billing.duringCreate = (orderId) => cancelOrder(admin, orderId, "Customer withdrew");
    const order = await placeOrder();
    const row = await orderRow(order.id);
    expect(row.status).toBe("cancelled");
    expect(row.invoiceId).toBeNull();
  });

  it("does not void an invoice that was paid while it was being recorded", async () => {
    billing.duringCreate = (orderId, invoiceId) =>
      invoicePaid(invoiceId, "evt_paid_on_finalize", orderId);
    const order = await placeOrder();
    const row = await orderRow(order.id);
    expect(row.status).toBe("confirmed");
    expect(row.invoiceId).toBe(fakeInvoiceId(order.id));
    expect(billing.voided).toEqual([]);
  });
});
