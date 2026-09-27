import type { Metadata } from "next";
import { EconomicsExplorer } from "@/components/economics-explorer";
import { PageHeader, PlanningDisclaimer } from "@/components/ui";
import { DEFAULT_SCENARIO_FORM } from "@/lib/scenario-input";
import { STAFF_ROLES } from "@/server/authz";
import { requireRole } from "@/server/session";
import { listTargets } from "@/server/targets";

export const metadata: Metadata = { title: "Economics explorer" };

export default async function EconomicsPage() {
  const actor = await requireRole(STAFF_ROLES, "/ops/economics");
  const targets = await listTargets(actor);
  const initial = Object.fromEntries(
    Object.entries({
      ...DEFAULT_SCENARIO_FORM,
      targetId: targets[0]?.id ?? "",
      processId: "mre",
      productElements: [] as string[],
    }).map(([k, v]) => [k, Array.isArray(v) ? v : String(v)]),
  );
  return (
    <>
      <PageHeader
        title="Economics explorer"
        description="Try assumptions interactively — nothing is saved. Inputs are validated and computed on the server. Save a scenario to keep a snapshot."
      />
      <div className="space-y-6">
        <PlanningDisclaimer compact />
        <EconomicsExplorer
          targets={targets.map((t) => ({
            value: t.id,
            label: `${t.name}${t.kind === "nea" ? " (NEA)" : ""}`,
          }))}
          initial={initial}
        />
      </div>
    </>
  );
}
