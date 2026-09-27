"use server";

import { revalidatePath } from "next/cache";
import { type ActionState, formToObject, runAction } from "@/server/actions";
import { ADMIN_ONLY } from "@/server/authz";
import { requireRole } from "@/server/session";
import { setUserRole } from "@/server/users";

export async function setRoleAction(
  userId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = await requireRole(ADMIN_ONLY);
  return runAction(async () => {
    const res = await setUserRole(actor, { ...formToObject(form), userId });
    revalidatePath("/admin/users");
    return { message: `Role changed to ${res.role}.` };
  });
}
