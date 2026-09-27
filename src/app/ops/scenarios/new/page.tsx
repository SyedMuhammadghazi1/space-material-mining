import type { Metadata } from "next";
import { ActionForm, SubmitButton, TextArea, TextField } from "@/components/form";
import { ScenarioFields } from "@/components/scenario-fields";
import { Card, PageHeader, PlanningDisclaimer } from "@/components/ui";
import { DEFAULT_SCENARIO_FORM } from "@/lib/scenario-input";
import { ENGINEERING } from "@/server/authz";
import { requireRole } from "@/server/session";
import { listTargets } from "@/server/targets";
import { createScenarioAction } from "../actions";

export const metadata: Metadata = { title: "New mission scenario" };

export default async function NewScenarioPage({
  searchParams,
}: {
  searchParams: Promise<{ targetId?: string }>;
}) {
  const actor = await requireRole(ENGINEERING, "/ops/scenarios/new");
  const { targetId } = await searchParams;
  const targets = await listTargets(actor);
  const values = Object.fromEntries(
    Object.entries({
      ...DEFAULT_SCENARIO_FORM,
      targetId: targetId ?? targets[0]?.id ?? "",
      processId: "mre",
    }).map(([k, v]) => [k, Array.isArray(v) ? v : String(v)]),
  );
  return (
    <>
      <PageHeader
        title="New mission scenario"
        description="Pick a target and process, adjust the assumptions and compute. The result is saved as an immutable snapshot."
      />
      <div className="space-y-6">
        <PlanningDisclaimer compact />
        <Card>
          <ActionForm action={createScenarioAction} className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                label="Scenario name"
                name="name"
                required
                maxLength={120}
                placeholder="e.g. Tranquillitatis MRE pilot — EML1 delivery"
              />
              <TextArea label="Notes (optional)" name="notes" maxLength={2000} rows={2} />
            </div>
            <ScenarioFields
              targets={targets.map((t) => ({
                value: t.id,
                label: `${t.name}${t.kind === "nea" ? " (NEA)" : ""}`,
              }))}
              values={values}
            />
            <SubmitButton pendingLabel="Computing…">Compute &amp; save scenario</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
