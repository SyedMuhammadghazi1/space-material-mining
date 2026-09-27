"use server";

import { revalidatePath } from "next/cache";
import { formatDeltaV, formatMoney } from "@/lib/format";
import { type ActionState, formToObject, runAction } from "@/server/actions";
import { OPERATIONS } from "@/server/authz";
import { recordAdjustment, transferStock } from "@/server/inventory";
import { requireRole } from "@/server/session";

export async function adjustmentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const actor = await requireRole(OPERATIONS);
  return runAction(async () => {
    const res = await recordAdjustment(actor, formToObject(form));
    revalidatePath("/ops/inventory");
    return { message: `Adjustment recorded. New balance: ${res.balanceAfter}.` };
  });
}

export async function transferAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const actor = await requireRole(OPERATIONS);
  return runAction(async () => {
    const { plan } = await transferStock(actor, formToObject(form));
    revalidatePath("/ops/inventory");
    return {
      message: `Transfer recorded: Δv ${formatDeltaV(plan.deltaVMs)}, ${plan.propellantKg} kg propellant, cost ${formatMoney(plan.costCents)}.`,
    };
  });
}
