import type { Metadata } from "next";
import { Card, EmptyState, PageHeader, TableWrap, td, th } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { ADMIN_ONLY } from "@/server/authz";
import { requireRole } from "@/server/session";
import { listAuditLog } from "@/server/users";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage() {
  const actor = await requireRole(ADMIN_ONLY, "/admin/audit");
  const entries = await listAuditLog(actor, 300);
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Sensitive actions: role changes, API keys, inventory adjustments and transfers, quotes, orders and payments."
      />
      <Card>
        {entries.length === 0 ? (
          <EmptyState>No audit entries yet.</EmptyState>
        ) : (
          <TableWrap label="Audit entries">
            <thead>
              <tr>
                <th className={th}>When</th>
                <th className={th}>Actor</th>
                <th className={th}>Action</th>
                <th className={th}>Entity</th>
                <th className={th}>Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className={td}>{formatDateTime(e.createdAt)}</td>
                  <td className={td}>{e.actorLabel ?? "—"}</td>
                  <td className={`${td} font-mono text-xs`}>{e.action}</td>
                  <td className={`${td} text-xs`}>
                    {e.entityType}
                    <span className="block text-slate-500">{e.entityId}</span>
                  </td>
                  <td
                    className={`${td} max-w-md font-mono text-xs break-all whitespace-normal text-slate-600`}
                  >
                    {JSON.stringify(e.metadata)}
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
