"use server";

import { revalidatePath } from "next/cache";
import { type ActionState, formToObject, runAction } from "@/server/actions";
import { ENGINEERING } from "@/server/authz";
import { createMission } from "@/server/missions";
import { requireRole } from "@/server/session";

export async function createMissionAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = await requireRole(ENGINEERING);
  return runAction(async () => {
    const m = await createMission(actor, formToObject(form));
    revalidatePath("/ops/missions");
    return { message: `Mission “${m.name}” created. Operators can now attach extraction rigs.` };
  });
}
