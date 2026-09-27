import type { Metadata } from "next";
import Link from "next/link";
import {
  Button,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  PlanningDisclaimer,
  TableWrap,
  td,
  th,
} from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { NODE_LABELS, PROCESS_MODELS, type ScenarioResult } from "@/lib/models";
import { STAFF_ROLES, hasRole } from "@/server/authz";
import { listScenarios } from "@/server/scenarios";
import { requireRole } from "@/server/session";

export const metadata: Metadata = { title: "Mission scenarios" };

export default async function ScenariosPage() {
  const actor = await requireRole(STAFF_ROLES, "/ops/scenarios");
  const scenarios = await listScenarios(actor);
  return (
    <>
      <PageHeader
        title="Mission scenarios"
        description="Immutable planning snapshots: every computed result is stored with the model version that produced it."
        actions={
          hasRole(actor, ["engineer", "admin"]) ? (
            <LinkButton href="/ops/scenarios/new">New scenario</LinkButton>
          ) : undefined
        }
      />
      <div className="space-y-6">
        <PlanningDisclaimer compact />
        <Card title="Saved scenarios" description="Tick two or more to compare side by side.">
          {scenarios.length === 0 ? (
            <EmptyState>No scenarios yet.</EmptyState>
          ) : (
            <form action="/ops/scenarios/compare" method="get" className="space-y-4">
              <TableWrap label="Scenarios">
                <thead>
                  <tr>
                    <th className={th}>
                      <span className="sr-only">Compare</span>
                    </th>
                    <th className={th}>Scenario</th>
                    <th className={th}>Process</th>
                    <th className={th}>Delivery</th>
                    <th className={`${th} text-right`}>Cost / kg</th>
                    <th className={`${th} text-right`}>Earth / kg</th>
                    <th className={`${th} text-right`}>NPV</th>
                    <th className={th}>Model</th>
                    <th className={th}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarios.map((s) => {
                    const r = s.results as unknown as ScenarioResult;
                    return (
                      <tr key={s.id}>
                        <td className={td}>
                          <input
                            type="checkbox"
                            name="ids"
                            value={s.id}
                            aria-label={`Compare ${s.name}`}
                            className="h-4 w-4"
                          />
                        </td>
                        <td className={td}>
                          <Link
                            href={`/ops/scenarios/${s.id}`}
                            className="font-medium text-blue-700 underline underline-offset-2"
                          >
                            {s.name}
                          </Link>
                          <span className="block text-xs text-slate-500">{s.targetName}</span>
                        </td>
                        <td className={td}>{PROCESS_MODELS[s.processId].label}</td>
                        <td className={td}>{NODE_LABELS[s.deliveryNode]}</td>
                        <td className={`${td} text-right`}>
                          {formatMoney(r.unitEconomics.costPerDeliveredKgCents)}
                        </td>
                        <td className={`${td} text-right`}>
                          {formatMoney(r.unitEconomics.earthLaunchCostPerKgAtNodeCents)}
                        </td>
                        <td className={`${td} text-right`}>
                          {formatMoney(r.finance.npvCents, { compact: true })}
                        </td>
                        <td className={td}>v{s.modelVersion}</td>
                        <td className={td}>
                          {formatDate(s.createdAt)}
                          <span className="block text-xs text-slate-500">
                            {s.authorName ?? "—"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
              <Button type="submit" variant="secondary">
                Compare selected
              </Button>
            </form>
          )}
        </Card>
      </div>
    </>
  );
}
