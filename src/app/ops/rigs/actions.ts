"use server";

import { revalidatePath } from "next/cache";
import { type ActionState, formToObject, runAction } from "@/server/actions";
import { OPERATIONS } from "@/server/authz";
import { createRig, issueRigKey, retireRig, revokeRigKey } from "@/server/rigs";
import { requireRole } from "@/server/session";

export async function createRigAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const actor = await requireRole(OPERATIONS);
  return runAction(async () => {
    const rig = await createRig(actor, formToObject(form));
    revalidatePath("/ops/rigs");
    return { message: `Rig ${rig.name} registered. Open it to issue an API key.` };
  });
}

export async function issueKeyAction(
  rigId: string,
  _prev: ActionState<{ plaintext: string }>,
  form: FormData,
): Promise<ActionState<{ plaintext: string }>> {
  const actor = await requireRole(OPERATIONS);
  return runAction(async () => {
    const label = String(form.get("label") ?? "").trim() || undefined;
    const key = await issueRigKey(actor, rigId, label);
    revalidatePath(`/ops/rigs/${rigId}`);
    return {
      message: "Key issued. Copy it now — it will never be shown again.",
      data: { plaintext: key.plaintext },
    };
  });
}

export async function revokeKeyAction(
  rigId: string,
  keyId: string,
  _prev: ActionState,
): Promise<ActionState> {
  const actor = await requireRole(OPERATIONS);
  return runAction(async () => {
    await revokeRigKey(actor, keyId);
    revalidatePath(`/ops/rigs/${rigId}`);
    return { message: "Key revoked." };
  });
}

export async function retireRigAction(rigId: string, _prev: ActionState): Promise<ActionState> {
  const actor = await requireRole(OPERATIONS);
  return runAction(async () => {
    await retireRig(actor, rigId);
    revalidatePath(`/ops/rigs/${rigId}`);
    return { message: "Rig retired and its keys revoked." };
  });
}
