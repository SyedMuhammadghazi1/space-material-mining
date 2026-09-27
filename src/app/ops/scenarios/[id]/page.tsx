import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/form";
import { ScenarioResults } from "@/components/scenario-results";
import { Card, DefinitionList, LinkButton, PageHeader, PlanningDisclaimer } from "@/components/ui";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { NODE_LABELS, PROCESS_MODELS, type EconomicsParams } from "@/lib/models";
import { STAFF_ROLES, hasRole } from "@/server/authz";
import { NotFoundError } from "@/server/errors";
import { getScenario } from "@/server/scenarios";
import { requireRole } from "@/server/session";
import { useAsCostBasisAction } from "../actions";

export const metadata: Metadata = { title: "Mission scenario" };

export default async function ScenarioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireRole(STAFF_ROLES, `/ops/scenarios/${id}`);
  const scenario = await getScenario(actor, id).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const inputs = scenario.inputs as unknown as EconomicsParams;
  const snap = scenario.targetSnapshot as { dataSource?: string; refreshedAt?: string | null };
  return (
    <>
      <PageHeader
        eyebrow="Mission scenario"
        title={scenario.name}
        description={`${scenario.targetName} · ${PROCESS_MODELS[scenario.processId].label} · delivered to ${NODE_LABELS[scenario.deliveryNode]}`}
        actions={
          <LinkButton href={`/ops/scenarios/new?targetId=${scenario.targetId}`} variant="secondary">
            New scenario for this target
          </LinkButton>
        }
      />
      <div className="space-y-6">
        <PlanningDisclaimer compact />
        <ScenarioResults result={scenario.results} deliveryNode={scenario.deliveryNode} />
        <Card
          title="Snapshot inputs"
          description={`Computed ${formatDateTime(scenario.createdAt)} with planning model v${scenario.modelVersion}. Snapshots are immutable.`}
        >
          <DefinitionList
            items={[
              ["Process power", `${formatNumber(inputs.powerKw, 0)} kW`],
              ["Uptime", `${formatNumber(inputs.uptimeFraction * 100, 0)}%`],
              ["Mission duration", `${formatNumber(inputs.missionDurationDays, 0)} days`],
              ["Stage Isp / tankage", `${inputs.ispSeconds} s / ${inputs.tankageFraction}`],
              ["Power system", `${inputs.powerSystemKgPerKw} kg/kW`],
              ["Launch to LEO", `${formatMoney(inputs.launchCostPerKgCents)}/kg`],
              ["Plant hardware", `${formatMoney(inputs.plantHardwareCostPerKgCents)}/kg`],
              ["Operations", `${formatMoney(inputs.opsCostPerYearCents)}/year`],
              ["In-space propellant", `${formatMoney(inputs.inSpacePropellantCostPerKgCents)}/kg`],
              ["Sale price", `${formatMoney(inputs.salePricePerKgCents)}/kg`],
              ["Discount rate", `${inputs.discountRatePercent}%`],
              [
                "Target data",
                snap.dataSource === "jpl_sbdb"
                  ? `JPL SBDB (${snap.refreshedAt?.slice(0, 10) ?? "—"})`
                  : "Approximate seed / nominal values",
              ],
              ["Notes", scenario.notes ?? "—"],
            ]}
          />
        </Card>
        {hasRole(actor, ["engineer", "admin"]) &&
          scenario.results.unitEconomics.costPerDeliveredKgCents !== null && (
            <Card
              title="Pricing basis"
              description="Publish this scenario's cost per delivered kg as the quote cost basis for the materials it ships, at its delivery node."
            >
              <ActionForm action={useAsCostBasisAction.bind(null, scenario.id)}>
                <SubmitButton variant="secondary">Use as pricing basis</SubmitButton>
              </ActionForm>
            </Card>
          )}
      </div>
    </>
  );
}
