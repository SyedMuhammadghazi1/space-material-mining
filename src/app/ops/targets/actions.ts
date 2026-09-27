"use server";

import { revalidatePath } from "next/cache";
import { type ActionState, formToObject, runAction } from "@/server/actions";
import { ENGINEERING } from "@/server/authz";
import { requireRole } from "@/server/session";
import { importTargetFromSbdb } from "@/server/targets";

export async function importSbdbAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const actor = await requireRole(ENGINEERING);
  return runAction(async () => {
    const t = await importTargetFromSbdb(actor, formToObject(form));
    revalidatePath("/ops/targets");
    return {
      message: `Imported ${t.name} from JPL SBDB (a = ${t.aAu?.toFixed(4)} AU, e = ${t.e?.toFixed(4)}, i = ${t.iDeg?.toFixed(3)}°).`,
    };
  });
}

export async function refreshTargetAction(
  designation: string,
  _prev: ActionState,
): Promise<ActionState> {
  const actor = await requireRole(ENGINEERING);
  return runAction(async () => {
    const t = await importTargetFromSbdb(actor, { designation });
    revalidatePath("/ops/targets");
    return { message: `Refreshed ${t.name} from JPL SBDB.` };
  });
}
