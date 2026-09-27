import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { POST as telemetryPOST } from "@/app/api/v1/telemetry/route";
import { GET as rigGET } from "@/app/api/v1/rig/route";
import { db } from "@/db";
import { ledgerEntries, rigApiKeys, telemetryReadings } from "@/db/schema";
import { resetEnvCache } from "@/env";
import { findBalanceDrift } from "@/server/inventory";
import { createRig, issueRigKey, revokeRigKey } from "@/server/rigs";
import { balanceOf, createActor, seedReference, type Reference } from "./helpers";

let ref: Reference;
let key: string;
let rigId: string;

const reading = (seq: number, over: Record<string, unknown> = {}) => ({
  seq,
  timestamp: new Date(Date.now() - (100 - seq) * 60_000).toISOString(),
  regolithProcessedKg: 100,
  powerKw: 180,
  temperatureC: 1620,
  outputKg: { O2: 20, FE: 10.5 },
  ...over,
});

function post(body: unknown, token: string | null = key) {
  return telemetryPOST(
    new Request("http://localhost/api/v1/telemetry", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  ref = await seedReference();
  const operator = await createActor("operator");
  const rig = await createRig(operator, {
    missionId: ref.missionId,
    name: "MRE-1",
    processId: "mre",
    ratedPowerKw: 200,
  });
  rigId = rig.id;
  key = (await issueRigKey(operator, rig.id, "test")).plaintext;
});

describe("POST /api/v1/telemetry", () => {
  it("stores only a SHA-256 hash of the key", async () => {
    const rows = await db.select().from(rigApiKeys).where(eq(rigApiKeys.rigId, rigId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(key);
  });

  it("rejects missing, malformed and unknown keys", async () => {
    expect((await post({ readings: [reading(1)] }, null)).status).toBe(401);
    expect((await post({ readings: [reading(1)] }, "oqr_not_a_real_key_1234567890")).status).toBe(
      401,
    );
    const res = await telemetryPOST(
      new Request("http://localhost/api/v1/telemetry", {
        method: "POST",
        headers: { authorization: "Basic abc" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("credits accepted output to the rig's depot ledger", async () => {
    const res = await post({ readings: [reading(1), reading(2), reading(3)] });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ received: 3, accepted: 3, duplicates: 0, lastSeq: 3 });
    expect(body.credited).toEqual({ O2: 60, FE: 31.5 });
    expect(await balanceOf(ref.depots.TRQ!, "O2")).toBe(60);
    expect(await balanceOf(ref.depots.TRQ!, "FE")).toBe(31.5);
    const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.rigId, rigId));
    expect(entries.every((e) => e.entryType === "production")).toBe(true);
    expect(await findBalanceDrift()).toEqual([]);
  });

  it("is idempotent on (rig, seq): replays are never credited twice", async () => {
    await post({ readings: [reading(1), reading(2)] });
    const replay = await post({ readings: [reading(1), reading(2)] });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ accepted: 0, duplicates: 2, credited: {} });
    const overlap = await post({ readings: [reading(2), reading(3)] });
    expect(await overlap.json()).toMatchObject({
      accepted: 1,
      duplicates: 1,
      credited: { O2: 20, FE: 10.5 },
    });
    expect(await balanceOf(ref.depots.TRQ!, "O2")).toBe(60);
    const stored = await db
      .select()
      .from(telemetryReadings)
      .where(eq(telemetryReadings.rigId, rigId));
    expect(stored).toHaveLength(3);
  });

  it("handles concurrent duplicate batches without double-crediting", async () => {
    const batch = { readings: [reading(10), reading(11)] };
    const results = await Promise.all(Array.from({ length: 5 }, () => post(batch)));
    const bodies = await Promise.all(results.map((r) => r.json()));
    expect(bodies.reduce((s, b) => s + b.accepted, 0)).toBe(2);
    expect(await balanceOf(ref.depots.TRQ!, "O2")).toBe(40);
  });

  it("validates payloads with Zod (422)", async () => {
    const bad = await post({ readings: [reading(1, { regolithProcessedKg: -5 })] });
    expect(bad.status).toBe(422);
    expect((await bad.json()).error.code).toBe("validation_error");
    expect((await post({ readings: [] })).status).toBe(422);
    expect((await post({ readings: [reading(1, { outputKg: { O2: 500 } })] })).status).toBe(422);
    const notJson = await telemetryPOST(
      new Request("http://localhost/api/v1/telemetry", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: "{nope",
      }),
    );
    expect(notJson.status).toBe(422);
  });

  it("rejects oversized bodies without buffering them (413)", async () => {
    const big = JSON.stringify({ readings: [reading(1)], pad: "x".repeat(600 * 1024) });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(big));
        controller.close();
      },
    });
    const res = await telemetryPOST(
      new Request("http://localhost/api/v1/telemetry", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: stream,
        duplex: "half",
      } as RequestInit),
    );
    expect(res.status).toBe(413);
  });

  it("flags out-of-range readings but still accepts them", async () => {
    const res = await post({ readings: [reading(1, { temperatureC: 2100 })] });
    expect(await res.json()).toMatchObject({ accepted: 1, anomalies: 1 });
    const [row] = await db
      .select()
      .from(telemetryReadings)
      .where(eq(telemetryReadings.rigId, rigId));
    expect(row!.anomalies[0]).toMatch(/above/);
  });

  it("rejects revoked keys", async () => {
    const operator = await createActor("operator");
    const [k] = await db.select().from(rigApiKeys).where(eq(rigApiKeys.rigId, rigId));
    await revokeRigKey(operator, k!.id);
    expect((await post({ readings: [reading(1)] })).status).toBe(401);
  });

  it("rate-limits each rig", async () => {
    process.env.TELEMETRY_RATE_LIMIT_PER_MINUTE = "2";
    resetEnvCache();
    try {
      expect((await post({ readings: [reading(1)] })).status).toBe(201);
      expect((await post({ readings: [reading(2)] })).status).toBe(201);
      const limited = await post({ readings: [reading(3)] });
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBeTruthy();
    } finally {
      delete process.env.TELEMETRY_RATE_LIMIT_PER_MINUTE;
      resetEnvCache();
    }
  });

  it("exposes the rig's last sequence number to the simulator", async () => {
    await post({ readings: [reading(41), reading(42)] });
    const res = await rigGET(
      new Request("http://localhost/api/v1/rig", { headers: { authorization: `Bearer ${key}` } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: rigId, lastSeq: 42, processId: "mre" });
  });
});
