import type { Metadata } from "next";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/components/form";
import { Card, EmptyState, PageHeader, StatusBadge, TableWrap, td, th } from "@/components/ui";
import { formatDate, formatMoney, formatQuantity } from "@/lib/format";
import { NODE_LABELS } from "@/lib/models";
import { STAFF_ROLES, hasRole } from "@/server/authz";
import { listDepots } from "@/server/inventory";
import { listOrders } from "@/server/orders";
import { requireRole } from "@/server/session";
import { cancelOrderAction, fulfilOrderAction, reserveOrderAction } from "./actions";

export const metadata: Metadata = { title: "Orders" };

export default async function OrdersPage() {
  const actor = await requireRole(STAFF_ROLES, "/ops/orders");
  const canOperate = hasRole(actor, ["operator", "admin"]);
  const isAdmin = actor.role === "admin";
  const [orders, depots] = await Promise.all([listOrders(actor), listDepots()]);
  return (
    <>
      <PageHeader
        title="Orders"
        description="Confirmed orders (deposit paid) are reserved against depot stock, then fulfilled with a delivery ledger entry."
      />
      <Card>
        {orders.length === 0 ? (
          <EmptyState>No orders yet.</EmptyState>
        ) : (
          <TableWrap label="Orders">
            <thead>
              <tr>
                <th className={th}>Order</th>
                <th className={th}>Customer</th>
                <th className={th}>Item</th>
                <th className={th}>Delivery</th>
                <th className={`${th} text-right`}>Total / deposit</th>
                <th className={th}>Status</th>
                <th className={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(
                ({
                  order,
                  itemName,
                  itemUnit,
                  customerName,
                  customerCompany,
                  reservedDepotName,
                }) => (
                  <tr key={order.id}>
                    <td className={td}>
                      <span className="font-medium">{order.reference}</span>
                      <span className="block text-xs text-slate-500">
                        {formatDate(order.createdAt)}
                      </span>
                    </td>
                    <td className={td}>
                      {customerName}
                      {customerCompany && (
                        <span className="block text-xs text-slate-500">{customerCompany}</span>
                      )}
                    </td>
                    <td className={td}>
                      {formatQuantity(order.quantity, itemUnit)} {itemName}
                    </td>
                    <td className={td}>{NODE_LABELS[order.deliveryNode]}</td>
                    <td className={`${td} text-right`}>
                      {formatMoney(order.totalCents)}
                      <span className="block text-xs text-slate-500">
                        {formatMoney(order.depositCents)} deposit
                      </span>
                    </td>
                    <td className={td}>
                      <StatusBadge status={order.status} />
                      {reservedDepotName && (
                        <span className="block text-xs text-slate-500">at {reservedDepotName}</span>
                      )}
                    </td>
                    <td className={td}>
                      <div className="flex flex-col gap-2">
                        {canOperate && order.status === "confirmed" && (
                          <ActionForm
                            action={reserveOrderAction.bind(null, order.id)}
                            className="flex items-end gap-2"
                          >
                            <SelectField
                              label="Reserve at"
                              name="depotId"
                              id={`depot-${order.id}`}
                              required
                              placeholder="Depot…"
                              options={depots.map((d) => ({ value: d.id, label: d.name }))}
                            />
                            <SubmitButton className="px-2 py-1 text-xs">Reserve</SubmitButton>
                          </ActionForm>
                        )}
                        {canOperate && order.status === "reserved" && (
                          <ActionForm action={fulfilOrderAction.bind(null, order.id)}>
                            <SubmitButton className="px-2 py-1 text-xs">
                              Mark delivered
                            </SubmitButton>
                          </ActionForm>
                        )}
                        {isAdmin && !["fulfilled", "cancelled"].includes(order.status) && (
                          <ActionForm
                            action={cancelOrderAction.bind(null, order.id)}
                            className="flex items-end gap-2"
                          >
                            <TextField
                              label="Cancel reason"
                              name="reason"
                              id={`reason-${order.id}`}
                              required
                              minLength={3}
                              className="w-36"
                            />
                            <SubmitButton variant="danger" className="px-2 py-1 text-xs">
                              Cancel
                            </SubmitButton>
                          </ActionForm>
                        )}
                        {order.status === "awaiting_deposit" && (
                          <span className="text-xs text-slate-500">
                            Waiting for Stripe invoice payment
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
