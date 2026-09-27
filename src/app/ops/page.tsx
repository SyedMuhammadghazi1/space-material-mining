import type { Metadata } from "next";
import Link from "next/link";
import { ProductionChart } from "@/components/production-chart";
import {
  Card,
  EmptyState,
  PageHeader,
  Stat,
  StatusBadge,
  TableWrap,
  td,
  th,
} from "@/components/ui";
import { formatDateTime, formatMass, formatQuantity } from "@/lib/format";
import { STAFF_ROLES } from "@/server/authz";
import { getMissionControl } from "@/server/dashboard";
import { requireRole } from "@/server/session";

export const metadata: Metadata = { title: "Mission control" };

export default async function MissionControlPage() {
  const actor = await requireRole(STAFF_ROLES, "/ops");
  const mc = await getMissionControl(actor, 48);
  const produced24h = mc.last24h.reduce((s, r) => s + (r.itemCode === "REGOLITH" ? 0 : r.kg), 0);
  const depots = [...new Set(mc.balances.map((b) => b.depotName))];
  return (
    <>
      <PageHeader
        title="Mission control"
        description="Live extraction, inventory and alert status across all depots."
      />
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat
            label="Active rigs"
            value={mc.rigs.active}
            hint={`${mc.rigs.reporting} reporting recently`}
          />
          <Stat
            label="Silent rigs"
            value={mc.rigs.active - mc.rigs.reporting}
            hint="No telemetry within the silence window"
          />
          <Stat label="Open alerts" value={mc.openAlerts.length} />
          <Stat
            label="Processed output, 24 h"
            value={formatMass(produced24h)}
            hint="Excludes excavated regolith"
          />
        </div>

        <Card
          title="Production rate"
          description={`Material output reported by rigs, kg per hour, last ${mc.hours} hours (UTC).`}
        >
          <ProductionChart points={mc.series} hours={mc.hours} endIso={new Date().toISOString()} />
        </Card>

        <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
          <Card
            title="Inventory by depot & material"
            description="Computed from the append-only ledger."
            actions={
              <Link className="text-sm font-medium text-blue-700 underline" href="/ops/inventory">
                Open ledger
              </Link>
            }
          >
            {mc.balances.length === 0 ? (
              <EmptyState>No stock recorded yet.</EmptyState>
            ) : (
              <div className="space-y-5">
                {depots.map((d) => (
                  <div key={d}>
                    <h3 className="mb-1 text-sm font-semibold text-slate-800">{d}</h3>
                    <TableWrap>
                      <thead>
                        <tr>
                          <th className={th}>Item</th>
                          <th className={`${th} text-right`}>On hand</th>
                          <th className={`${th} text-right`}>Reserved</th>
                          <th className={`${th} text-right`}>Available</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mc.balances
                          .filter((b) => b.depotName === d)
                          .map((b) => (
                            <tr key={b.itemCode}>
                              <td className={td}>{b.itemName}</td>
                              <td className={`${td} text-right`}>
                                {formatQuantity(b.onHand, b.unit)}
                              </td>
                              <td className={`${td} text-right`}>
                                {b.reserved ? formatQuantity(b.reserved, b.unit) : "—"}
                              </td>
                              <td className={`${td} text-right`}>
                                {formatQuantity(b.available, b.unit)}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </TableWrap>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card
            title="Open alerts"
            actions={
              <Link className="text-sm font-medium text-blue-700 underline" href="/ops/alerts">
                All alerts
              </Link>
            }
          >
            {mc.openAlerts.length === 0 ? (
              <EmptyState>All rigs nominal.</EmptyState>
            ) : (
              <ul className="space-y-3">
                {mc.openAlerts.map(({ alert, rigName }) => (
                  <li
                    key={alert.id}
                    className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        href={`/ops/rigs/${alert.rigId}`}
                        className="font-medium text-red-900 underline underline-offset-2"
                      >
                        {rigName}
                      </Link>
                      <StatusBadge status={alert.kind === "silent" ? "open" : "failed"} />
                    </div>
                    <p className="mt-1 text-red-900">
                      <span aria-hidden="true">⚠ </span>
                      {alert.message}
                    </p>
                    <p className="mt-0.5 text-xs text-red-800">{formatDateTime(alert.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
