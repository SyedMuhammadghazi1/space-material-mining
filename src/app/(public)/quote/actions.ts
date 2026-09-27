"use server";

import { redirect } from "next/navigation";
import { type ActionState, formToObject, runAction } from "@/server/actions";
import { requestQuote } from "@/server/quotes";
import { requireRole } from "@/server/session";

export async function requestQuoteAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const actor = await requireRole(["customer"], "/quote");
  let quoteId: string | undefined;
  const state = await runAction(async () => {
    const quote = await requestQuote(actor, formToObject(form));
    quoteId = quote.id;
  });
  if (state.status === "success" && quoteId) redirect(`/portal/quotes/${quoteId}?submitted=1`);
  return state;
}
