import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, DefinitionList, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { getEnv } from "@/env";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/format";
import { NODE_LABELS } from "@/lib/models";
import { NotFoundError } from "@/server/errors";
import { getOrderForActor } from "@/server/orders";
import { requireRole } from "@/server/session";
import { retryInvoiceAction, simulateDepositPaidAction } from "../../actions";

export const metadata: Metadata = { title: "Order" };

const STEPS = [
  { key: "awaiting_deposit", label: "Deposit invoiced" },
  { key: "confirmed", label: "Deposit paid — confirmed" },
  { key: "reserved", label: "Stock reserved" },
  { key: "fulfilled", label: "Delivered" },
] as const;

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireRole(["customer"], `/portal/orders/${id}`);
  const { order, itemName, itemUnit } = await getOrderForActor(actor, id).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const env = getEnv();
  const current = STEPS.findIndex((s) => s.key === order.status);
  const testMode = env.PAYMENTS_MODE === "test-bypass" && process.env.NODE_ENV !== "production";
  return (
    <>
      <PageHeader
        eyebrow="Order"
        title={order.reference}
        description={`${formatQuantity(order.quantity, itemUnit)} of ${itemName} → ${NODE_LABELS[order.deliveryNode]}`}
        actions={<StatusBadge status={order.status} />}
      />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card title="Order summary">
          <DefinitionList
            items={[
              ["Total", formatMoney(order.totalCents, { exact: true })],
              [
                `Reservation deposit (${env.DEPOSIT_PERCENT}%)`,
                formatMoney(order.depositCents, { exact: true }),
              ],
              ["Placed", formatDateTime(order.createdAt)],
              ["Confirmed", formatDateTime(order.confirmedAt)],
              ["Delivered", formatDateTime(order.fulfilledAt)],
            ]}
          />
          {order.status === "awaiting_deposit" && (
            <div className="mt-5 space-y-3">
              {order.invoiceUrl ? (
                <a
                  className="inline-flex rounded-md bg-blue-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-800"
                  href={order.invoiceUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Pay deposit invoice (opens Stripe)
                </a>
              ) : order.invoiceId ? (
                <Notice tone="info">
                  Your deposit invoice {order.invoiceId} has been issued and emailed to you.
                </Notice>
              ) : (
                <ActionForm action={retryInvoiceAction.bind(null, order.id)}>
                  <Notice tone="warn">
                    We could not create your deposit invoice automatically.
                  </Notice>
                  <SubmitButton className="mt-2">Create deposit invoice</SubmitButton>
                </ActionForm>
              )}
              {testMode && order.invoiceId && (
                <ActionForm action={simulateDepositPaidAction.bind(null, order.id)}>
                  <Notice tone="info">
                    Test mode: payments are simulated (PAYMENTS_MODE=test-bypass).
                  </Notice>
                  <SubmitButton variant="secondary" className="mt-2">
                    Simulate deposit payment
                  </SubmitButton>
                </ActionForm>
              )}
            </div>
          )}
        </Card>
        <Card title="Progress">
          {order.status === "cancelled" ? (
            <p className="text-sm text-slate-700">
              This order was cancelled. Contact us about any deposit refund.
            </p>
          ) : (
            <ol className="space-y-3">
              {STEPS.map((s, i) => (
                <li key={s.key} className="flex items-center gap-3 text-sm">
                  <span
                    aria-hidden="true"
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${i <= current ? "bg-green-700 text-white" : "bg-slate-200 text-slate-600"}`}
                  >
                    {i < current || order.status === "fulfilled" ? "✓" : i + 1}
                  </span>
                  <span className={i <= current ? "font-medium text-slate-900" : "text-slate-500"}>
                    {s.label}
                    <span className="sr-only">
                      {i < current ? " (done)" : i === current ? " (current)" : " (pending)"}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}
