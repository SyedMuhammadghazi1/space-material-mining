import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { UserRole } from "@/db/schema";
import { auth } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { type Actor, isRole } from "./authz";
import { ForbiddenError, UnauthorizedError } from "./errors";

async function actorFromHeaders(h: Headers): Promise<Actor | null> {
  const session = await auth.api.getSession({ headers: h });
  if (!session) return null;
  const role = (session.user as { role?: unknown }).role;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: isRole(role) ? role : "customer",
    ip: clientIp(h),
  };
}

/** Current actor for server components / actions (null when signed out). */
export async function getActor(): Promise<Actor | null> {
  return actorFromHeaders(await headers());
}

/** Pages & server actions: redirect to sign-in when signed out. */
export async function requireUser(nextPath?: string): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect(`/sign-in${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ""}`);
  return actor;
}

/** Pages & server actions: redirect to sign-in or the 403 page unless the role matches. */
export async function requireRole(roles: readonly UserRole[], nextPath?: string): Promise<Actor> {
  const actor = await requireUser(nextPath);
  if (!roles.includes(actor.role)) redirect("/forbidden");
  return actor;
}

/** Route handlers: throw 401/403 (rendered by `errorResponse`). */
export async function requireApiRole(req: Request, roles: readonly UserRole[]): Promise<Actor> {
  const actor = await actorFromHeaders(req.headers);
  if (!actor) throw new UnauthorizedError();
  if (!roles.includes(actor.role)) throw new ForbiddenError();
  return actor;
}

export async function getApiActor(req: Request): Promise<Actor> {
  const actor = await actorFromHeaders(req.headers);
  if (!actor) throw new UnauthorizedError();
  return actor;
}
