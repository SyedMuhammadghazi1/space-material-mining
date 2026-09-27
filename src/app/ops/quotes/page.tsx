import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, PageHeader, StatusBadge, TableWrap, td, th } from "@/components/ui";
import { formatDate, formatMoney, formatQuantity } from "@/lib/format";
import { NODE_LABELS } from "@/lib/models";
import { ENGINEERING } from "@/server/authz";
import { listQuoteQueue } from "@/server/quotes";
import { requireRole } from "@/server/session";

export const metadata: Metadata = { title: "Quote queue" };

export default async function QuoteQueuePage() {
  const actor = await requireRole(ENGINEERING, "/ops/quotes");
  const quotes = await listQuoteQueue(actor);
  return (
    <>
      <PageHeader
        title="Quote queue"
        description="Customer requests for quote. Review the model-derived price, set the margin and issue."
      />
      <Card>
        {quotes.length === 0 ? (
          <EmptyState>No quote requests yet.</EmptyState>
        ) : (
          <TableWrap label="Quote requests">
            <thead>
              <tr>
                <th className={th}>Reference</th>
                <th className={th}>Customer</th>
                <th className={th}>Item</th>
                <th className={th}>Quantity</th>
                <th className={th}>Delivery</th>
                <th className={th}>Target date</th>
                <th className={th}>Status</th>
                <th className={`${th} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map(({ quote, itemName, itemUnit, customerName, customerCompany }) => (
                <tr key={quote.id}>
                  <td className={td}>
                    <Link
                      className="font-medium text-blue-700 underline underline-offset-2"
                      href={`/ops/quotes/${quote.id}`}
                    >
                      {quote.reference}
                    </Link>
                    <span className="block text-xs text-slate-500">
                      {formatDate(quote.createdAt)}
                    </span>
                  </td>
                  <td className={td}>
                    {customerName}
                    {customerCompany && (
                      <span className="block text-xs text-slate-500">{customerCompany}</span>
                    )}
                  </td>
                  <td className={td}>{itemName}</td>
                  <td className={td}>{formatQuantity(quote.quantity, itemUnit)}</td>
                  <td className={td}>{NODE_LABELS[quote.deliveryNode]}</td>
                  <td className={td}>{formatDate(quote.targetDate)}</td>
                  <td className={td}>
                    <StatusBadge status={quote.status} />
                  </td>
                  <td className={`${td} text-right`}>{formatMoney(quote.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
