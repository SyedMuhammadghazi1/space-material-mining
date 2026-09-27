import type { Metadata } from "next";
import { ActionForm, SelectField, SubmitButton } from "@/components/form";
import { Card, PageHeader, TableWrap, td, th } from "@/components/ui";
import { USER_ROLES } from "@/db/schema";
import { formatDate } from "@/lib/format";
import { ADMIN_ONLY, ROLE_LABELS } from "@/server/authz";
import { requireRole } from "@/server/session";
import { listUsers } from "@/server/users";
import { setRoleAction } from "./actions";

export const metadata: Metadata = { title: "Users & roles" };

export default async function UsersPage() {
  const actor = await requireRole(ADMIN_ONLY, "/admin/users");
  const users = await listUsers(actor);
  return (
    <>
      <PageHeader
        title="Users & roles"
        description="Buyers self-register as customers. Staff roles are granted here and every change is audit-logged."
      />
      <Card>
        <TableWrap label="Users">
          <thead>
            <tr>
              <th className={th}>User</th>
              <th className={th}>Company</th>
              <th className={th}>Joined</th>
              <th className={th}>Role</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className={td}>
                  <span className="font-medium">{u.name}</span>
                  <span className="block text-xs text-slate-500">{u.email}</span>
                </td>
                <td className={td}>{u.company ?? "—"}</td>
                <td className={td}>{formatDate(u.createdAt)}</td>
                <td className={td}>
                  {u.id === actor.id ? (
                    <span className="text-sm">{ROLE_LABELS[u.role]} (you)</span>
                  ) : (
                    <ActionForm
                      action={setRoleAction.bind(null, u.id)}
                      className="flex items-end gap-2"
                    >
                      <SelectField
                        label="Role"
                        name="role"
                        id={`role-${u.id}`}
                        defaultValue={u.role}
                        options={USER_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
                      />
                      <SubmitButton variant="secondary" className="px-2 py-1 text-xs">
                        Save
                      </SubmitButton>
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </>
  );
}
