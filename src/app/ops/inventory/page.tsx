import type { Metadata } from "next";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/components/form";
import { Card, EmptyState, PageHeader, TableWrap, td, th } from "@/components/ui";
import {
  formatDateTime,
  formatDeltaV,
  formatMass,
  formatMoney,
  formatNumber,
  formatQuantity,
  humanize,
} from "@/lib/format";
import { nodeToNodeDeltaV } from "@/lib/models";
import { STAFF_ROLES, hasRole } from "@/server/authz";
import { getBalances, listDepots, listItems, listLedger, listTransfers } from "@/server/inventory";
import { requireRole } from "@/server/session";
import { adjustmentAction, transferAction } from "./actions";

export const metadata: Metadata = { title: "Inventory ledger" };

export default async function InventoryPage() {
  const actor = await requireRole(STAFF_ROLES, "/ops/inventory");
  const canManage = hasRole(actor, ["operator", "admin"]);
  const [balances, depots, items, ledger, transfers] = await Promise.all([
    getBalances(actor),
    listDepots(),
    listItems(),
    listLedger(actor, { limit: 50 }),
    listTransfers(actor, 20),
  ]);
  const depotName = new Map(depots.map((d) => [d.id, d.name]));
  const itemOptions = items.map((i) => ({ value: i.code, label: `${i.name} (${i.unit})` }));
  const depotOptions = depots.map((d) => ({
    value: d.id,
    label: `${d.name} — ${d.node.replace("_", " ")}`,
  }));
  return (
    <>
      <PageHeader
        title="Material inventory ledger"
        description="Append-only ledger across space depots. Balances are computed from the ledger; withdrawals lock the balance row and can never go negative."
      />
      <div className="space-y-6">
        <Card title="Balances by depot & material">
          {balances.length === 0 ? (
            <EmptyState>
              No stock yet — rig telemetry, fabrication output and adjustments create ledger
              entries.
            </EmptyState>
          ) : (
            <TableWrap label="Balances">
              <thead>
                <tr>
                  <th className={th}>Depot</th>
                  <th className={th}>Item</th>
                  <th className={`${th} text-right`}>On hand</th>
                  <th className={`${th} text-right`}>Reserved</th>
                  <th className={`${th} text-right`}>Available</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((b) => (
                  <tr key={`${b.depotId}-${b.itemCode}`}>
                    <td className={td}>{b.depotName}</td>
                    <td className={td}>{b.itemName}</td>
                    <td className={`${td} text-right`}>{formatQuantity(b.onHand, b.unit)}</td>
                    <td className={`${td} text-right`}>
                      {b.reserved ? formatQuantity(b.reserved, b.unit) : "—"}
                    </td>
                    <td className={`${td} text-right font-medium`}>
                      {formatQuantity(b.available, b.unit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>

        {canManage && (
          <div className="grid gap-6 xl:grid-cols-2">
            <Card
              title="Transfer between depots"
              description="Records the transport mission with Δv from the node map and propellant cost from the rocket equation (450 s, 10% tankage)."
            >
              <ActionForm action={transferAction} className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  label="From depot"
                  name="fromDepotId"
                  required
                  placeholder="Choose…"
                  options={depotOptions}
                />
                <SelectField
                  label="To depot"
                  name="toDepotId"
                  required
                  placeholder="Choose…"
                  options={depotOptions}
                />
                <SelectField
                  label="Item"
                  name="itemCode"
                  required
                  placeholder="Choose…"
                  options={itemOptions}
                />
                <TextField
                  label="Quantity"
                  name="quantity"
                  type="number"
                  min={0.001}
                  step="any"
                  required
                />
                <TextField
                  label="Transport mission"
                  name="transportMission"
                  required
                  maxLength={120}
                  placeholder="e.g. Tug T-2 flight 14"
                  className="sm:col-span-2"
                />
                <div className="sm:col-span-2">
                  <SubmitButton>Record transfer</SubmitButton>
                </div>
              </ActionForm>
            </Card>
            <Card
              title="Adjustment"
              description="Corrections and stock counts. A reason is mandatory and the action is audit-logged."
            >
              <ActionForm action={adjustmentAction} className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  label="Depot"
                  name="depotId"
                  required
                  placeholder="Choose…"
                  options={depotOptions}
                />
                <SelectField
                  label="Item"
                  name="itemCode"
                  required
                  placeholder="Choose…"
                  options={itemOptions}
                />
                <TextField
                  label="Quantity change (+/−)"
                  name="delta"
                  type="number"
                  step="any"
                  required
                />
                <TextField label="Reason" name="reason" required minLength={5} maxLength={500} />
                <div className="sm:col-span-2">
                  <SubmitButton>Record adjustment</SubmitButton>
                </div>
              </ActionForm>
            </Card>
          </div>
        )}

        <Card
          title="Depot-to-depot Δv"
          description="One-way, fully propulsive values from the cis-lunar node map."
        >
          <TableWrap label="Depot delta-v matrix">
            <thead>
              <tr>
                <th className={th}>From \ To</th>
                {depots.map((d) => (
                  <th key={d.id} className={th}>
                    {d.code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {depots.map((a) => (
                <tr key={a.id}>
                  <th scope="row" className={`${td} font-medium`}>
                    {a.name}
                  </th>
                  {depots.map((b) => (
                    <td key={b.id} className={td}>
                      {a.id === b.id
                        ? "—"
                        : formatDeltaV(nodeToNodeDeltaV(a.node, b.node).deltaVMs)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>

        <Card title="Recent transfers">
          {transfers.length === 0 ? (
            <EmptyState>No transfers yet.</EmptyState>
          ) : (
            <TableWrap label="Transfers">
              <thead>
                <tr>
                  <th className={th}>When</th>
                  <th className={th}>Route</th>
                  <th className={th}>Item</th>
                  <th className={`${th} text-right`}>Quantity</th>
                  <th className={th}>Mission</th>
                  <th className={`${th} text-right`}>Δv</th>
                  <th className={`${th} text-right`}>Propellant</th>
                  <th className={`${th} text-right`}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t) => (
                  <tr key={t.id}>
                    <td className={td}>{formatDateTime(t.createdAt)}</td>
                    <td className={td}>
                      {depotName.get(t.fromDepotId)} → {depotName.get(t.toDepotId)}
                    </td>
                    <td className={td}>{t.itemCode}</td>
                    <td className={`${td} text-right`}>{formatNumber(t.quantity, 3)}</td>
                    <td className={td}>{t.transportMission}</td>
                    <td className={`${td} text-right`}>{formatDeltaV(t.deltaVMs)}</td>
                    <td className={`${td} text-right`}>{formatMass(t.propellantKg)}</td>
                    <td className={`${td} text-right`}>{formatMoney(t.costCents)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>

        <Card title="Ledger (latest 50 entries)">
          {ledger.length === 0 ? (
            <EmptyState>The ledger is empty.</EmptyState>
          ) : (
            <TableWrap label="Ledger entries">
              <thead>
                <tr>
                  <th className={th}>#</th>
                  <th className={th}>When</th>
                  <th className={th}>Depot</th>
                  <th className={th}>Item</th>
                  <th className={th}>Type</th>
                  <th className={`${th} text-right`}>Change</th>
                  <th className={`${th} text-right`}>Balance after</th>
                  <th className={th}>Reason / reference</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((e) => (
                  <tr key={e.id}>
                    <td className={td}>{e.id}</td>
                    <td className={td}>{formatDateTime(e.createdAt)}</td>
                    <td className={td}>{e.depotName}</td>
                    <td className={td}>{e.itemCode}</td>
                    <td className={td}>{humanize(e.entryType)}</td>
                    <td
                      className={`${td} text-right ${e.quantity < 0 ? "text-red-800" : "text-green-800"}`}
                    >
                      {e.quantity > 0 ? "+" : ""}
                      {formatNumber(e.quantity, 3)}
                    </td>
                    <td className={`${td} text-right`}>{formatNumber(e.balanceAfter, 3)}</td>
                    <td className={`${td} max-w-xs text-xs whitespace-normal text-slate-600`}>
                      {e.reason ??
                        (typeof e.metadata.transportMission === "string"
                          ? e.metadata.transportMission
                          : typeof e.metadata.seqFrom === "number"
                            ? `telemetry seq ${e.metadata.seqFrom}–${e.metadata.seqTo}`
                            : typeof e.metadata.orderReference === "string"
                              ? `order ${e.metadata.orderReference}`
                              : "—")}
                    </td>
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
