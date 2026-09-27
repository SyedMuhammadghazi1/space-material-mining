import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton, TextArea, TextField } from "@/components/form";
import {
  Button,
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
import { ENGINEERING } from "@/server/authz";
import { NotFoundError, toAppError } from "@/server/errors";
import { draftQuotePricing, getQuoteForActor } from "@/server/quotes";
import { requireRole } from "@/server/session";
import { issueQuoteAction } from "../actions";

export const metadata: Metadata = { title: "Review quote" };

function PricingTable({ pricing, unit }: { pricing: QuotePricing; unit: "kg" | "unit" }) {
  return (
    <TableWrap label="Pricing breakdown">
      <thead>
        <tr>
          <th className={th}>Per {unit}</th>
          <th className={`${th} text-right`}>Amount</th>
        </tr>
      </thead>
      <tbody>
        {pricing.lines.map((l) => (
          <tr key={l.label}>
            <td className={td}>{l.label}</td>
            <td className={`${td} text-right`}>{formatMoney(l.perUnitCents, { exact: true })}</td>
          </tr>
        ))}
        <tr>
          <td className={`${td} font-semibold`}>Unit price (rounded up)</td>
          <td className={`${td} text-right font-semibold`}>
            {formatMoney(pricing.unitPriceCents, { exact: true })}
          </td>
        </tr>
        <tr>
          <td className={`${td} font-semibold`}>Total</td>
          <td className={`${td} text-right font-semibold`}>
            {formatMoney(pricing.totalCents, { exact: true })}
          </td>
        </tr>
      </tbody>
    </TableWrap>
  );
}

export default async function ReviewQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ margin?: string }>;
}) {
  const { id } = await params;
  const actor = await requireRole(ENGINEERING, `/ops/quotes/${id}`);
  const { quote, itemName, itemUnit, customerName, customerEmail, customerCompany } =
    await getQuoteForActor(actor, id).catch((err) => {
      if (err instanceof NotFoundError) notFound();
      throw err;
    });
  const defaultMargin = getEnv().QUOTE_MARGIN_PERCENT;
  const marginParam = Number((await searchParams).margin);
  const margin =
    Number.isFinite(marginParam) && marginParam >= 0 && marginParam <= 500
      ? marginParam
      : defaultMargin;
  let draft: QuotePricing | null = null;
  let draftError: string | null = null;
  if (quote.status === "requested") {
    try {
      draft = await draftQuotePricing(actor, quote.id, margin);
    } catch (err) {
      draftError = toAppError(err).message;
    }
  }
  const issued = quote.pricing as unknown as QuotePricing | null;
  return (
    <>
      <PageHeader
        eyebrow="Quote review"
        title={quote.reference}
        description={`${formatQuantity(quote.quantity, itemUnit)} of ${itemName} → ${NODE_LABELS[quote.deliveryNode]}`}
        actions={<StatusBadge status={quote.status} />}
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Customer request">
          <DefinitionList
            items={[
              ["Customer", `${customerName}${customerCompany ? ` — ${customerCompany}` : ""}`],
              ["Email", customerEmail],
              ["Item", itemName],
              ["Quantity", formatQuantity(quote.quantity, itemUnit)],
              ["Delivery node", NODE_LABELS[quote.deliveryNode]],
              ["Target date", formatDate(quote.targetDate)],
              ["Notes", quote.customerNotes ?? "—"],
            ]}
          />
        </Card>
        {quote.status === "requested" ? (
          <Card
            title="Draft pricing"
            description="Computed server-side from the current cost bases, node Δv map and transport assumptions."
          >
            <form method="get" className="mb-4 flex items-end gap-2">
              <TextField
                label="Preview margin (%)"
                name="margin"
                id="preview-margin"
                type="number"
                min={0}
                max={500}
                step="0.5"
                defaultValue={margin}
                className="w-40"
              />
              <Button type="submit" variant="secondary">
                Recalculate
              </Button>
            </form>
            {draftError && <Notice tone="bad">{draftError}</Notice>}
            {draft && (
              <div className="space-y-4">
                <PricingTable pricing={draft} unit={itemUnit} />
                <p className="text-sm text-slate-600">
                  Ships from {NODE_LABELS[draft.originNode]} · transport Δv{" "}
                  {formatDeltaV(draft.deltaVMs)} · earliest delivery {draft.earliestDeliveryDate} ·
                  valid for {getEnv().QUOTE_VALIDITY_DAYS} days
                </p>
                {draft.warnings.map((w) => (
                  <Notice key={w} tone="warn">
                    {w}
                  </Notice>
                ))}
                <ActionForm
                  action={issueQuoteAction.bind(null, quote.id)}
                  className="space-y-3 border-t border-slate-100 pt-4"
                >
                  <TextField
                    label="Margin to issue (%)"
                    name="marginPercent"
                    type="number"
                    min={0}
                    max={500}
                    step="0.5"
                    defaultValue={margin}
                    required
                    className="w-48"
                  />
                  <TextArea
                    label="Notes to customer (optional)"
                    name="reviewerNotes"
                    maxLength={2000}
                  />
                  <SubmitButton pendingLabel="Issuing…">Issue quote</SubmitButton>
                </ActionForm>
              </div>
            )}
          </Card>
        ) : (
          issued && (
            <Card
              title="Issued pricing"
              description={`Issued ${formatDate(quote.issuedAt)} · valid until ${formatDate(quote.validUntil)} · margin ${quote.marginPercent}%`}
            >
              <PricingTable pricing={issued} unit={itemUnit} />
              {quote.reviewerNotes && (
                <p className="mt-3 text-sm text-slate-700">Notes: {quote.reviewerNotes}</p>
              )}
            </Card>
          )
        )}
      </div>
    </>
  );
}
