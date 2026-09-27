"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, formToObject, runAction } from "@/server/actions";
import { ENGINEERING } from "@/server/authz";
import { createScenario, publishScenarioCostBasis } from "@/server/scenarios";
import { requireRole } from "@/server/session";

export async function createScenarioAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = await requireRole(ENGINEERING);
  let id: string | undefined;
  const state = await runAction(async () => {
    const s = await createScenario(actor, formToObject(form, ["productElements"]));
    id = s.id;
    revalidatePath("/ops/scenarios");
  });
  if (id) redirect(`/ops/scenarios/${id}`);
  return state;
}

export async function useAsCostBasisAction(
  scenarioId: string,
  _prev: ActionState,
): Promise<ActionState> {
  const actor = await requireRole(ENGINEERING);
  return runAction(async () => {
    const res = await publishScenarioCostBasis(actor, scenarioId);
    revalidatePath("/catalog");
    return { message: `Pricing basis updated for ${res.items.join(", ")} at ${res.node}.` };
  });
}
