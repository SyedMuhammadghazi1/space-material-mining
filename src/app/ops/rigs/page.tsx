import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/components/form";
import { Card, EmptyState, PageHeader, StatusBadge, TableWrap, td, th } from "@/components/ui";
import { formatNumber, formatRelative } from "@/lib/format";
import { PROCESS_MODELS } from "@/lib/models";
import { STAFF_ROLES, hasRole } from "@/server/authz";
import { listDepots } from "@/server/inventory";
import { listMissions } from "@/server/missions";
import { listRigs } from "@/server/rigs";
import { requireRole } from "@/server/session";
import { createRigAction } from "./actions";

export const metadata: Metadata = { title: "Extraction rigs" };

export default async function RigsPage() {
  const actor = await requireRole(STAFF_ROLES, "/ops/rigs");
  const canManage = hasRole(actor, ["operator", "admin"]);
  const [rigs, missions, depots] = await Promise.all([
    listRigs(actor),
    listMissions(actor),
    listDepots(),
  ]);
  return (
    <>
      <PageHeader
        title="Extraction rigs"
        description="Rigs report telemetry with their own API keys; output is credited to the rig's depot."
      />
      <div className="space-y-6">
        <Card title="Rigs">
          {rigs.length === 0 ? (
            <EmptyState>No rigs registered.</EmptyState>
          ) : (
            <TableWrap label="Rigs">
              <thead>
                <tr>
                  <th className={th}>Rig</th>
                  <th className={th}>Process</th>
                  <th className={th}>Mission / depot</th>
                  <th className={th}>Last seen</th>
                  <th className={th}>Last seq</th>
                  <th className={th}>Keys</th>
                  <th className={th}>Alerts</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rigs.map((r) => (
                  <tr key={r.id}>
                    <td className={td}>
                      <Link
                        className="font-medium text-blue-700 underline underline-offset-2"
                        href={`/ops/rigs/${r.id}`}
                      >
                        {r.name}
                      </Link>
                      <span className="block text-xs text-slate-500">
                        {formatNumber(r.ratedPowerKw, 0)} kW rated
                      </span>
                    </td>
                    <td className={td}>{PROCESS_MODELS[r.processId].label}</td>
                    <td className={td}>
                      {r.missionName}
                      <span className="block text-xs text-slate-500">{r.depotName}</span>
                    </td>
                    <td className={td}>{formatRelative(r.lastSeenAt)}</td>
                    <td className={td}>{r.lastSeq ?? "—"}</td>
                    <td className={td}>{r.activeKeys}</td>
                    <td className={td}>{r.openAlerts > 0 ? <StatusBadge status="open" /> : "—"}</td>
                    <td className={td}>
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
        {canManage && (
          <Card
            title="Register a rig"
            description="Operating temperature limits are taken from the process model."
          >
            {missions.length === 0 ? (
              <EmptyState>An engineer must create a mission first.</EmptyState>
            ) : (
              <ActionForm action={createRigAction} className="grid gap-4 md:grid-cols-2">
                <TextField label="Rig name" name="name" required maxLength={80} />
                <SelectField
                  label="Mission"
                  name="missionId"
                  required
                  placeholder="Choose…"
                  options={missions.map((m) => ({ value: m.id, label: m.name }))}
                />
                <SelectField
                  label="Process"
                  name="processId"
                  required
                  options={Object.values(PROCESS_MODELS).map((p) => ({
                    value: p.id,
                    label: p.label,
                  }))}
                />
                <TextField
                  label="Rated power (kW)"
                  name="ratedPowerKw"
                  type="number"
                  min={1}
                  step="any"
                  required
                />
                <SelectField
                  label="Output depot (defaults to mission depot)"
                  name="depotId"
                  placeholder="Mission default"
                  options={depots.map((d) => ({ value: d.id, label: d.name }))}
                />
                <div className="self-end">
                  <SubmitButton>Register rig</SubmitButton>
                </div>
              </ActionForm>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
