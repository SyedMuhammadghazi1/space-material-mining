import "server-only";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { billingCustomers } from "@/db/schema";
import { getEnv } from "@/env";
import { ServiceUnavailableError } from "./errors";

export interface DepositInvoiceRequest {
  orderId: string;
  orderReference: string;
  customer: { id: string; email: string; name: string; company?: string | null };
  amountCents: number;
  description: string;
}

export interface DepositInvoice {
  invoiceId: string;
  hostedInvoiceUrl: string | null;
}

export interface BillingProvider {
  readonly mode: "stripe" | "test-bypass";
  createDepositInvoice(req: DepositInvoiceRequest): Promise<DepositInvoice>;
}

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  const env = getEnv();
  if (!env.STRIPE_SECRET_KEY)
    throw new ServiceUnavailableError("Payments are not configured (STRIPE_SECRET_KEY missing)");
  stripeClient ??= new Stripe(env.STRIPE_SECRET_KEY, {
    appInfo: { name: "orbital-quarry" },
    maxNetworkRetries: 2,
  });
  return stripeClient;
}

/** Stripe Invoicing: one finalized, emailed invoice per order deposit. Idempotency keys make retries safe. */
class StripeBillingProvider implements BillingProvider {
  readonly mode = "stripe" as const;

  private async customerId(req: DepositInvoiceRequest): Promise<string> {
    const [existing] = await db
      .select()
      .from(billingCustomers)
      .where(eq(billingCustomers.userId, req.customer.id));
    if (existing) return existing.stripeCustomerId;
    const customer = await getStripe().customers.create(
      {
        email: req.customer.email,
        name: req.customer.company || req.customer.name,
        metadata: { userId: req.customer.id },
      },
      { idempotencyKey: `customer-${req.customer.id}` },
    );
    await db
      .insert(billingCustomers)
      .values({ userId: req.customer.id, stripeCustomerId: customer.id })
      .onConflictDoNothing();
    const [row] = await db
      .select()
      .from(billingCustomers)
      .where(eq(billingCustomers.userId, req.customer.id));
    return row!.stripeCustomerId;
  }

  async createDepositInvoice(req: DepositInvoiceRequest): Promise<DepositInvoice> {
    const env = getEnv();
    const stripe = getStripe();
    const customer = await this.customerId(req);
    const metadata = { orderId: req.orderId, orderReference: req.orderReference };
    const invoice = await stripe.invoices.create(
      {
        customer,
        collection_method: "send_invoice",
        days_until_due: env.INVOICE_DAYS_UNTIL_DUE,
        auto_advance: false,
        currency: env.STRIPE_CURRENCY,
        description: req.description,
        metadata,
      },
      { idempotencyKey: `deposit-invoice-${req.orderId}` },
    );
    await stripe.invoiceItems.create(
      {
        customer,
        invoice: invoice.id,
        amount: req.amountCents,
        currency: env.STRIPE_CURRENCY,
        description: req.description,
        metadata,
      },
      { idempotencyKey: `deposit-item-${req.orderId}` },
    );
    const finalized = await stripe.invoices.finalizeInvoice(
      invoice.id!,
      {},
      { idempotencyKey: `deposit-finalize-${req.orderId}` },
    );
    await stripe.invoices.sendInvoice(
      finalized.id!,
      {},
      { idempotencyKey: `deposit-send-${req.orderId}` },
    );
    return { invoiceId: finalized.id!, hostedInvoiceUrl: finalized.hosted_invoice_url ?? null };
  }
}

/**
 * Test double used when PAYMENTS_MODE=test-bypass. env.ts refuses that mode when
 * NODE_ENV=production, and the constructor re-checks, so it can never run in production.
 */
class TestBypassBillingProvider implements BillingProvider {
  readonly mode = "test-bypass" as const;
  constructor() {
    if (process.env.NODE_ENV === "production")
      throw new Error("test-bypass billing is disabled in production");
  }
  async createDepositInvoice(req: DepositInvoiceRequest): Promise<DepositInvoice> {
    return { invoiceId: `in_test_${req.orderId.replace(/-/g, "")}`, hostedInvoiceUrl: null };
  }
}

export function getBillingProvider(): BillingProvider {
  return getEnv().PAYMENTS_MODE === "test-bypass"
    ? new TestBypassBillingProvider()
    : new StripeBillingProvider();
}

/** Signature verification against the raw request body. Throws on any mismatch. */
export async function verifyStripeEvent(
  rawBody: string,
  signature: string,
  secret: string,
): Promise<Stripe.Event> {
  return Stripe.webhooks.constructEventAsync(rawBody, signature, secret);
}

export type { Stripe };
