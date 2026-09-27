import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import type { BillingProvider } from "@/server/billing";
import { cancelOrder } from "@/server/orders";
import { processStripeEvent } from "@/server/stripe-webhook";
import { acceptQuote, issueQuote, requestQuote } from "@/server/quotes";
import type { Actor } from "@/server/authz";
import type { Stripe } from "@/server/billing";
import { createActor, seedReference } from "./helpers";

// Record what the order flow asks the billing provider to do.
const billing = vi.hoisted(() => ({ voided: [] as string[], failVoid: false }));
vi.mock("@/server/billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/billing")>();
  const provider: BillingProvider = {
    mode: "test-bypass",
    async createDepositInvoice(req) {
      return { invoiceId: `in_fake_${req.orderId.replace(/-/g, "")}`, hostedInvoiceUrl: null };
    },
    async voidInvoice(invoiceId) {
      if (billing.failVoid) throw new Error("invoice is already paid");
      billing.voided.push(invoiceId);
    },
  };
  return { ...actual, getBillingProvider: () => provider };
});

let customer: Actor;
let engineer: Actor;
let admin: Actor;

beforeEach(async () => {
  billing.voided.length = 0;
  billing.failVoid = false;
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
