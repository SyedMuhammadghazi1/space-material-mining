import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bomLines,
  depots,
  items,
  materialCostBases,
  missions,
  products,
  targets,
  user,
  type UserRole,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { DEPOTS, MATERIAL_ITEMS, PRODUCT_ITEMS, TARGETS } from "@/lib/reference-data";
import type { Actor } from "@/server/authz";

export async function truncateAll() {
  const res = await db.execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  const names = res.rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  if (names) await db.execute(sql.raw(`TRUNCATE ${names} RESTART IDENTITY CASCADE`));
}

export interface Reference {
  depots: Record<string, string>;
  targets: Record<string, string>;
  missionId: string;
}

/** Items, products/BOMs, depots, a few targets, cost bases and one active mission. */
export async function seedReference(): Promise<Reference> {
  const depotRows = await db.insert(depots).values(DEPOTS).returning();
  const depotIds = Object.fromEntries(depotRows.map((d) => [d.code, d.id]));
  await db
    .insert(items)
    .values(
      [...MATERIAL_ITEMS, ...PRODUCT_ITEMS].map(
        ({ code, name, kind, unit, unitMassKg, description, isPublic }) => ({
          code,
          name,
          kind,
          unit,
          unitMassKg,
          description,
          isPublic,
        }),
      ),
    );
  for (const p of PRODUCT_ITEMS) {
    await db
      .insert(products)
      .values({
        itemCode: p.code,
        energyKWhPerUnit: p.energyKWhPerUnit,
        opsCostPerUnitCents: p.opsCostPerUnitCents,
        leadTimeDays: p.leadTimeDays,
        defaultDepotId: depotIds[p.depotCode],
      });
    await db
      .insert(bomLines)
      .values(
        p.bom.map((b) => ({ productCode: p.code, inputCode: b.itemCode, qtyPerUnit: b.kgPerUnit })),
      );
  }
  const targetRows = await db
    .insert(targets)
    .values(
      TARGETS.filter((t) => ["mare-tranquillitatis", "ryugu", "itokawa"].includes(t.slug)).map(
        (t) => ({ ...t, dataSource: "seed_approximate" as const }),
      ),
    )
    .returning();
  const targetIds = Object.fromEntries(targetRows.map((t) => [t.slug, t.id]));
  await db.insert(materialCostBases).values([
    { itemCode: "O2", node: "LUNAR_SURFACE", costPerKgCents: 35_000 },
    { itemCode: "FE", node: "LUNAR_SURFACE", costPerKgCents: 35_000 },
    { itemCode: "SI", node: "LUNAR_SURFACE", costPerKgCents: 35_000 },
    { itemCode: "TI", node: "LUNAR_SURFACE", costPerKgCents: 35_000 },
    { itemCode: "REGOLITH", node: "LUNAR_SURFACE", costPerKgCents: 5_000 },
    { itemCode: "H2O", node: "EML1", costPerKgCents: 120_000 },
  ]);
  const [mission] = await db
    .insert(missions)
    .values({
      name: "Test mission",
      targetId: targetIds["mare-tranquillitatis"]!,
      depotId: depotIds["TRQ"]!,
      status: "active",
    })
    .returning();
  return { depots: depotIds, targets: targetIds, missionId: mission!.id };
}

let counter = 0;

/** Inserts a user row directly (no password) and returns it as an Actor. */
export async function createActor(role: UserRole, email?: string): Promise<Actor> {
  counter += 1;
  const id = randomUUID();
  const mail = email ?? `${role}-${counter}-${id.slice(0, 6)}@example.test`;
  await db.insert(user).values({ id, name: `${role} ${counter}`, email: mail, role });
  return { id, email: mail, name: `${role} ${counter}`, role };
}

/** Real Better Auth sign-up, returning a Cookie header for route-handler tests. */
export async function signUpWithSession(role: UserRole): Promise<{ actor: Actor; cookie: string }> {
  counter += 1;
  const email = `session-${role}-${counter}-${randomUUID().slice(0, 6)}@example.test`;
  const { headers, response } = await auth.api.signUpEmail({
    body: { email, password: "correct-horse-battery", name: `Session ${role}` },
    returnHeaders: true,
  });
  if (role !== "customer") await db.update(user).set({ role }).where(eq(user.id, response.user.id));
  const setCookie = headers.get("set-cookie") ?? "";
  const cookie = setCookie
    .split(/,(?=\s*[\w.-]+=)/)
    .map((c) => c.split(";")[0]!.trim())
    .filter(Boolean)
    .join("; ");
  return { actor: { id: response.user.id, email, name: `Session ${role}`, role }, cookie };
}

export async function balanceOf(depotId: string, itemCode: string): Promise<number> {
  const res = await db.execute<{ q: string | null }>(
    sql`SELECT SUM(quantity) AS q FROM ledger_entries WHERE depot_id = ${depotId} AND item_code = ${itemCode}`,
  );
  return Number(res.rows[0]?.q ?? 0);
}

/** Drizzle wraps driver errors ("Failed query: …"); match against the underlying Postgres message. */
export async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e as Error & { cause?: Error },
  );
  if (!err) throw new Error("expected the query to fail");
  const message = `${err.message} ${err.cause?.message ?? ""}`;
  if (!pattern.test(message)) throw new Error(`expected ${pattern} but got: ${message}`);
}
