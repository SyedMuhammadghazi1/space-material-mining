import { USER_ROLES, type UserRole } from "@/db/schema";
import { ForbiddenError, UnauthorizedError } from "./errors";

export interface Actor {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  /** Client IP of the request that resolved this actor (see `clientIp`), recorded in the audit log. */
  ip?: string | null;
}

export const STAFF_ROLES: readonly UserRole[] = ["engineer", "operator", "admin"];
export const ENGINEERING: readonly UserRole[] = ["engineer", "admin"];
export const OPERATIONS: readonly UserRole[] = ["operator", "admin"];
export const ADMIN_ONLY: readonly UserRole[] = ["admin"];

export function isRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

export function hasRole(actor: Actor | null | undefined, roles: readonly UserRole[]): boolean {
  return !!actor && roles.includes(actor.role);
}

export function isStaff(actor: Actor | null | undefined): boolean {
  return hasRole(actor, STAFF_ROLES);
}

/** Throws unless the actor holds one of `roles`. Every service entry point calls this. */
export function assertRole(
  actor: Actor | null | undefined,
  roles: readonly UserRole[],
): asserts actor is Actor {
  if (!actor) throw new UnauthorizedError();
  if (!roles.includes(actor.role)) throw new ForbiddenError();
}

export const ROLE_LABELS: Record<UserRole, string> = {
  customer: "Customer",
  engineer: "Mission engineer",
  operator: "Operations",
  admin: "Administrator",
};
