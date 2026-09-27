import { redirect } from "next/navigation";
import { isStaff } from "@/server/authz";
import { requireUser } from "@/server/session";

/** Role-based landing after sign-in. */
export default async function DashboardRedirect() {
  const actor = await requireUser("/dashboard");
  redirect(isStaff(actor) ? "/ops" : "/portal");
}
