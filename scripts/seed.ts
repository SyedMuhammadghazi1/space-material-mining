/**
 * Seeds reference data and a realistic demo dataset.
 *
 *   npm run db:seed            # seeds an empty database (no-op if already seeded)
 *   npm run db:seed -- --reset # TRUNCATES every table first (refused when NODE_ENV=production)
 *
 * Demo accounts use a shared password printed at the end. Never run against production data.
 */
import { eq, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  bomLines,
  depots,
  items,
  materialCostBases,
  missions,
  orders,
  products,
  rigs,
  targets,
  user,
} from "@/db/schema";
import { runRigHealth } from "@/jobs/rig-health";
import { auth } from "@/lib/auth";
import { DEFAULT_SCENARIO_FORM } from "@/lib/scenario-input";
import { DEPOTS, MATERIAL_ITEMS, PRODUCT_ITEMS, TARGETS } from "@/lib/reference-data";
import type { Actor } from "@/server/authz";
import {
  completeFabricationJob,
  createFabricationJob,
  startFabricationJob,
} from "@/server/fabrication";
import { recordAdjustment, transferStock } from "@/server/inventory";
import { acceptQuote, issueQuote, requestQuote } from "@/server/quotes";
import { createRig, issueRigKey, authenticateRigKey } from "@/server/rigs";
import { createScenario, publishScenarioCostBasis } from "@/server/scenarios";
import { processStripeEvent } from "@/server/stripe-webhook";
import { ingestTelemetry } from "@/server/telemetry";
import type { Stripe } from "@/server/billing";

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "orbital-demo-2026";
const DEMO_USERS = [
  { email: "admin@orbital-quarry.test", name: "Ada Admin", role: "admin" as const },
  { email: "engineer@orbital-quarry.test", name: "Emeka Engineer", role: "engineer" as const },
  { email: "operator@orbital-quarry.test", name: "Olga Operator", role: "operator" as const },
  {
    email: "buyer@helios-arrays.test",
    name: "Priya Buyer",
    role: "customer" as const,
    company: "Helios Arrays (fictional)",
  },
  {
    email: "buyer@lagrange-habitats.test",
    name: "Tomás Buyer",
    role: "customer" as const,
    company: "Lagrange Habitats (fictional)",
  },
];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

async function reset() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Refusing to --reset when NODE_ENV=production");
  const res = await db.execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  const names = res.rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  if (names) await db.execute(sql.raw(`TRUNCATE ${names} RESTART IDENTITY CASCADE`));
  console.log("• truncated all tables");
}

async function ensureUser(u: (typeof DEMO_USERS)[number] & { company?: string }): Promise<Actor> {
  const [existing] = await db.select().from(user).where(eq(user.email, u.email));
  let id = existing?.id;
  if (!id) {
    const res = await auth.api.signUpEmail({
      body: { email: u.email, password: DEMO_PASSWORD, name: u.name, company: u.company },
    });
    id = res.user.id;
  }
  await db.update(user).set({ role: u.role, emailVerified: true }).where(eq(user.id, id));
  return { id, email: u.email, name: u.name, role: u.role };
}

async function seedReference() {
  const depotRows = await db.insert(depots).values(DEPOTS).onConflictDoNothing().returning();
  const allDepots = depotRows.length
    ? await db.select().from(depots)
    : await db.select().from(depots);
  const depotId = Object.fromEntries(allDepots.map((d) => [d.code, d.id]));
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
    )
    .onConflictDoNothing();
  for (const p of PRODUCT_ITEMS) {
    await db
      .insert(products)
      .values({
        itemCode: p.code,
        energyKWhPerUnit: p.energyKWhPerUnit,
        opsCostPerUnitCents: p.opsCostPerUnitCents,
        leadTimeDays: p.leadTimeDays,
        defaultDepotId: depotId[p.depotCode],
      })
      .onConflictDoNothing();
    await db
      .insert(bomLines)
      .values(
        p.bom.map((b) => ({ productCode: p.code, inputCode: b.itemCode, qtyPerUnit: b.kgPerUnit })),
      )
      .onConflictDoNothing();
  }
  await db
    .insert(targets)
    .values(
      TARGETS.map((t) => ({
        ...t,
        dataSource: "seed_approximate" as const,
        sourceNote:
          t.kind === "nea"
            ? "Approximate — refresh from JPL SBDB"
            : "Nominal site composition model — replace with survey data",
      })),
    )
    .onConflictDoNothing();
  const targetRows = await db.select().from(targets);
  const targetId = Object.fromEntries(targetRows.map((t) => [t.slug, t.id]));
  console.log(
    `• reference data: ${allDepots.length} depots, ${MATERIAL_ITEMS.length + PRODUCT_ITEMS.length} items, ${targetRows.length} targets`,
  );
  return { depotId, targetId };
}

/** Realistic telemetry: diurnal-ish power swing, noise, a maintenance gap and an over-temperature excursion. */
async function seedTelemetry(
  key: string,
  opts: {
    hours: number;
    stopHoursAgo: number;
    powerKw: number;
    tempC: number;
    seed: number;
    excursionAt?: number;
  },
) {
  const rig = await authenticateRigKey(key);
  if (!rig) throw new Error("rig key did not authenticate");
  const rand = rng(opts.seed);
  const now = Date.now();
  const readings = [];
  let seq = 1;
  for (let m = opts.hours * 60; m >= opts.stopHoursAgo * 60; m -= 15) {
    const t = new Date(now - m * 60_000);
    const hour = t.getUTCHours();
    if (hour >= 2 && hour < 3 && m > 24 * 60) continue; // scheduled maintenance window yesterday
    const swing = 0.85 + 0.15 * Math.sin((hour / 24) * 2 * Math.PI);
    const power = +(opts.powerKw * swing * (0.95 + rand() * 0.08)).toFixed(1);
    const processed = +((power / 3.2) * 0.25).toFixed(3); // MRE 3.2 kWh/kg, 15-minute interval
    const excursion = opts.excursionAt !== undefined && seq === opts.excursionAt;
    readings.push({
      seq: seq++,
      timestamp: t.toISOString(),
      regolithProcessedKg: processed,
      powerKw: power,
      temperatureC: excursion ? 1812 : +(opts.tempC + (rand() - 0.5) * 30).toFixed(1),
      outputKg: {
        O2: +(processed * 0.416 * 0.5 * (0.9 + rand() * 0.15)).toFixed(3),
        FE: +(processed * 0.124 * 0.9 * (0.9 + rand() * 0.15)).toFixed(3),
        SI: +(processed * 0.192 * 0.6 * (0.9 + rand() * 0.15)).toFixed(3),
        TI: +(processed * 0.048 * 0.6 * (0.9 + rand() * 0.15)).toFixed(3),
      },
    });
  }
  for (let i = 0; i < readings.length; i += 200) {
    await ingestTelemetry(rig, { readings: readings.slice(i, i + 200) });
  }
  return readings.length;
}

async function main() {
  if (process.argv.includes("--reset")) await reset();
  const [already] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, DEMO_USERS[0]!.email));
  if (already) {
    console.log("Database already seeded (admin user exists). Use --reset to start over.");
    printCredentials();
    return;
  }

  const { depotId, targetId } = await seedReference();
  const [admin, engineer, operator, buyerA, buyerB] = await Promise.all(
    DEMO_USERS.map((u) => ensureUser(u)),
  );
  console.log(`• ${DEMO_USERS.length} demo users`);

  // Planning: reference scenarios → pricing bases ------------------------------------------------
  const base = { ...DEFAULT_SCENARIO_FORM };
  const trq = await createScenario(engineer!, {
    ...base,
    name: "Tranquillitatis MRE pilot — surface delivery",
    targetId: targetId["mare-tranquillitatis"],
    processId: "mre",
    deliveryNode: "LUNAR_SURFACE",
    notes: "Reference plant used as the lunar pricing basis.",
  });
  await publishScenarioCostBasis(engineer!, trq.id);
  const ryugu = await createScenario(engineer!, {
    ...base,
    name: "Ryugu water extraction — EML1 delivery",
    targetId: targetId.ryugu,
    processId: "volatiles",
    deliveryNode: "EML1",
    missionDurationDays: 1095,
    notes: "Launch windows not modelled.",
  });
  await publishScenarioCostBasis(engineer!, ryugu.id);
  await createScenario(engineer!, {
    ...base,
    name: "Shackleton rim MRE — EML1 delivery",
    targetId: targetId["shackleton-rim"],
    processId: "mre",
    deliveryNode: "EML1",
    uptimePercent: 85,
  });
  await createScenario(engineer!, {
    ...base,
    name: "Tranquillitatis ilmenite reduction — LLO",
    targetId: targetId["mare-tranquillitatis"],
    processId: "h2_ilmenite",
    deliveryNode: "LLO",
  });
  await createScenario(engineer!, {
    ...base,
    name: "1989 ML metal separation — EML1",
    targetId: targetId["1989-ml"],
    processId: "magnetic_separation",
    deliveryNode: "EML1",
    powerKw: 50,
  });
  await db
    .insert(materialCostBases)
    .values({ itemCode: "REGOLITH", node: "LUNAR_SURFACE", costPerKgCents: 5_000 })
    .onConflictDoNothing();
  console.log("• 5 mission scenarios; pricing bases from 2 of them (+ manual regolith basis)");

  // Operations: missions, rigs, keys, telemetry ------------------------------------------------------
  const [m1] = await db
    .insert(missions)
    .values({
      name: "Tranquillitatis MRE Pilot",
      targetId: targetId["mare-tranquillitatis"]!,
      scenarioId: trq.id,
      depotId: depotId.TRQ!,
      status: "active",
      createdBy: engineer!.id,
    })
    .returning();
  const [m2] = await db
    .insert(missions)
    .values({
      name: "Shackleton Rim Oxygen Plant",
      targetId: targetId["shackleton-rim"]!,
      depotId: depotId.LSP!,
      status: "active",
      createdBy: engineer!.id,
    })
    .returning();
  const rigA = await createRig(operator!, {
    missionId: m1!.id,
    name: "TRQ-MRE-01",
    processId: "mre",
    ratedPowerKw: 200,
  });
  const rigB = await createRig(operator!, {
    missionId: m2!.id,
    name: "LSP-MRE-02",
    processId: "mre",
    ratedPowerKw: 150,
  });
  const rigC = await createRig(operator!, {
    missionId: m1!.id,
    name: "TRQ-H2R-01",
    processId: "h2_ilmenite",
    ratedPowerKw: 120,
  });
  const keyA = await issueRigKey(operator!, rigA.id, "flight computer A");
  const keyB = await issueRigKey(operator!, rigB.id, "flight computer B");
  const keyC = await issueRigKey(operator!, rigC.id, "bench unit");
  const nA = await seedTelemetry(keyA.plaintext, {
    hours: 48,
    stopHoursAgo: 0,
    powerKw: 185,
    tempC: 1620,
    seed: 7,
    excursionAt: 150,
  });
  const nB = await seedTelemetry(keyB.plaintext, {
    hours: 48,
    stopHoursAgo: 3,
    powerKw: 140,
    tempC: 1600,
    seed: 11,
  });
  // Backfilled readings arrive "now"; make LSP-MRE-02 look like it last reported 3 hours ago.
  await db
    .update(rigs)
    .set({ lastSeenAt: new Date(Date.now() - 3 * 3_600_000) })
    .where(eq(rigs.id, rigB.id));
  console.log(
    `• 2 missions, 3 rigs, ${nA + nB} telemetry readings (LSP-MRE-02 has been silent for 3 h)`,
  );

  // Inventory: stock counts, a transfer ------------------------------------------------------------
  const adjust = (depot: string, itemCode: string, delta: number, reason: string) =>
    recordAdjustment(operator!, { depotId: depotId[depot], itemCode, delta, reason });
  await adjust("EML1-GW", "O2", 6_000, "Opening stock count at commissioning");
  await adjust("EML1-GW", "TI", 800, "Opening stock count at commissioning");
  await adjust("EML1-GW", "SI", 400, "Opening stock count at commissioning");
  await adjust("LSP", "REGOLITH", 25_000, "Excavated and sieved feedstock (survey tally)");
  await adjust("LSP", "FE", 2_500, "Opening stock count at commissioning");
  await adjust("LEO-FAB", "SI", 350, "Opening stock count at commissioning");
  await transferStock(operator!, {
    fromDepotId: depotId.TRQ,
    toDepotId: depotId["EML1-GW"],
    itemCode: "O2",
    quantity: 250,
    transportMission: "Lunar tug LT-1 flight 3",
  });
  console.log("• opening stock + 1 depot transfer");

  // Fabrication -----------------------------------------------------------------------------------
  const beams = await createFabricationJob(operator!, {
    productCode: "FE-BEAM-3M",
    depotId: depotId.LSP,
    quantity: 12,
  });
  await startFabricationJob(operator!, beams.id);
  await completeFabricationJob(operator!, beams.id);
  const tiles = await createFabricationJob(operator!, {
    productCode: "SHIELD-TILE",
    depotId: depotId.LSP,
    quantity: 40,
  });
  await startFabricationJob(operator!, tiles.id);
  await createFabricationJob(operator!, {
    productCode: "LOX-100",
    depotId: depotId["EML1-GW"],
    quantity: 10,
  });
  const truss = await createFabricationJob(operator!, {
    productCode: "TI-TRUSS-2M",
    depotId: depotId["EML1-GW"],
    quantity: 20,
  });
  await startFabricationJob(operator!, truss.id);
  await completeFabricationJob(operator!, truss.id);
  console.log("• 4 fabrication jobs (completed, in progress, queued)");

  // Commercial: quotes and orders ------------------------------------------------------------------
  const q1 = await requestQuote(buyerA!, {
    itemCode: "SI-FEED-25",
    quantity: 16,
    deliveryNode: "LEO",
    notes: "For an in-orbit cell line; need purity certificate.",
  });
  const q2 = await requestQuote(buyerB!, {
    itemCode: "O2",
    quantity: 1_500,
    deliveryNode: "EML1",
    notes: "Propellant top-up for crew transfer vehicle.",
  });
  await issueQuote(engineer!, q2.id, {
    marginPercent: 25,
    reviewerNotes: "Standard terms; delivery from EML1 Gateway stock.",
  });
  const q3 = await requestQuote(buyerB!, {
    itemCode: "TI-TRUSS-2M",
    quantity: 12,
    deliveryNode: "EML1",
  });
  await issueQuote(engineer!, q3.id, { marginPercent: 20 });
  const order1 = await acceptQuote(buyerB!, q3.id);
  let invoiceId = order1.invoiceId;
  if (!invoiceId) {
    // Stripe not configured locally: attach a placeholder invoice id so the webhook path can be demonstrated.
    invoiceId = `in_seed_${order1.id.replace(/-/g, "")}`;
    await db.update(orders).set({ invoiceId }).where(eq(orders.id, order1.id));
  }
  await processStripeEvent({
    id: `evt_seed_${order1.id.replace(/-/g, "")}`,
    object: "event",
    type: "invoice.paid",
    data: { object: { id: invoiceId, object: "invoice", metadata: {} } },
  } as unknown as Stripe.Event);
  const q4 = await requestQuote(buyerA!, { itemCode: "O2", quantity: 800, deliveryNode: "LLO" });
  await issueQuote(engineer!, q4.id, { marginPercent: 25 });
  await acceptQuote(buyerA!, q4.id);
  void q1;
  console.log(
    "• 4 quotes (requested, issued, accepted→confirmed order, accepted→awaiting deposit)",
  );

  const health = await runRigHealth();
  console.log(
    `• rig-health job: ${health.silentOpened} silent + ${health.outOfRangeOpened} out-of-range alerts`,
  );
  void admin;

  console.log("\nSimulator key for TRQ-H2R-01 (shown once — store it if you want to reuse it):");
  console.log(`  RIG_API_KEY=${keyC.plaintext}`);
  printCredentials();
}

function printCredentials() {
  console.log("\nDemo accounts (password for all: " + DEMO_PASSWORD + ")");
  for (const u of DEMO_USERS) console.log(`  ${u.role.padEnd(9)} ${u.email}`);
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
