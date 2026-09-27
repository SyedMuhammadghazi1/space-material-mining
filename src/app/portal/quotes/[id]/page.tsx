import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/form";
import {
  Card,
  DefinitionList,
  Notice,
  PageHeader,
  StatusBadge,
  TableWrap,
  td,
  th,
} from "@/components/ui";
import { getEnv } from "@/env";
import { formatDate, formatDeltaV, formatMoney, formatQuantity } from "@/lib/format";
import { NODE_LABELS, type QuotePricing } from "@/lib/models";
import { NotFoundError } from "@/server/errors";
import { effectiveQuoteStatus, getQuoteForActor } from "@/server/quotes";
import { requireRole } from "@/server/session";
import { acceptQuoteAction, declineQuoteAction } from "../../actions";

export const metadata: Metadata = { title: "Quote" };

export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ submitted?: string }>;
}) {
  const { id } = await params;
  const { submitted } = await searchParams;
  const actor = await requireRole(["customer"], `/portal/quotes/${id}`);
  const row = await getQuoteForActor(actor, id).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const { quote, itemName, itemUnit } = row;
  const pricing = quote.pricing as unknown as QuotePricing | null;
  const status = effectiveQuoteStatus(quote);
  const expired = status === "expired" && quote.status === "issued";
  return (
    <>
      <PageHeader
        eyebrow="Quote"
        title={quote.reference}
        description={`${formatQuantity(quote.quantity, itemUnit)} of ${itemName}, delivered to ${NODE_LABELS[quote.deliveryNode]}`}
        actions={<StatusBadge status={status} />}
      />
      <div className="space-y-6">
        {submitted && quote.status === "requested" && (
          <Notice tone="good" title="Request received">
            An engineer will price your request from our current mission economics and issue a
            quote. You will get an email when it is ready.
          </Notice>
        )}
        <Card title="Request">
          <DefinitionList
            items={[
              ["Item", itemName],
              ["Quantity", formatQuantity(quote.quantity, itemUnit)],
              ["Delivery node", NODE_LABELS[quote.deliveryNode]],
              ["Target date", formatDate(quote.targetDate)],
              ["Your notes", quote.customerNotes ?? "—"],
              ["Requested", formatDate(quote.createdAt)],
            ]}
          />
        </Card>
        {pricing && quote.totalCents !== null && (
          <Card title="Quoted price" description={`Valid until ${formatDate(quote.validUntil)}`}>
            <div className="space-y-4">
              <TableWrap label="Price breakdown per unit">
                <thead>
                  <tr>
                    <th className={th}>Per {itemUnit === "kg" ? "kg" : "unit"}</th>
                    <th className={`${th} text-right`}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {pricing.lines.map((l) => (
                    <tr key={l.label}>
                      <td className={td}>{l.label}</td>
                      <td className={`${td} text-right`}>
                        {formatMoney(l.perUnitCents, { exact: true })}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className={`${td} font-semibold`}>Unit price</td>
                    <td className={`${td} text-right font-semibold`}>
                      {formatMoney(quote.unitPriceCents, { exact: true })}
                    </td>
                  </tr>
                </tbody>
              </TableWrap>
              <DefinitionList
                items={[
                  [
                    "Total",
                    <strong key="t">{formatMoney(quote.totalCents, { exact: true })}</strong>,
                  ],
                  [`Reservation deposit (${getEnv().DEPOSIT_PERCENT}%)`, "Invoiced on acceptance"],
                  ["Shipped from", NODE_LABELS[pricing.originNode]],
                  ["Transport Δv", formatDeltaV(pricing.deltaVMs)],
                  ["Earliest delivery", pricing.earliestDeliveryDate],
                  ["Engineer notes", quote.reviewerNotes ?? "—"],
                ]}
              />
              {pricing.warnings.map((w) => (
                <Notice key={w} tone="warn">
                  {w}
                </Notice>
              ))}
              {quote.status === "issued" && !expired && (
                <div className="flex flex-wrap gap-3">
                  <ActionForm action={acceptQuoteAction.bind(null, quote.id)}>
                    <SubmitButton pendingLabel="Accepting…">
                      Accept quote &amp; place order
                    </SubmitButton>
                  </ActionForm>
                  <ActionForm action={declineQuoteAction.bind(null, quote.id)}>
                    <SubmitButton variant="secondary" pendingLabel="Declining…">
                      Decline
                    </SubmitButton>
                  </ActionForm>
                </div>
              )}
              {expired && (
                <Notice tone="warn">This quote has expired. Please request a new one.</Notice>
              )}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
