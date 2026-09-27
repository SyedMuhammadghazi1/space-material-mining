import "server-only";
import { db } from "@/db";
import { stripeEvents } from "@/db/schema";
import { logger } from "@/lib/logger";
import type { Stripe } from "./billing";
import { confirmOrderForPaidInvoice, notifyOrderConfirmed } from "./orders";

export interface WebhookOutcome {
  duplicate: boolean;
  handled: boolean;
  orderId?: string;
}

/**
 * Processes a verified Stripe event exactly once: the event id is inserted in the same
 * transaction as the business change, so a failure rolls both back and Stripe's retry is safe,
 * while a duplicate delivery is skipped.
 */
export async function processStripeEvent(event: Stripe.Event): Promise<WebhookOutcome> {
  const outcome = await db.transaction(async (tx): Promise<WebhookOutcome> => {
    const inserted = await tx
      .insert(stripeEvents)
      .values({ id: event.id, type: event.type })
      .onConflictDoNothing()
      .returning({ id: stripeEvents.id });
    if (inserted.length === 0) return { duplicate: true, handled: false };
    switch (event.type) {
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.id) return { duplicate: false, handled: false };
        const order = await confirmOrderForPaidInvoice(tx, invoice.id, event.id);
        if (!order)
          logger.warn(
            { invoiceId: invoice.id, eventId: event.id },
            "invoice.paid for unknown or already-confirmed order",
          );
        return { duplicate: false, handled: !!order, orderId: order?.id };
      }
      default:
        return { duplicate: false, handled: false };
    }
  });
  if (outcome.orderId) await notifyOrderConfirmed(outcome.orderId);
  return outcome;
}
