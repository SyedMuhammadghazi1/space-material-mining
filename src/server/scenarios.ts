import "server-only";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { materialCostBases, missionScenarios, targets, user } from "@/db/schema";
import { MODEL_VERSION, type ScenarioResult, evaluateScenario } from "@/lib/models";
import {
  economicsPreviewSchema,
  scenarioCreateSchema,
  toEconomicsParams,
} from "@/lib/scenario-input";
import { audit } from "./audit";
import { type Actor, ENGINEERING, STAFF_ROLES, assertRole } from "./authz";
import { NotFoundError, ValidationError } from "./errors";

type TargetRow = typeof targets.$inferSelect;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function targetForModel(t: TargetRow) {
  return { kind: t.kind, sourceType: t.sourceType, aAu: t.aAu, e: t.e, iDeg: t.iDeg };
}

function targetSnapshot(t: TargetRow) {
  return {
    id: t.id,
    name: t.name,
    kind: t.kind,
    sourceType: t.sourceType,
    designation: t.designation,
    spectralClass: t.spectralClass,
    aAu: t.aAu,
    e: t.e,
    iDeg: t.iDeg,
    dataSource: t.dataSource,
    refreshedAt: t.refreshedAt?.toISOString() ?? null,
  };
}

async function loadTarget(id: string): Promise<TargetRow> {
  const [t] = await db.select().from(targets).where(eq(targets.id, id));
  if (!t) throw new NotFoundError("Target not found");
  return t;
}

/** Runs the models without saving (economics explorer). Server-side validation only. */
export async function previewEconomics(actor: Actor, raw: unknown): Promise<ScenarioResult> {
  assertRole(actor, STAFF_ROLES);
  const input = economicsPreviewSchema.parse(raw);
  const target = await loadTarget(input.targetId);
  return evaluateScenario(targetForModel(target), input.processId, toEconomicsParams(input));
}

/** Computes a scenario and stores an immutable snapshot stamped with the model version. */
export async function createScenario(actor: Actor, raw: unknown) {
  assertRole(actor, ENGINEERING);
  const input = scenarioCreateSchema.parse(raw);
  const target = await loadTarget(input.targetId);
  const params = toEconomicsParams(input);
  const results = evaluateScenario(targetForModel(target), input.processId, params);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(missionScenarios)
      .values({
        name: input.name,
        targetId: target.id,
        processId: input.processId,
        deliveryNode: params.deliveryNode,
        inputs: { ...params, form: { ...input, name: undefined, notes: undefined } },
        targetSnapshot: targetSnapshot(target),
        results: results as unknown as Record<string, unknown>,
        modelVersion: results.modelVersion,
        notes: input.notes || null,
        createdBy: actor.id,
      })
      .returning();
    await audit(tx, actor, {
      action: "scenario.create",
      entityType: "mission_scenario",
      entityId: row!.id,
      metadata: { name: input.name, modelVersion: MODEL_VERSION },
    });
    return row!;
  });
}

export async function listScenarios(actor: Actor) {
  assertRole(actor, STAFF_ROLES);
  return db
    .select({
      id: missionScenarios.id,
      name: missionScenarios.name,
      processId: missionScenarios.processId,
      deliveryNode: missionScenarios.deliveryNode,
      modelVersion: missionScenarios.modelVersion,
      createdAt: missionScenarios.createdAt,
      targetName: targets.name,
      results: missionScenarios.results,
      authorName: user.name,
    })
    .from(missionScenarios)
    .innerJoin(targets, eq(targets.id, missionScenarios.targetId))
    .leftJoin(user, eq(user.id, missionScenarios.createdBy))
    .orderBy(desc(missionScenarios.createdAt));
}

export async function getScenarios(actor: Actor, ids: string[]) {
  assertRole(actor, STAFF_ROLES);
  ids = ids.filter((id) => UUID_RE.test(id));
  if (ids.length === 0) return [];
  const rows = await db
    .select({ scenario: missionScenarios, targetName: targets.name })
    .from(missionScenarios)
    .innerJoin(targets, eq(targets.id, missionScenarios.targetId))
    .where(inArray(missionScenarios.id, ids));
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows
    .sort((a, b) => (order.get(a.scenario.id) ?? 0) - (order.get(b.scenario.id) ?? 0))
    .map((r) => ({
      ...r.scenario,
      targetName: r.targetName,
      results: r.scenario.results as unknown as ScenarioResult,
    }));
}

export async function getScenario(actor: Actor, id: string) {
  const [s] = await getScenarios(actor, [id]);
  if (!s) throw new NotFoundError("Scenario not found");
  return s;
}

/**
 * Publishes a scenario's cost per delivered kg as the pricing basis for each material it
 * delivers at its delivery node (mass-based cost allocation across co-products).
 */
export async function publishScenarioCostBasis(actor: Actor, scenarioId: string) {
  assertRole(actor, ENGINEERING);
  const scenario = await getScenario(actor, scenarioId);
  const cost = scenario.results.unitEconomics.costPerDeliveredKgCents;
  const delivered = scenario.results.production.yields.filter((y) => y.delivered && y.kg > 0);
  if (cost === null || delivered.length === 0)
    throw new ValidationError("This scenario delivers no product, so it cannot set a cost basis");
  return db.transaction(async (tx) => {
    for (const y of delivered) {
      await tx
        .insert(materialCostBases)
        .values({
          itemCode: y.itemCode,
          node: scenario.deliveryNode,
          costPerKgCents: cost,
          sourceScenarioId: scenario.id,
        })
        .onConflictDoUpdate({
          target: [materialCostBases.itemCode, materialCostBases.node],
          set: { costPerKgCents: cost, sourceScenarioId: scenario.id, updatedAt: new Date() },
        });
    }
    await audit(tx, actor, {
      action: "cost_basis.set_from_scenario",
      entityType: "mission_scenario",
      entityId: scenario.id,
      metadata: {
        items: delivered.map((d) => d.itemCode),
        node: scenario.deliveryNode,
        costPerKgCents: cost,
      },
    });
    return {
      items: delivered.map((d) => d.itemCode),
      node: scenario.deliveryNode,
      costPerKgCents: cost,
    };
  });
}

export async function listCostBases() {
  return db
    .select({
      itemCode: materialCostBases.itemCode,
      node: materialCostBases.node,
      costPerKgCents: materialCostBases.costPerKgCents,
      sourceScenarioId: materialCostBases.sourceScenarioId,
      updatedAt: materialCostBases.updatedAt,
      scenarioName: missionScenarios.name,
    })
    .from(materialCostBases)
    .leftJoin(missionScenarios, eq(missionScenarios.id, materialCostBases.sourceScenarioId));
}
