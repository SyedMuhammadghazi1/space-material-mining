import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/components/form";
import { Card, EmptyState, PageHeader, StatusBadge, TableWrap, td, th } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { STAFF_ROLES, hasRole } from "@/server/authz";
import { listDepots } from "@/server/inventory";
import { listMissions } from "@/server/missions";
import { listScenarios } from "@/server/scenarios";
import { requireRole } from "@/server/session";
import { listTargets } from "@/server/targets";
import { createMissionAction } from "./actions";

export const metadata: Metadata = { title: "Missions" };

export default async function MissionsPage() {
  const actor = await requireRole(STAFF_ROLES, "/ops/missions");
  const canCreate = hasRole(actor, ["engineer", "admin"]);
  const [missions, targets, depots, scenarios] = await Promise.all([
    listMissions(actor),
    listTargets(actor),
    listDepots(),
    canCreate ? listScenarios(actor) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader
        title="Missions"
        description="Operational missions that extraction rigs are attached to. Each credits its output to a depot."
      />
      <div className="space-y-6">
        <Card title="Missions">
          {missions.length === 0 ? (
            <EmptyState>No missions yet.</EmptyState>
          ) : (
            <TableWrap label="Missions">
              <thead>
                <tr>
                  <th className={th}>Mission</th>
                  <th className={th}>Target</th>
                  <th className={th}>Output depot</th>
                  <th className={th}>Baseline scenario</th>
                  <th className={th}>Status</th>
                  <th className={th}>Created</th>
                </tr>
              </thead>
              <tbody>
                {missions.map((m) => (
                  <tr key={m.id}>
                    <td className={`${td} font-medium`}>{m.name}</td>
                    <td className={td}>{m.targetName}</td>
                    <td className={td}>{m.depotName}</td>
                    <td className={td}>
                      {m.scenarioId ? (
                        <Link
                          className="text-blue-700 underline"
                          href={`/ops/scenarios/${m.scenarioId}`}
                        >
                          View
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={td}>
                      <StatusBadge status={m.status} />
                    </td>
                    <td className={td}>{formatDate(m.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
        {canCreate && (
          <Card title="Create mission">
            <ActionForm action={createMissionAction} className="grid gap-4 md:grid-cols-2">
              <TextField label="Mission name" name="name" required maxLength={120} />
              <SelectField
                label="Target"
                name="targetId"
                required
                placeholder="Choose…"
                options={targets.map((t) => ({ value: t.id, label: t.name }))}
              />
              <SelectField
                label="Output depot"
                name="depotId"
                required
                placeholder="Choose…"
                options={depots.map((d) => ({ value: d.id, label: d.name }))}
              />
              <SelectField
                label="Baseline scenario (optional)"
                name="scenarioId"
                placeholder="None"
                options={scenarios.map((s) => ({ value: s.id, label: s.name }))}
              />
              <div className="md:col-span-2">
                <SubmitButton>Create mission</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
