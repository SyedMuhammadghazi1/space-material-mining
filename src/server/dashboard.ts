import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getEnv } from "@/env";
import { listAlerts } from "./alerts";
import { type Actor, STAFF_ROLES, assertRole } from "./authz";
import { getBalances } from "./inventory";

export interface ProductionPoint {
  hour: string;
  itemCode: string;
  kg: number;
}

export async function getMissionControl(actor: Actor, hours = 48) {
  assertRole(actor, STAFF_ROLES);
  const silentCutoff = new Date(Date.now() - getEnv().RIG_SILENT_MINUTES * 60_000).toISOString();
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const [rigStats, series, totals, balances, openAlerts] = await Promise.all([
    db.execute<{ active: number; reporting: number; retired: number }>(sql`
      SELECT count(*) FILTER (WHERE status = 'active')::int AS active,
             count(*) FILTER (WHERE status = 'active' AND last_seen_at >= ${silentCutoff})::int AS reporting,
             count(*) FILTER (WHERE status = 'retired')::int AS retired
      FROM rigs`),
    db.execute<{ hour: Date; item_code: string; kg: string }>(sql`
      SELECT date_trunc('hour', t.recorded_at) AS hour, o.key AS item_code, SUM(o.value::numeric) AS kg
      FROM telemetry_readings t, jsonb_each_text(t.output) o
      WHERE t.recorded_at >= ${since}
      GROUP BY 1, 2 ORDER BY 1`),
    db.execute<{ item_code: string; kg: string; regolith: string }>(sql`
      SELECT o.key AS item_code, SUM(o.value::numeric) AS kg, 0 AS regolith
      FROM telemetry_readings t, jsonb_each_text(t.output) o
      WHERE t.recorded_at >= now() - interval '24 hours'
      GROUP BY 1 ORDER BY 2 DESC`),
    getBalances(actor),
    listAlerts(actor, { openOnly: true, limit: 20 }),
  ]);
  return {
    rigs: rigStats.rows[0] ?? { active: 0, reporting: 0, retired: 0 },
    series: series.rows.map((r) => ({
      hour: new Date(r.hour).toISOString(),
      itemCode: r.item_code,
      kg: Number(r.kg),
    })) as ProductionPoint[],
    last24h: totals.rows.map((r) => ({ itemCode: r.item_code, kg: Number(r.kg) })),
    balances,
    openAlerts,
    hours,
  };
}
