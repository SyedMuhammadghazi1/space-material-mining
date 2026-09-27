import type { Metadata } from "next";
import Link from "next/link";
import {
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  StatusBadge,
  TableWrap,
  td,
  th,
} from "@/components/ui";
import { formatDate, formatMoney, formatQuantity } from "@/lib/format";
import { NODE_LABELS } from "@/lib/models";
import { listOrdersForCustomer } from "@/server/orders";
import { listQuotesForCustomer } from "@/server/quotes";
import { requireRole } from "@/server/session";

export const metadata: Metadata = { title: "My quotes & orders" };

export default async function PortalHome() {
  const actor = await requireRole(["customer"], "/portal");
  const [quotes, orders] = await Promise.all([
    listQuotesForCustomer(actor),
    listOrdersForCustomer(actor),
  ]);
  return (
    <>
      <PageHeader
        title={`Welcome, ${actor.name}`}
        description="Your requests for quote, issued quotes and orders."
        actions={<LinkButton href="/quote">Request a quote</LinkButton>}
      />
      <div className="space-y-6">
        <Card title="Quotes">
          {quotes.length === 0 ? (
            <EmptyState>
              No quotes yet.{" "}
              <Link className="font-medium text-blue-700 underline" href="/quote">
                Request your first quote
              </Link>
              .
            </EmptyState>
          ) : (
            <TableWrap label="Quotes">
              <thead>
                <tr>
                  <th className={th}>Reference</th>
                  <th className={th}>Item</th>
                  <th className={th}>Quantity</th>
                  <th className={th}>Delivery</th>
                  <th className={th}>Status</th>
                  <th className={th}>Total</th>
                  <th className={th}>Valid until</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map(({ quote, itemName, itemUnit }) => (
                  <tr key={quote.id}>
                    <td className={td}>
                      <Link
                        className="font-medium text-blue-700 underline underline-offset-2"
                        href={`/portal/quotes/${quote.id}`}
                      >
                        {quote.reference}
                      </Link>
                    </td>
                    <td className={td}>{itemName}</td>
                    <td className={td}>{formatQuantity(quote.quantity, itemUnit)}</td>
                    <td className={td}>{NODE_LABELS[quote.deliveryNode]}</td>
                    <td className={td}>
                      <StatusBadge status={quote.status} />
                    </td>
                    <td className={td}>{formatMoney(quote.totalCents)}</td>
                    <td className={td}>{formatDate(quote.validUntil)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
        <Card title="Orders">
          {orders.length === 0 ? (
            <EmptyState>No orders yet. Accept an issued quote to place an order.</EmptyState>
          ) : (
            <TableWrap label="Orders">
              <thead>
                <tr>
                  <th className={th}>Reference</th>
                  <th className={th}>Item</th>
                  <th className={th}>Quantity</th>
                  <th className={th}>Status</th>
                  <th className={th}>Total</th>
                  <th className={th}>Deposit</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(({ order, itemName, itemUnit }) => (
                  <tr key={order.id}>
                    <td className={td}>
                      <Link
                        className="font-medium text-blue-700 underline underline-offset-2"
                        href={`/portal/orders/${order.id}`}
                      >
                        {order.reference}
                      </Link>
                    </td>
                    <td className={td}>{itemName}</td>
                    <td className={td}>{formatQuantity(order.quantity, itemUnit)}</td>
                    <td className={td}>
                      <StatusBadge status={order.status} />
                    </td>
                    <td className={td}>{formatMoney(order.totalCents)}</td>
                    <td className={td}>{formatMoney(order.depositCents)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      </div>
    </>
  );
}
