import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { ADMIN_ONLY } from "@/server/authz";
import { requireRole } from "@/server/session";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const actor = await requireRole(ADMIN_ONLY, "/admin/users");
  return <AppShell actor={actor}>{children}</AppShell>;
}
