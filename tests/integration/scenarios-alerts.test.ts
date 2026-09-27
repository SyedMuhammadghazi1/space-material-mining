import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { alerts, materialCostBases, missionScenarios, rigs, targets } from "@/db/schema";
import { runRigHealth } from "@/jobs/rig-health";
import { getOutbox } from "@/lib/mailer";
import { MODEL_VERSION } from "@/lib/models";
import { DEFAULT_SCENARIO_FORM } from "@/lib/scenario-input";
import { ValidationError } from "@/server/errors";
import { createRig, issueRigKey } from "@/server/rigs";
import { createScenario, getScenario, useScenarioAsCostBasis } from "@/server/scenarios";
import { importTargetFromSbdb } from "@/server/targets";
import { ingestTelemetry } from "@/server/telemetry";
import { authenticateRigKey } from "@/server/rigs";
import { createActor, expectDbError, seedReference, type Reference } from "./helpers";

let ref: Reference;

beforeEach(async () => {
  ref = await seedReference();
});

describe("mission scenarios", () => {
  it("stores an immutable snapshot stamped with the model version", async () => {
    const engineer = await createActor("engineer");
    const s = await createScenario(engineer, {
      ...DEFAULT_SCENARIO_FORM,
      name: "Tranquillitatis MRE",
      targetId: ref.targets["mare-tranquillitatis"],
      processId: "mre",
    });
    expect(s.modelVersion).toBe(MODEL_VERSION);
    const loaded = await getScenario(engineer, s.id);
    expect(loaded.results.deltaV.outboundFromLeoMs).toBe(5910);
    expect(loaded.results.production.deliveredKg).toBeGreaterThan(0);
    expect(loaded.targetSnapshot).toMatchObject({ name: "Mare Tranquillitatis (high-Ti mare)" });
    await expectDbError(
      db.execute(sql`UPDATE mission_scenarios SET results = '{}'::jsonb WHERE id = ${s.id}`),
      /immutable/,
    );
    await db
      .update(missionScenarios)
      .set({ name: "Renamed is fine" })
      .where(eq(missionScenarios.id, s.id));
  });

  it("computes NEA scenarios with the patched-conic estimate", async () => {
    const engineer = await createActor("engineer");
    const s = await createScenario(engineer, {
      ...DEFAULT_SCENARIO_FORM,
      name: "Ryugu water",
      targetId: ref.targets.ryugu,
      processId: "volatiles",
    });
    const loaded = await getScenario(engineer, s.id);
    expect(loaded.results.deltaV.nea?.chosen.totalFromLeoMs).toBeGreaterThan(3000);
    expect(loaded.results.production.yields[0]!.itemCode).toBe("H2O");
  });

  it("publishes a scenario's cost per kg as the pricing basis", async () => {
    const engineer = await createActor("engineer");
    const s = await createScenario(engineer, {
      ...DEFAULT_SCENARIO_FORM,
      deliveryNode: "LUNAR_SURFACE",
      name: "Surface MRE",
      targetId: ref.targets["mare-tranquillitatis"],
      processId: "mre",
    });
    const res = await useScenarioAsCostBasis(engineer, s.id);
    expect(res.items.sort()).toEqual(["FE", "O2", "SI", "TI"]);
    const [basis] = await db
      .select()
      .from(materialCostBases)
      .where(eq(materialCostBases.sourceScenarioId, s.id));
    expect(basis!.costPerKgCents).toBe(res.costPerKgCents);
    const empty = await createScenario(engineer, {
      ...DEFAULT_SCENARIO_FORM,
      name: "Nothing",
      targetId: ref.targets["mare-tranquillitatis"],
      processId: "volatiles",
    });
    await expect(useScenarioAsCostBasis(engineer, empty.id)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("JPL SBDB import", () => {
  it("upserts a target from a mocked SBDB response", async () => {
    const engineer = await createActor("engineer");
    const payload = {
      object: {
        fullname: "162173 Ryugu (1999 JU3)",
        des: "162173",
        neo: true,
        orbit_class: { name: "Apollo" },
      },
      orbit: {
        epoch: "2460000.5",
        elements: [
          { name: "a", value: "1.1908" },
          { name: "e", value: ".1902" },
          { name: "i", value: "5.866" },
        ],
      },
      phys_par: [
        { name: "H", value: "19.6" },
        { name: "spec_B", value: "Cg" },
      ],
    };
    const fetchMock = (async () =>
      new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch;
    const t = await importTargetFromSbdb(engineer, { designation: "162173" }, fetchMock);
    expect(t.dataSource).toBe("jpl_sbdb");
    expect(t.aAu).toBeCloseTo(1.1908, 4);
    expect(t.id).toBe(ref.targets.ryugu);
    const all = await db.select().from(targets).where(eq(targets.designation, "162173"));
    expect(all).toHaveLength(1);
  });

  it("requires a composition model when SBDB has no spectral class", async () => {
    const engineer = await createActor("engineer");
    const payload = {
      object: { fullname: "(2020 XX1)", des: "2020 XX1" },
      orbit: {
        elements: [
          { name: "a", value: "1.05" },
          { name: "e", value: ".1" },
          { name: "i", value: "2" },
        ],
      },
    };
    const fetchMock = (async () =>
      new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch;
    await expect(
      importTargetFromSbdb(engineer, { designation: "2020 XX1" }, fetchMock),
    ).rejects.toBeInstanceOf(ValidationError);
    const t = await importTargetFromSbdb(
      engineer,
      { designation: "2020 XX1", sourceType: "nea_s" },
      fetchMock,
    );
    expect(t.sourceType).toBe("nea_s");
  });
});

describe("rig-health job", () => {
  it("opens one silent alert, emails once, and resolves when telemetry resumes", async () => {
    const operator = await createActor("operator");
    const rig = await createRig(operator, {
      missionId: ref.missionId,
      name: "MRE-9",
      processId: "mre",
      ratedPowerKw: 100,
    });
    const key = await issueRigKey(operator, rig.id);
    await db
      .update(rigs)
      .set({ createdAt: new Date(Date.now() - 3_600_000) })
      .where(eq(rigs.id, rig.id));

    const first = await runRigHealth({ silentMinutes: 15 });
    expect(first.silentOpened).toBe(1);
    expect(first.emailed).toBe(1);
    const second = await runRigHealth({ silentMinutes: 15 });
    expect(second).toMatchObject({ silentOpened: 0, emailed: 0 });
    expect(await db.select().from(alerts)).toHaveLength(1);
    const alertMails = getOutbox().filter((m) => m.subject.startsWith("[Rig alert]"));
    expect(alertMails).toHaveLength(1);
    expect(alertMails[0]!.to).toContain(operator.email);

    const authed = (await authenticateRigKey(key.plaintext))!;
    await ingestTelemetry(authed, {
      readings: [
        {
          seq: 1,
          timestamp: new Date().toISOString(),
          regolithProcessedKg: 10,
          powerKw: 90,
          temperatureC: 1600,
          outputKg: { O2: 2 },
        },
      ],
    });
    const third = await runRigHealth({ silentMinutes: 15 });
    expect(third.resolved).toBe(1);
    const [a] = await db.select().from(alerts);
    expect(a!.status).toBe("resolved");
  });

  it("opens an out-of-range alert for anomalous readings", async () => {
    const operator = await createActor("operator");
    const rig = await createRig(operator, {
      missionId: ref.missionId,
      name: "MRE-10",
      processId: "mre",
      ratedPowerKw: 100,
    });
    const key = await issueRigKey(operator, rig.id);
    const authed = (await authenticateRigKey(key.plaintext))!;
    await ingestTelemetry(authed, {
      readings: [
        {
          seq: 1,
          timestamp: new Date().toISOString(),
          regolithProcessedKg: 10,
          powerKw: 150,
          temperatureC: 1600,
          outputKg: {},
        },
      ],
    });
    const res = await runRigHealth({ silentMinutes: 15 });
    expect(res.outOfRangeOpened).toBe(1);
    const [a] = await db.select().from(alerts);
    expect(a!.kind).toBe("out_of_range");
    expect(a!.message).toMatch(/exceeds 110%/);
    expect((await runRigHealth({ silentMinutes: 15 })).outOfRangeOpened).toBe(0);
  });
});
