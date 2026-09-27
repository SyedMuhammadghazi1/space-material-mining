import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { POST as webhookPOST } from "@/app/api/webhooks/stripe/route";
import { db } from "@/db";
import { auditLog, ledgerEntries, orders, quotes, stripeEvents } from "@/db/schema";
import { getOutbox } from "@/lib/mailer";
import { applyMovement, transferStock } from "@/server/inventory";
import { ConflictError, InsufficientInventoryError } from "@/server/errors";
import {
  acceptQuote,
  declineQuote,
  draftQuotePricing,
  issueQuote,
  requestQuote,
} from "@/server/quotes";
import { fulfilOrder, getOrderForActor, reserveOrder } from "@/server/orders";
import type { Actor } from "@/server/authz";
import { balanceOf, createActor, seedReference, type Reference } from "./helpers";

const WEBHOOK_SECRET = "whsec_test_integration_secret";
let ref: Reference;
let customer: Actor;
let engineer: Actor;
let operator: Actor;

function invoicePaidEvent(
  invoiceId: string,
  eventId = `evt_${Math.random().toString(36).slice(2)}`,
) {
  return {
    id: eventId,
    object: "event",
    type: "invoice.paid",
    api_version: "2026-08-26.dahlia",
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: invoiceId, object: "invoice", metadata: {} } },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
  };
}

async function deliverWebhook(payload: object, secret = WEBHOOK_SECRET) {
  const body = JSON.stringify(payload);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload: body, secret });
  return webhookPOST(
    new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": signature },
      body,
    }),
  );
}

beforeEach(async () => {
  ref = await seedReference();
  customer = await createActor("customer");
  engineer = await createActor("engineer");
  operator = await createActor("operator");
});

async function issuedQuote(quantity = 500, itemCode = "O2") {
  const q = await requestQuote(customer, {
    itemCode,
    quantity,
    deliveryNode: "EML1",
    notes: "For propellant depot",
  });
  return issueQuote(engineer, q.id, { marginPercent: 25, reviewerNotes: "Standard terms" });
}

describe("quote → accept → invoice → webhook → confirmed", () => {
  it("prices server-side and walks the full happy path", async () => {
    const requested = await requestQuote(customer, {
      itemCode: "O2",
      quantity: 500,
      deliveryNode: "EML1",
    });
    expect(requested.status).toBe("requested");
    expect(requested.totalCents).toBeNull();

    const draft = await draftQuotePricing(engineer, requested.id, 25);
    const issued = await issueQuote(engineer, requested.id, { marginPercent: 25 });
    expect(issued.status).toBe("issued");
    expect(issued.totalCents).toBe(draft.totalCents);
    expect(issued.totalCents).toBe(issued.unitPriceCents! * 500);
    expect(issued.validUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(getOutbox().some((m) => m.subject.includes(issued.reference))).toBe(true);

    const order = await acceptQuote(customer, issued.id);
    expect(order.status).toBe("awaiting_deposit");
    expect(order.depositCents).toBe(Math.ceil(issued.totalCents! * 0.1));
    expect(order.invoiceId).toMatch(/^in_test_/);
    const [q] = await db.select().from(quotes).where(eq(quotes.id, issued.id));
    expect(q!.status).toBe("accepted");

    const res = await deliverWebhook(invoicePaidEvent(order.invoiceId!, "evt_paid_1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, duplicate: false, handled: true });
    const [confirmed] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(confirmed!.status).toBe("confirmed");
    expect(confirmed!.confirmedAt).not.toBeNull();
    expect(getOutbox().some((m) => m.subject.includes("confirmed"))).toBe(true);
  });

  it("processes each webhook event exactly once", async () => {
    const order = await acceptQuote(customer, (await issuedQuote()).id);
    const event = invoicePaidEvent(order.invoiceId!, "evt_dupe");
    await deliverWebhook(event);
    const again = await deliverWebhook(event);
    expect(await again.json()).toMatchObject({ duplicate: true, handled: false });
    const other = await deliverWebhook(invoicePaidEvent(order.invoiceId!, "evt_other"));
    expect(await other.json()).toMatchObject({ duplicate: false, handled: false });
    expect(await db.select().from(stripeEvents)).toHaveLength(2);
    const paidAudits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "order.deposit_paid"));
    expect(paidAudits).toHaveLength(1);
  });

  it("rejects bad signatures and unsigned requests", async () => {
    const order = await acceptQuote(customer, (await issuedQuote()).id);
    const forged = await deliverWebhook(invoicePaidEvent(order.invoiceId!), "whsec_wrong_secret");
    expect(forged.status).toBe(400);
    const unsigned = await webhookPOST(
      new Request("http://localhost/api/webhooks/stripe", { method: "POST", body: "{}" }),
    );
    expect(unsigned.status).toBe(400);
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row!.status).toBe("awaiting_deposit");
  });

  it("refuses expired quotes and marks them expired", async () => {
    const issued = await issuedQuote();
    const future = new Date(Date.now() + 40 * 86_400_000);
    await expect(acceptQuote(customer, issued.id, future)).rejects.toBeInstanceOf(ConflictError);
    const [q] = await db.select().from(quotes).where(eq(quotes.id, issued.id));
    expect(q!.status).toBe("expired");
    expect(await db.select().from(orders)).toHaveLength(0);
  });

  it("cannot accept twice or accept a declined quote", async () => {
    const issued = await issuedQuote();
    await acceptQuote(customer, issued.id);
    await expect(acceptQuote(customer, issued.id)).rejects.toBeInstanceOf(ConflictError);
    const other = await issuedQuote(100);
    await declineQuote(customer, other.id);
    await expect(acceptQuote(customer, other.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects fractional product quantities and non-public items", async () => {
    await expect(
      requestQuote(customer, { itemCode: "TI-TRUSS-2M", quantity: 2.5, deliveryNode: "EML1" }),
    ).rejects.toThrow(/whole units/);
    await expect(
      requestQuote(customer, { itemCode: "REGOLITH", quantity: 10, deliveryNode: "EML1" }),
    ).rejects.toThrow(/public catalog/);
  });
});

describe("reservation and fulfilment", () => {
  it("reserves stock, protects it from other withdrawals and delivers it", async () => {
    const order = await acceptQuote(customer, (await issuedQuote(300)).id);
    await deliverWebhook(invoicePaidEvent(order.invoiceId!));
    const depot = ref.depots["EML1-GW"]!;
    await db.transaction((tx) =>
      applyMovement(tx, { depotId: depot, itemCode: "O2", delta: 400, entryType: "production" }),
    );

    await expect(
      reserveOrder(operator, order.id, { depotId: ref.depots.LSP }),
    ).rejects.toBeInstanceOf(InsufficientInventoryError);
    const reserved = await reserveOrder(operator, order.id, { depotId: depot });
    expect(reserved.status).toBe("reserved");

    // Only 100 kg are free now; a transfer of 150 must fail.
    await expect(
      transferStock(operator, {
        fromDepotId: depot,
        toDepotId: ref.depots["LEO-FAB"],
        itemCode: "O2",
        quantity: 150,
        transportMission: "Test",
      }),
    ).rejects.toBeInstanceOf(InsufficientInventoryError);

    const fulfilled = await fulfilOrder(operator, order.id);
    expect(fulfilled.status).toBe("fulfilled");
    expect(await balanceOf(depot, "O2")).toBe(100);
    const deliveries = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.orderId, order.id));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.entryType).toBe("delivery");
    expect(deliveries[0]!.quantity).toBe(-300);
    await expect(fulfilOrder(operator, order.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("does not reserve orders whose deposit is unpaid", async () => {
    const order = await acceptQuote(customer, (await issuedQuote()).id);
    await expect(
      reserveOrder(operator, order.id, { depotId: ref.depots["EML1-GW"] }),
    ).rejects.toBeInstanceOf(ConflictError);
    const view = await getOrderForActor(customer, order.id);
    expect(view.order.status).toBe("awaiting_deposit");
  });
});
