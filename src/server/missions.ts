import "server-only";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { depots, missionScenarios, missions, targets } from "@/db/schema";
import { audit } from "./audit";
import { type Actor, ENGINEERING, STAFF_ROLES, assertRole } from "./authz";
import { NotFoundError } from "./errors";

export const missionSchema = z.object({
  name: z.string().trim().min(3).max(120),
  targetId: z.uuid(),
  depotId: z.uuid(),
  scenarioId: z
    .uuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export async function createMission(actor: Actor, raw: unknown) {
  assertRole(actor, ENGINEERING);
  const input = missionSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: targets.id })
      .from(targets)
      .where(eq(targets.id, input.targetId));
    if (!target) throw new NotFoundError("Target not found");
    const [depot] = await tx
      .select({ id: depots.id })
      .from(depots)
      .where(eq(depots.id, input.depotId));
    if (!depot) throw new NotFoundError("Depot not found");
    if (input.scenarioId) {
      const [s] = await tx
        .select({ id: missionScenarios.id })
        .from(missionScenarios)
        .where(eq(missionScenarios.id, input.scenarioId));
      if (!s) throw new NotFoundError("Scenario not found");
    }
    const [mission] = await tx
      .insert(missions)
      .values({ ...input, status: "active", createdBy: actor.id })
      .returning();
    await audit(tx, actor, {
      action: "mission.create",
      entityType: "mission",
      entityId: mission!.id,
      metadata: { name: input.name },
    });
    return mission!;
  });
}

export async function listMissions(actor: Actor) {
  assertRole(actor, STAFF_ROLES);
  return db
    .select({
      id: missions.id,
      name: missions.name,
      status: missions.status,
      createdAt: missions.createdAt,
      targetName: targets.name,
      depotName: depots.name,
      depotId: missions.depotId,
      scenarioId: missions.scenarioId,
    })
    .from(missions)
    .innerJoin(targets, eq(targets.id, missions.targetId))
    .innerJoin(depots, eq(depots.id, missions.depotId))
    .orderBy(desc(missions.createdAt));
}
