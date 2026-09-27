import { toNextJsHandler } from "better-auth/next-js";
import { getEnv } from "@/env";
import { auth } from "@/lib/auth";
import { errorResponse } from "@/server/errors";
import { enforceRateLimit } from "@/server/rate-limit";
import { clientIp } from "@/server/request";

const handlers = toNextJsHandler(auth);

/** Credential endpoints that must be rate limited (per client IP, per endpoint). */
const LIMITED =
  /\/(sign-in|sign-up|request-password-reset|reset-password|forget-password|change-password)(\/|$)/;

export const GET = handlers.GET;

export async function POST(req: Request): Promise<Response> {
  const path = new URL(req.url).pathname;
  const match = LIMITED.exec(path);
  if (match) {
    try {
      await enforceRateLimit(
        `auth:${match[1]}:${clientIp(req.headers)}`,
        getEnv().AUTH_RATE_LIMIT_PER_MINUTE,
        60,
      );
    } catch (err) {
      return errorResponse(err);
    }
  }
  return handlers.POST(req);
}
