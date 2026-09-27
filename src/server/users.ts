import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { USER_ROLES, auditLog, user } from "@/db/schema";
import { audit } from "./audit";
import { ADMIN_ONLY, type Actor, assertRole } from "./authz";
import { ConflictError, NotFoundError } from "./errors";

export async function listUsers(actor: Actor) {
  assertRole(actor, ADMIN_ONLY);
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      company: user.company,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(asc(user.role), asc(user.email));
}

export const roleChangeSchema = z.object({ userId: z.string().min(1), role: z.enum(USER_ROLES) });

export async function setUserRole(actor: Actor, raw: unknown) {
  assertRole(actor, ADMIN_ONLY);
  const input = roleChangeSchema.parse(raw);
  if (input.userId === actor.id)
    throw new ConflictError("You cannot change your own role", "self_role_change");
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, input.userId))
      .for("update");
    if (!before) throw new NotFoundError("User not found");
    const [updated] = await tx
      .update(user)
      .set({ role: input.role })
      .where(eq(user.id, input.userId))
      .returning({ id: user.id, role: user.role });
    await audit(tx, actor, {
      action: "user.role_change",
      entityType: "user",
      entityId: input.userId,
      metadata: { from: before.role, to: input.role },
    });
    return updated!;
  });
}

export async function listAuditLog(actor: Actor, limit = 200) {
  assertRole(actor, ADMIN_ONLY);
  return db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit);
}
