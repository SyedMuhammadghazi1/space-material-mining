import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { STAFF_ROLES } from "@/server/authz";
import { requireRole } from "@/server/session";

export default async function OpsLayout({ children }: { children: ReactNode }) {
  // Layout-level check is a convenience; every page and action re-checks its own role.
  const actor = await requireRole(STAFF_ROLES, "/ops");
  return <AppShell actor={actor}>{children}</AppShell>;
}
