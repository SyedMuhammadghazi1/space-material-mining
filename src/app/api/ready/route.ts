import { sql } from "drizzle-orm";
import { db } from "@/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Readiness: the database answers `select 1`. */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json(
      { status: "ready", database: "ok" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    logger.error({ err }, "readiness check failed");
    return Response.json(
      { status: "unavailable", database: "error" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
