import "server-only";
import { unstable_rethrow } from "next/navigation";
import { toAppError, ValidationError } from "./errors";

export interface ActionState<T = unknown> {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
  data?: T;
}

export const idle: ActionState = { status: "idle" };

/** Converts FormData into a plain object; repeated keys become arrays. */
export function formToObject(form: FormData, arrayKeys: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(form.keys())) {
    if (key.startsWith("$ACTION")) continue;
    const values = form.getAll(key).filter((v): v is string => typeof v === "string");
    out[key] = arrayKeys.includes(key) ? values : values[0];
  }
  for (const key of arrayKeys) out[key] ??= [];
  return out;
}

/** Runs a server action body and maps any error to a safe ActionState. */
export async function runAction<T>(
  fn: () => Promise<{ message?: string; data?: T } | void>,
): Promise<ActionState<T>> {
  try {
    const res = await fn();
    return { status: "success", message: res?.message, data: res?.data };
  } catch (err) {
    unstable_rethrow(err); // let redirect()/notFound() propagate
    const appErr = toAppError(err);
    return {
      status: "error",
      message: appErr.message,
      fieldErrors: appErr instanceof ValidationError ? appErr.fieldErrors : undefined,
    };
  }
}
