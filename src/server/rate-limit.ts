import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { RateLimitedError } from "./errors";

export interface RateLimitResult {
  ok: boolean;
  count: number;
  limit: number;
  retryAfterSeconds: number;
}

/**
 * Postgres-backed fixed-window rate limiter: one row per (key, window). Works across any number
 * of app instances because the counter lives in the shared database.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const windowMs = windowSeconds * 1000;
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const result = await db.execute<{ count: number }>(sql`
    INSERT INTO rate_limit_buckets (key, window_start, count)
    VALUES (${key}, ${windowStart.toISOString()}, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit_buckets.count + 1
    RETURNING count
  `);
  const count = Number(result.rows[0]?.count ?? 0);
  if (Math.random() < 0.01) {
    await db.execute(
      sql`DELETE FROM rate_limit_buckets WHERE window_start < now() - interval '1 day'`,
    );
  }
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now) / 1000));
  return { ok: count <= limit, count, limit, retryAfterSeconds };
}

export async function enforceRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const r = await rateLimit(key, limit, windowSeconds);
  if (!r.ok) throw new RateLimitedError(r.retryAfterSeconds);
}
