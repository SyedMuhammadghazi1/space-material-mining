import { toNextJsHandler } from "better-auth/next-js";
import { getEnv } from "@/env";
import { auth } from "@/lib/auth";
import { AUTH_CLIENT_IP_HEADER, clientIp } from "@/lib/client-ip";
import { errorResponse } from "@/server/errors";
import { enforceRateLimit } from "@/server/rate-limit";
import { readBodyCapped } from "@/server/request";

const handlers = toNextJsHandler(auth);

/** Credential endpoints that must be rate limited (per client IP and per account, per endpoint). */
const LIMITED =
  /\/(sign-in|sign-up|request-password-reset|reset-password|forget-password|change-password)(\/|$)/;

/** Credential request bodies are tiny; refuse to buffer anything larger. */
const MAX_CREDENTIAL_BODY_BYTES = 64 * 1024;

/**
 * Passes the request to Better Auth with the client IP resolved by `clientIp` in the one header
 * Better Auth reads it from (it records it on new sessions). A client-supplied value is dropped.
 */
function toBetterAuth(req: Request, ip: string | null, body?: string): Request {
  const headers = new Headers(req.headers);
  headers.delete(AUTH_CLIENT_IP_HEADER);
  if (ip) headers.set(AUTH_CLIENT_IP_HEADER, ip);
  if (body === undefined) return new Request(req, { headers });
  headers.delete("content-length"); // the already-read body is sent again as a string
  return new Request(req.url, { method: req.method, headers, body, signal: req.signal });
}

/** The account a credential request targets: its email (JSON or form body), else the session user. */
async function accountOf(req: Request, body: string): Promise<string | null> {
  let email: unknown;
  if (/^application\/x-www-form-urlencoded/i.test(req.headers.get("content-type") ?? "")) {
    email = new URLSearchParams(body).get("email");
  } else {
    try {
      email = (JSON.parse(body) as { email?: unknown } | null)?.email;
    } catch {
      email = undefined; // Better Auth rejects the malformed body; the IP limit still applied.
    }
  }
  if (typeof email === "string" && email.trim()) {
    return `email:${email.trim().toLowerCase().slice(0, 320)}`;
  }
  // e.g. change-password: the account is the signed-in user.
  const session = await auth.api.getSession({ headers: req.headers }).catch(() => null);
  return session ? `user:${session.user.id}` : null;
}

export async function GET(req: Request): Promise<Response> {
  return handlers.GET(toBetterAuth(req, clientIp(req.headers)));
}

export async function POST(req: Request): Promise<Response> {
  const ip = clientIp(req.headers);
  const match = LIMITED.exec(new URL(req.url).pathname);
  if (!match) return handlers.POST(toBetterAuth(req, ip));
  let body: string;
  try {
    body = await readBodyCapped(req, MAX_CREDENTIAL_BODY_BYTES);
    const limit = getEnv().AUTH_RATE_LIMIT_PER_MINUTE;
    // Per client IP — only when there is a trustworthy one: a shared "unknown" bucket would let a
    // single client lock everyone out.
    if (ip) await enforceRateLimit(`auth:${match[1]}:ip:${ip}`, limit, 60);
    // Per account, from any number of IPs (always applies, also without an IP).
    const account = await accountOf(req, body);
    if (account) await enforceRateLimit(`auth:${match[1]}:${account}`, limit, 60);
  } catch (err) {
    return errorResponse(err);
  }
  return handlers.POST(toBetterAuth(req, ip, body));
}
