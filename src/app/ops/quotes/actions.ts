"use server";

import { revalidatePath } from "next/cache";
import { formatMoney } from "@/lib/format";
import { type ActionState, formToObject, runAction } from "@/server/actions";
import { ENGINEERING } from "@/server/authz";
import { issueQuote } from "@/server/quotes";
import { requireRole } from "@/server/session";

export async function issueQuoteAction(
  quoteId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = await requireRole(ENGINEERING);
  return runAction(async () => {
    const q = await issueQuote(actor, quoteId, formToObject(form));
    revalidatePath("/ops/quotes");
    revalidatePath(`/ops/quotes/${quoteId}`);
    return {
      message: `Quote ${q.reference} issued at ${formatMoney(q.totalCents, { exact: true })}; the customer has been emailed.`,
    };
  });
}
