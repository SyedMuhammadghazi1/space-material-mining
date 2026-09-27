/**
 * Extraction-rig simulator. Posts realistic telemetry to a running server.
 *
 *   RIG_API_KEY=oqr_… npm run sim:rig                # use an existing key
 *   npm run sim:rig -- --register                    # create a rig + key in the DB (dev only)
 *
 * Options: --url <base> (default $APP_URL or http://localhost:3002), --interval <seconds> (5),
 *          --count <posts> (unlimited), --batch <readings per post> (1), --anomaly-every <n> (0 = never)
 * The simulator resumes from the server's last accepted sequence number, retries with backoff and
 * re-sends the same batch after failures (the endpoint is idempotent on (rig, seq)).
 */
import { parseArgs } from "node:util";
import {
  type ElementYield,
  ELEMENT_ITEM_CODES,
  type ProcessId,
  type SourceType,
  computeYields,
  getProcess,
} from "@/lib/models";

const { values: args } = parseArgs({
  options: {
    url: { type: "string" },
    interval: { type: "string", default: "5" },
    count: { type: "string" },
    batch: { type: "string", default: "1" },
    "anomaly-every": { type: "string", default: "0" },
    register: { type: "boolean", default: false },
  },
});

const BASE = (args.url ?? process.env.APP_URL ?? "http://localhost:3002").replace(/\/$/, "");
const INTERVAL_S = Math.max(1, Number(args.interval));
const MAX_POSTS = args.count ? Number(args.count) : Infinity;
const BATCH = Math.min(500, Math.max(1, Number(args.batch)));
const ANOMALY_EVERY = Number(args["anomaly-every"]);

const FEEDSTOCK: Record<ProcessId, SourceType> = {
  mre: "lunar_mare_high_ti",
  h2_ilmenite: "lunar_mare_high_ti",
  magnetic_separation: "nea_m",
  volatiles: "nea_c",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function registerRig(): Promise<string> {
  if (process.env.NODE_ENV === "production")
    throw new Error("--register is for development databases only");
  const { db, pool } = await import("@/db");
  const { missions, user } = await import("@/db/schema");
  const { eq, inArray } = await import("drizzle-orm");
  const { createRig, issueRigKey } = await import("@/server/rigs");
  const [op] = await db
    .select()
    .from(user)
    .where(inArray(user.role, ["operator", "admin"]))
    .limit(1);
  const [mission] = await db.select().from(missions).where(eq(missions.status, "active")).limit(1);
  if (!op || !mission)
    throw new Error(
      "Seed the database first (npm run db:seed): need an operator and an active mission.",
    );
  const actor = { id: op.id, email: op.email, name: op.name, role: op.role };
  const rig = await createRig(actor, {
    missionId: mission.id,
    name: `SIM-${Date.now().toString(36).toUpperCase()}`,
    processId: "mre",
    ratedPowerKw: 150,
  });
  const key = await issueRigKey(actor, rig.id, "simulator");
  await pool.end();
  console.log(
    `Registered rig ${rig.name} on mission "${mission.name}". API key (shown once):\n  RIG_API_KEY=${key.plaintext}`,
  );
  return key.plaintext;
}

async function request(path: string, key: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
}

function makeReading(
  seq: number,
  at: Date,
  rig: { processId: ProcessId; ratedPowerKw: number; temperatureRangeC: [number, number] },
  anomaly: boolean,
) {
  const process = getProcess(rig.processId);
  const hour = at.getUTCHours() + at.getUTCMinutes() / 60;
  const swing = 0.85 + 0.12 * Math.sin((hour / 24) * 2 * Math.PI);
  const powerKw = +(rig.ratedPowerKw * swing * (0.95 + Math.random() * 0.06)).toFixed(2);
  const hours = INTERVAL_S / BATCH / 3600;
  const processed = (powerKw / process.specificEnergyKWhPerKg) * hours;
  const yields: ElementYield[] = computeYields(rig.processId, FEEDSTOCK[rig.processId], processed);
  const outputKg: Record<string, number> = {};
  for (const y of yields) {
    if (y.kg > 0)
      outputKg[ELEMENT_ITEM_CODES[y.element]] = +(y.kg * (0.93 + Math.random() * 0.1)).toFixed(3);
  }
  // Keep mass conservation even after the random factor.
  const total = Object.values(outputKg).reduce((s, v) => s + v, 0);
  if (total > processed)
    for (const k of Object.keys(outputKg))
      outputKg[k] = +((outputKg[k]! * processed) / total).toFixed(3);
  const [tMin, tMax] = rig.temperatureRangeC;
  const mid = (tMin + tMax) / 2;
  return {
    seq,
    timestamp: at.toISOString(),
    regolithProcessedKg: +processed.toFixed(3),
    powerKw,
    temperatureC: anomaly
      ? tMax + 60
      : +(mid + (Math.random() - 0.5) * (tMax - tMin) * 0.3).toFixed(1),
    outputKg,
  };
}

async function main() {
  let key = process.env.RIG_API_KEY;
  if (args.register) key = await registerRig();
  if (!key) {
    console.error(
      "Set RIG_API_KEY (issue one on /ops/rigs/<id>) or pass --register against a seeded dev database.",
    );
    process.exit(2);
  }

  const infoRes = await request("/api/v1/rig", key);
  if (!infoRes.ok) {
    console.error(`Rig lookup failed: HTTP ${infoRes.status} ${await infoRes.text()}`);
    process.exit(1);
  }
  const rig = (await infoRes.json()) as {
    name: string;
    processId: ProcessId;
    ratedPowerKw: number;
    temperatureRangeC: [number, number];
    lastSeq: number | null;
  };
  let seq = (rig.lastSeq ?? 0) + 1;
  console.log(
    `Simulating ${rig.name} (${rig.processId}, ${rig.ratedPowerKw} kW) → ${BASE}, starting at seq ${seq}`,
  );

  let stop = false;
  process.on("SIGINT", () => (stop = true));
  for (let post = 1; post <= MAX_POSTS && !stop; post++) {
    const now = Date.now();
    const readings = Array.from({ length: BATCH }, (_, i) => {
      const s = seq + i;
      const at = new Date(now - (BATCH - 1 - i) * (INTERVAL_S / BATCH) * 1000);
      return makeReading(s, at, rig, ANOMALY_EVERY > 0 && s % ANOMALY_EVERY === 0);
    });
    let attempt = 0;
    for (;;) {
      try {
        const res = await request("/api/v1/telemetry", key, {
          method: "POST",
          body: JSON.stringify({ readings }),
        });
        if (res.status === 429) {
          const wait = Number(res.headers.get("retry-after") ?? 5);
          console.warn(`rate limited; retrying in ${wait}s`);
          await sleep(wait * 1000);
          continue;
        }
        const body = await res.json();
        if (!res.ok) {
          console.error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
          if (res.status === 401 || res.status === 422) process.exit(1);
          throw new Error(`HTTP ${res.status}`);
        }
        console.log(
          `seq ${seq}–${seq + BATCH - 1}: accepted ${body.accepted}, duplicates ${body.duplicates}, credited ${JSON.stringify(body.credited)}`,
        );
        break;
      } catch (err) {
        attempt += 1;
        const wait = Math.min(60, 2 ** attempt);
        console.warn(`post failed (${(err as Error).message}); retrying in ${wait}s`);
        await sleep(wait * 1000);
      }
    }
    seq += BATCH;
    if (post < MAX_POSTS && !stop) await sleep(INTERVAL_S * 1000);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
