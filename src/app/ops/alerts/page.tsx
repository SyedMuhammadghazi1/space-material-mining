import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/form";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  StatusBadge,
  TableWrap,
  td,
  th,
} from "@/components/ui";
import { getEnv } from "@/env";
import { formatDateTime } from "@/lib/format";
import { listAlerts } from "@/server/alerts";
import { STAFF_ROLES, hasRole } from "@/server/authz";
import { requireRole } from "@/server/session";
import { resolveAlertAction, runHealthCheckAction } from "./actions";

export const metadata: Metadata = { title: "Alerts" };

export default async function AlertsPage() {
  const actor = await requireRole(STAFF_ROLES, "/ops/alerts");
  const alerts = await listAlerts(actor, { limit: 200 });
  const canManage = hasRole(actor, ["operator", "admin"]);
  return (
    <>
      <PageHeader
        title="Rig alerts"
        description={`The rig-health job flags rigs silent for more than ${getEnv().RIG_SILENT_MINUTES} minutes and out-of-range readings, and emails operators once per alert.`}
        actions={
          canManage ? (
            <ActionForm action={runHealthCheckAction}>
              <SubmitButton variant="secondary" pendingLabel="Checking…">
                Run health check now
              </SubmitButton>
            </ActionForm>
          ) : undefined
        }
      />
      <Card>
        {alerts.length === 0 ? (
          <EmptyState>No alerts recorded.</EmptyState>
        ) : (
          <TableWrap label="Alerts">
            <thead>
              <tr>
                <th className={th}>Status</th>
                <th className={th}>Kind</th>
                <th className={th}>Rig</th>
                <th className={th}>Message</th>
                <th className={th}>Opened</th>
                <th className={th}>Emailed</th>
                <th className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {alerts.map(({ alert, rigName }) => (
                <tr key={alert.id}>
                  <td className={td}>
                    <StatusBadge status={alert.status} />
                  </td>
                  <td className={td}>
                    <Badge tone={alert.kind === "silent" ? "warn" : "bad"}>
                      {alert.kind === "silent" ? "Silent" : "Out of range"}
                    </Badge>
                  </td>
                  <td className={td}>
                    <Link className="text-blue-700 underline" href={`/ops/rigs/${alert.rigId}`}>
                      {rigName}
                    </Link>
                  </td>
                  <td className={`${td} max-w-md whitespace-normal`}>{alert.message}</td>
                  <td className={td}>{formatDateTime(alert.createdAt)}</td>
                  <td className={td}>{alert.emailedAt ? formatDateTime(alert.emailedAt) : "—"}</td>
                  <td className={td}>
                    {canManage && alert.status === "open" && (
                      <ActionForm action={resolveAlertAction.bind(null, alert.id)}>
                        <SubmitButton variant="secondary" className="px-2 py-1 text-xs">
                          Resolve
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
