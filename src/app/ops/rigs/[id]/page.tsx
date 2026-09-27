import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/form";
import { IssueKeyForm } from "@/components/issue-key-form";
import {
  Card,
  DefinitionList,
  EmptyState,
  PageHeader,
  StatusBadge,
  TableWrap,
  td,
  th,
} from "@/components/ui";
import { formatDateTime, formatMass, formatNumber, formatRelative } from "@/lib/format";
import { PROCESS_MODELS } from "@/lib/models";
import { STAFF_ROLES, hasRole } from "@/server/authz";
import { NotFoundError } from "@/server/errors";
import { getRigDetail } from "@/server/rigs";
import { requireRole } from "@/server/session";
import { issueKeyAction, retireRigAction, revokeKeyAction } from "../actions";

export const metadata: Metadata = { title: "Rig" };

export default async function RigPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireRole(STAFF_ROLES, `/ops/rigs/${id}`);
  const detail = await getRigDetail(actor, id).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const { rig } = detail;
  const canManage = hasRole(actor, ["operator", "admin"]) && rig.status === "active";
  return (
    <>
      <PageHeader
        eyebrow="Extraction rig"
        title={rig.name}
        description={`${PROCESS_MODELS[rig.processId].label} · ${detail.missionName} · credits ${detail.depotName}`}
        actions={<StatusBadge status={rig.status} />}
      />
      <div className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-2">
          <Card title="Status">
            <DefinitionList
              items={[
                [
                  "Last telemetry",
                  `${formatRelative(rig.lastSeenAt)} (${formatDateTime(rig.lastSeenAt)})`,
                ],
                ["Last sequence number", rig.lastSeq ?? "—"],
                ["Readings stored", formatNumber(detail.readingCount, 0)],
                ["Rated power", `${formatNumber(rig.ratedPowerKw, 0)} kW (alert above 110%)`],
                ["Temperature envelope", `${rig.tempMinC} – ${rig.tempMaxC} °C`],
                [
                  "Rig ID",
                  <code key="id" className="text-xs">
                    {rig.id}
                  </code>,
                ],
              ]}
            />
            {canManage && (
              <ActionForm action={retireRigAction.bind(null, rig.id)} className="mt-4">
                <SubmitButton variant="danger" pendingLabel="Retiring…">
                  Retire rig
                </SubmitButton>
              </ActionForm>
            )}
          </Card>
          <Card
            title="API keys"
            description="Keys are random, shown once, stored only as SHA-256 hashes, and revocable."
          >
            {detail.keys.length === 0 ? (
              <EmptyState>No keys issued.</EmptyState>
            ) : (
              <ul className="mb-4 divide-y divide-slate-100">
                {detail.keys.map((k) => (
                  <li
                    key={k.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  >
                    <div>
                      <code className="text-xs">{k.keyPrefix}…</code>{" "}
                      {k.label && <span className="text-slate-600">— {k.label}</span>}
                      <p className="text-xs text-slate-500">
                        Issued {formatDateTime(k.createdAt)} · last used{" "}
                        {formatRelative(k.lastUsedAt)}
                      </p>
                    </div>
                    {k.revokedAt ? (
                      <StatusBadge status="cancelled" />
                    ) : canManage ? (
                      <ActionForm action={revokeKeyAction.bind(null, rig.id, k.id)}>
                        <SubmitButton
                          variant="secondary"
                          className="px-2 py-1 text-xs"
                          pendingLabel="Revoking…"
                        >
                          Revoke
                        </SubmitButton>
                      </ActionForm>
                    ) : (
                      <StatusBadge status="active" />
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canManage && <IssueKeyForm action={issueKeyAction.bind(null, rig.id)} />}
          </Card>
        </div>
        <Card title="Recent telemetry">
          {detail.readings.length === 0 ? (
            <EmptyState>
              No telemetry received yet. Run <code>npm run sim:rig</code> against a local server to
              generate some.
            </EmptyState>
          ) : (
            <TableWrap label="Recent telemetry">
              <thead>
                <tr>
                  <th className={th}>Seq</th>
                  <th className={th}>Recorded</th>
                  <th className={`${th} text-right`}>Processed</th>
                  <th className={`${th} text-right`}>Power</th>
                  <th className={`${th} text-right`}>Temp</th>
                  <th className={th}>Output</th>
                  <th className={th}>Flags</th>
                </tr>
              </thead>
              <tbody>
                {detail.readings.map((r) => (
                  <tr key={r.id}>
                    <td className={td}>{r.seq}</td>
                    <td className={td}>{formatDateTime(r.recordedAt)}</td>
                    <td className={`${td} text-right`}>{formatMass(r.regolithProcessedKg)}</td>
                    <td className={`${td} text-right`}>{formatNumber(r.powerKw, 1)} kW</td>
                    <td className={`${td} text-right`}>{formatNumber(r.temperatureC, 0)} °C</td>
                    <td className={td}>
                      {Object.entries(r.output)
                        .map(([k, v]) => `${k} ${formatMass(v)}`)
                        .join(", ") || "—"}
                    </td>
                    <td className={`${td} max-w-xs whitespace-normal text-red-800`}>
                      {r.anomalies.join("; ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
        <Card title="Alert history">
          {detail.alerts.length === 0 ? (
            <EmptyState>No alerts for this rig.</EmptyState>
          ) : (
            <ul className="space-y-2 text-sm">
              {detail.alerts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={a.status} /> <span>{a.message}</span>{" "}
                  <span className="text-xs text-slate-500">{formatDateTime(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
