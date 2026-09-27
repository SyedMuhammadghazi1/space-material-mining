"use server";

import { revalidatePath } from "next/cache";
import { type ActionState, formToObject, runAction } from "@/server/actions";
import { OPERATIONS } from "@/server/authz";
import {
  cancelFabricationJob,
  completeFabricationJob,
  createFabricationJob,
  failFabricationJob,
  startFabricationJob,
} from "@/server/fabrication";
import { requireRole } from "@/server/session";

function done(message: string) {
  revalidatePath("/ops/fabrication");
  revalidatePath("/ops/inventory");
  return { message };
}

export async function createJobAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const actor = await requireRole(OPERATIONS);
  return runAction(async () => {
    await createFabricationJob(actor, formToObject(form));
    return done("Job queued.");
  });
}

export async function startJobAction(jobId: string, _prev: ActionState): Promise<ActionState> {
  const actor = await requireRole(OPERATIONS);
  return runAction(async () => {
    await startFabricationJob(actor, jobId);
    return done("Job started — bill-of-materials inputs consumed.");
  });
}

export async function completeJobAction(jobId: string, _prev: ActionState): Promise<ActionState> {
  const actor = await requireRole(OPERATIONS);
  return runAction(async () => {
    await completeFabricationJob(actor, jobId);
    return done("Job completed — finished goods added to inventory.");
  });
}

export async function failJobAction(
  jobId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = await requireRole(OPERATIONS);
  return runAction(async () => {
    await failFabricationJob(actor, jobId, String(form.get("reason") ?? ""));
    return done("Job marked failed.");
  });
}

export async function cancelJobAction(jobId: string, _prev: ActionState): Promise<ActionState> {
  const actor = await requireRole(OPERATIONS);
  return runAction(async () => {
    await cancelFabricationJob(actor, jobId);
    return done("Job cancelled.");
  });
}
