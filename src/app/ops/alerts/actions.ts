"use server";

import { revalidatePath } from "next/cache";
import { runRigHealth } from "@/jobs/rig-health";
import { type ActionState, runAction } from "@/server/actions";
import { resolveAlert } from "@/server/alerts";
import { OPERATIONS } from "@/server/authz";
import { requireRole } from "@/server/session";

export async function runHealthCheckAction(_prev: ActionState): Promise<ActionState> {
  await requireRole(OPERATIONS);
  return runAction(async () => {
    const r = await runRigHealth();
    revalidatePath("/ops/alerts");
    return {
      message: `Health check done: ${r.silentOpened} silent, ${r.outOfRangeOpened} out-of-range opened; ${r.resolved} resolved; ${r.emailed} emailed.`,
    };
  });
}

export async function resolveAlertAction(
  alertId: string,
  _prev: ActionState,
): Promise<ActionState> {
  const actor = await requireRole(OPERATIONS);
  return runAction(async () => {
    await resolveAlert(actor, alertId);
    revalidatePath("/ops/alerts");
    return { message: "Alert resolved." };
  });
}
