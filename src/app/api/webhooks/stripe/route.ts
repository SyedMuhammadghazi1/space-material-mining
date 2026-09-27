import { getEnv } from "@/env";
import { logger } from "@/lib/logger";
import { verifyStripeEvent } from "@/server/billing";
import { errorResponse } from "@/server/errors";
import { processStripeEvent } from "@/server/stripe-webhook";

export const dynamic = "force-dynamic";

/** Stripe webhook: verifies the signature against the RAW body, then processes idempotently. */
export async function POST(req: Request) {
  const secret = getEnv().STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    logger.error("stripe webhook received but STRIPE_WEBHOOK_SECRET is not configured");
    return Response.json(
      { error: { code: "not_configured", message: "Webhook not configured" } },
      { status: 503 },
    );
  }
  const signature = req.headers.get("stripe-signature");
  if (!signature)
    return Response.json(
      { error: { code: "bad_signature", message: "Missing signature" } },
      { status: 400 },
    );
  const raw = await req.text();
  let event;
  try {
    event = await verifyStripeEvent(raw, signature, secret);
  } catch {
    logger.warn("stripe webhook signature verification failed");
    return Response.json(
      { error: { code: "bad_signature", message: "Invalid signature" } },
      { status: 400 },
    );
  }
  try {
    const outcome = await processStripeEvent(event);
    return Response.json({ received: true, ...outcome });
  } catch (err) {
    // 5xx makes Stripe retry; the event id was rolled back with the failed transaction.
    return errorResponse(err);
  }
}
