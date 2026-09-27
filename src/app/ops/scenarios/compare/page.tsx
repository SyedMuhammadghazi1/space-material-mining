import type { Metadata } from "next";
import Link from "next/link";
import {
  Card,
  EmptyState,
  PageHeader,
  PlanningDisclaimer,
  TableWrap,
  td,
  th,
} from "@/components/ui";
import { formatDeltaV, formatMass, formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { NODE_LABELS, PROCESS_MODELS } from "@/lib/models";
import { STAFF_ROLES } from "@/server/authz";
import { getScenarios } from "@/server/scenarios";
import { requireRole } from "@/server/session";

export const metadata: Metadata = { title: "Compare scenarios" };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string | string[] }>;
}) {
  const actor = await requireRole(STAFF_ROLES, "/ops/scenarios");
  const raw = (await searchParams).ids;
  const ids = (Array.isArray(raw) ? raw : raw ? raw.split(",") : [])
    .filter((i) => UUID.test(i))
    .slice(0, 6);
  const scenarios = await getScenarios(actor, ids);
  const rows: [string, (s: (typeof scenarios)[number]) => string][] = [
    ["Target", (s) => s.targetName],
    ["Process", (s) => PROCESS_MODELS[s.processId].label],
    ["Delivery node", (s) => NODE_LABELS[s.deliveryNode]],
    ["Δv LEO → site", (s) => formatDeltaV(s.results.deltaV.outboundFromLeoMs)],
    ["Δv site → node", (s) => formatDeltaV(s.results.deltaV.returnToNodeMs)],
    ["Plant mass", (s) => formatMass(s.results.plant.massKg)],
    ["Feedstock processed", (s) => formatMass(s.results.production.regolithProcessedKg)],
    ["Delivered product", (s) => formatMass(s.results.production.deliveredKg)],
    ["Total cost", (s) => formatMoney(s.results.costs.totalCents, { compact: true })],
    ["Cost per kg delivered", (s) => formatMoney(s.results.unitEconomics.costPerDeliveredKgCents)],
    [
      "Earth-launched per kg",
      (s) => formatMoney(s.results.unitEconomics.earthLaunchCostPerKgAtNodeCents),
    ],
    ["Cost vs Earth", (s) => formatPercent(s.results.unitEconomics.costRatioVsEarth, 0)],
    ["NPV", (s) => formatMoney(s.results.finance.npvCents, { compact: true })],
    ["Breakeven price", (s) => formatMoney(s.results.finance.breakevenPricePerKgCents)],
    ["Duration", (s) => `${formatNumber(s.results.finance.years, 1)} years`],
    ["Model version", (s) => `v${s.modelVersion}`],
  ];
  return (
    <>
      <PageHeader title="Compare scenarios" description="Side-by-side snapshot results." />
      <div className="space-y-6">
        <PlanningDisclaimer compact />
        <Card>
          {scenarios.length < 2 ? (
            <EmptyState>
              Select at least two scenarios on the{" "}
              <Link className="text-blue-700 underline" href="/ops/scenarios">
                scenarios page
              </Link>
              .
            </EmptyState>
          ) : (
            <TableWrap label="Scenario comparison">
              <thead>
                <tr>
                  <th className={th}>Metric</th>
                  {scenarios.map((s) => (
                    <th key={s.id} className={th}>
                      <Link
                        href={`/ops/scenarios/${s.id}`}
                        className="text-blue-700 normal-case underline"
                      >
                        {s.name}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, fn]) => (
                  <tr key={label}>
                    <th scope="row" className={`${td} font-medium text-slate-600`}>
                      {label}
                    </th>
                    {scenarios.map((s) => (
                      <td key={s.id} className={td}>
                        {fn(s)}
                      </td>
                    ))}
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
