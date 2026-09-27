import "server-only";
import type { Queryable } from "@/db";
import { auditLog } from "@/db/schema";
import type { Actor } from "./authz";

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/** Records a sensitive action. Pass the open transaction so the audit row commits atomically. */
export async function audit(
  q: Queryable,
  actor: Actor | { system: string },
  entry: AuditEntry,
): Promise<void> {
  const isSystem = "system" in actor;
  await q.insert(auditLog).values({
    actorId: isSystem ? null : actor.id,
    actorLabel: isSystem ? `system:${actor.system}` : actor.email,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    metadata: entry.metadata ?? {},
    ip: entry.ip ?? null,
  });
}
