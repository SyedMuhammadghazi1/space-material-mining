"use server";

import { revalidatePath } from "next/cache";
import { type ActionState, formToObject, runAction } from "@/server/actions";
import { ADMIN_ONLY, OPERATIONS } from "@/server/authz";
import { cancelOrder, fulfilOrder, reserveOrder } from "@/server/orders";
import { requireRole } from "@/server/session";

export async function reserveOrderAction(
  orderId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = await requireRole(OPERATIONS);
  return runAction(async () => {
    await reserveOrder(actor, orderId, formToObject(form));
    revalidatePath("/ops/orders");
    return { message: "Stock reserved." };
  });
}

export async function fulfilOrderAction(orderId: string, _prev: ActionState): Promise<ActionState> {
  const actor = await requireRole(OPERATIONS);
  return runAction(async () => {
    await fulfilOrder(actor, orderId);
    revalidatePath("/ops/orders");
    return { message: "Delivered — delivery ledger entry recorded." };
  });
}

export async function cancelOrderAction(
  orderId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = await requireRole(ADMIN_ONLY);
  return runAction(async () => {
    await cancelOrder(actor, orderId, String(form.get("reason") ?? ""));
    revalidatePath("/ops/orders");
    return { message: "Order cancelled." };
  });
}
