import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { alerts, rigs } from "@/db/schema";
import { audit } from "./audit";
import { type Actor, OPERATIONS, STAFF_ROLES, assertRole } from "./authz";
import { NotFoundError, ensureUuid } from "./errors";

export async function listAlerts(actor: Actor, opts: { openOnly?: boolean; limit?: number } = {}) {
  assertRole(actor, STAFF_ROLES);
  const q = db
    .select({ alert: alerts, rigName: rigs.name })
    .from(alerts)
    .innerJoin(rigs, eq(rigs.id, alerts.rigId));
  return (opts.openOnly ? q.where(eq(alerts.status, "open")) : q)
    .orderBy(desc(alerts.createdAt))
    .limit(opts.limit ?? 100);
}

export async function resolveAlert(actor: Actor, alertId: string) {
  assertRole(actor, OPERATIONS);
  ensureUuid(alertId, "Alert");
  const [row] = await db
    .update(alerts)
    .set({ status: "resolved", resolvedAt: new Date() })
    .where(eq(alerts.id, alertId))
    .returning();
  if (!row) throw new NotFoundError("Alert not found");
  await audit(db, actor, { action: "alert.resolve", entityType: "alert", entityId: alertId });
  return row;
}
