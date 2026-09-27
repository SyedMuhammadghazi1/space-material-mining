import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { getEnv } from "@/env";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { __oqPool?: pg.Pool };

function createPool(): pg.Pool {
  const env = getEnv();
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on("error", (err) => {
    console.error(
      JSON.stringify({ level: "error", msg: "idle pg client error", error: err.message }),
    );
  });
  return pool;
}

export const pool: pg.Pool = globalForDb.__oqPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForDb.__oqPool = pool;

export const db = drizzle(pool, { schema });

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything that can run queries: the pooled db or an open transaction. */
export type Queryable = Db | Tx;

export { schema };
