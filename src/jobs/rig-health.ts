import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { alerts, rigs, user } from "@/db/schema";
import { getEnv } from "@/env";
import { logger } from "@/lib/logger";
import { sendMail } from "@/lib/mailer";

export interface RigHealthResult {
  silentOpened: number;
  outOfRangeOpened: number;
  resolved: number;
  emailed: number;
}

/**
 * Rig-health job (idempotent — safe to run as often as you like):
 *  1. opens a `silent` alert for active rigs with no telemetry for > RIG_SILENT_MINUTES;
 *  2. opens an `out_of_range` alert for rigs that reported anomalous readings in that window;
 *  3. resolves alerts whose condition has cleared;
 *  4. emails each newly opened alert exactly once to operators and admins.
 * A partial unique index allows only one open alert per (rig, kind), so concurrent runs cannot
 * create duplicates, and `emailed_at` is claimed atomically before sending.
 */
export async function runRigHealth(
  opts: { now?: Date; silentMinutes?: number } = {},
): Promise<RigHealthResult> {
  const now = opts.now ?? new Date();
  const minutes = opts.silentMinutes ?? getEnv().RIG_SILENT_MINUTES;
  const cutoff = new Date(now.getTime() - minutes * 60_000);

  const silentOpened = await db.execute(sql`
    INSERT INTO alerts (rig_id, kind, message)
    SELECT r.id, 'silent',
           'No telemetry from ' || r.name || ' for more than ' || ${minutes}::int || ' minutes'
             || COALESCE(' (last seen ' || to_char(r.last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC)', ' (never reported)')
    FROM rigs r
    WHERE r.status = 'active'
      AND COALESCE(r.last_seen_at, r.created_at) < ${cutoff.toISOString()}
    ON CONFLICT DO NOTHING
  `);

  const outOfRangeOpened = await db.execute(sql`
    INSERT INTO alerts (rig_id, kind, message)
    SELECT t.rig_id, 'out_of_range',
           r.name || ': ' || count(*) || ' out-of-range reading(s), latest: ' || (array_agg(array_to_string(t.anomalies, '; ') ORDER BY t.seq DESC))[1]
    FROM telemetry_readings t
    JOIN rigs r ON r.id = t.rig_id
    WHERE r.status = 'active' AND t.received_at >= ${cutoff.toISOString()} AND cardinality(t.anomalies) > 0
    GROUP BY t.rig_id, r.name
    ON CONFLICT DO NOTHING
  `);

  const resolvedSilent = await db.execute(sql`
    UPDATE alerts a SET status = 'resolved', resolved_at = ${now.toISOString()}
    FROM rigs r
    WHERE a.rig_id = r.id AND a.kind = 'silent' AND a.status = 'open'
      AND (r.status <> 'active' OR r.last_seen_at >= ${cutoff.toISOString()})
  `);
  const resolvedRange = await db.execute(sql`
    UPDATE alerts a SET status = 'resolved', resolved_at = ${now.toISOString()}
    WHERE a.kind = 'out_of_range' AND a.status = 'open'
      AND a.created_at < ${cutoff.toISOString()}
      AND NOT EXISTS (
        SELECT 1 FROM telemetry_readings t
        WHERE t.rig_id = a.rig_id AND t.received_at >= ${cutoff.toISOString()} AND cardinality(t.anomalies) > 0
      )
  `);

  const emailed = await emailNewAlerts();
  const result = {
    silentOpened: silentOpened.rowCount ?? 0,
    outOfRangeOpened: outOfRangeOpened.rowCount ?? 0,
    resolved: (resolvedSilent.rowCount ?? 0) + (resolvedRange.rowCount ?? 0),
    emailed,
  };
  logger.info(result, "rig-health job finished");
  return result;
}

async function emailNewAlerts(): Promise<number> {
  const claimed = await db
    .update(alerts)
    .set({ emailedAt: new Date() })
    .where(and(eq(alerts.status, "open"), isNull(alerts.emailedAt)))
    .returning({ id: alerts.id, message: alerts.message, kind: alerts.kind, rigId: alerts.rigId });
  if (claimed.length === 0) return 0;

  const staff = await db
    .select({ email: user.email })
    .from(user)
    .where(inArray(user.role, ["operator", "admin"]));
  const extra = (getEnv().OPS_ALERT_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const to = [...new Set([...staff.map((s) => s.email), ...extra])];
  const rigNames = await db
    .select({ id: rigs.id, name: rigs.name })
    .from(rigs)
    .where(
      inArray(
        rigs.id,
        claimed.map((c) => c.rigId),
      ),
    );
  const nameOf = new Map(rigNames.map((r) => [r.id, r.name]));
  try {
    await sendMail({
      to,
      subject: `[Rig alert] ${claimed.length} new alert${claimed.length === 1 ? "" : "s"}`,
      text: [
        "New rig alerts:",
        ...claimed.map((a) => `- [${a.kind}] ${nameOf.get(a.rigId) ?? a.rigId}: ${a.message}`),
        "",
        `Mission control: ${getEnv().APP_URL}/ops/alerts`,
      ].join("\n"),
    });
  } catch (err) {
    // Un-claim so the next run retries the email (at-least-once delivery).
    await db
      .update(alerts)
      .set({ emailedAt: null })
      .where(
        inArray(
          alerts.id,
          claimed.map((c) => c.id),
        ),
      );
    logger.error({ err }, "alert email failed; will retry on next run");
    return 0;
  }
  return claimed.length;
}
