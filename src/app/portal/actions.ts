"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getEnv } from "@/env";
import { type ActionState, runAction } from "@/server/actions";
import { ForbiddenError } from "@/server/errors";
import { getOrderForActor } from "@/server/orders";
import { acceptQuote, createDepositInvoice, declineQuote } from "@/server/quotes";
import { requireRole } from "@/server/session";
import { processStripeEvent } from "@/server/stripe-webhook";
import type { Stripe } from "@/server/billing";

export async function acceptQuoteAction(quoteId: string, _prev: ActionState): Promise<ActionState> {
  const actor = await requireRole(["customer"]);
  let orderId: string | undefined;
  const state = await runAction(async () => {
    const order = await acceptQuote(actor, quoteId);
    orderId = order.id;
    revalidatePath("/portal");
  });
  if (orderId) redirect(`/portal/orders/${orderId}?accepted=1`);
  return state;
}

export async function declineQuoteAction(
  quoteId: string,
  _prev: ActionState,
): Promise<ActionState> {
  const actor = await requireRole(["customer"]);
  return runAction(async () => {
    await declineQuote(actor, quoteId);
    revalidatePath("/portal");
    return { message: "Quote declined." };
  });
}

export async function retryInvoiceAction(
  orderId: string,
  _prev: ActionState,
): Promise<ActionState> {
  const actor = await requireRole(["customer"]);
  return runAction(async () => {
    await createDepositInvoice(actor, orderId);
    revalidatePath(`/portal/orders/${orderId}`);
    return { message: "Deposit invoice created." };
  });
}

/**
 * DEVELOPMENT / TEST ONLY: simulates Stripe's `invoice.paid` for the test-bypass billing provider.
 * env.ts forbids PAYMENTS_MODE=test-bypass in production and this action re-checks NODE_ENV.
 */
export async function simulateDepositPaidAction(
  orderId: string,
  _prev: ActionState,
): Promise<ActionState> {
  const actor = await requireRole(["customer"]);
  return runAction(async () => {
    if (getEnv().PAYMENTS_MODE !== "test-bypass" || process.env.NODE_ENV === "production") {
      throw new ForbiddenError("Payment simulation is only available in test-bypass mode");
    }
    const { order } = await getOrderForActor(actor, orderId);
    if (!order.invoiceId) throw new ForbiddenError("No invoice to pay");
    const event = {
      id: `evt_sim_${order.id.replace(/-/g, "")}`,
      object: "event",
      type: "invoice.paid",
      data: { object: { id: order.invoiceId, object: "invoice", metadata: { orderId: order.id } } },
    } as unknown as Stripe.Event;
    await processStripeEvent(event);
    revalidatePath(`/portal/orders/${orderId}`);
    return { message: "Simulated deposit payment received." };
  });
}
