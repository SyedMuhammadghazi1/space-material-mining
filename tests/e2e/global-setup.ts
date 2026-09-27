import { execFileSync } from "node:child_process";
import pg from "pg";
import { E2E_DATABASE_URL } from "../../playwright.config";

/** Fresh schema + seed data for the E2E run. */
export default async function globalSetup() {
  if (!/test/.test(new URL(E2E_DATABASE_URL).pathname))
    throw new Error("E2E_DATABASE_URL must point at a test database");
  const pool = new pg.Pool({ connectionString: E2E_DATABASE_URL, max: 1 });
  await pool.query(
    "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;",
  );
  await pool.end();
  const env = {
    ...process.env,
    NODE_ENV: "test" as const,
    DATABASE_URL: E2E_DATABASE_URL,
    BETTER_AUTH_SECRET:
      process.env.BETTER_AUTH_SECRET ?? "9f3c1a7b5d2e8f604b1c9a7e3d5f2b8c6a4e0d9b7c5a3e1f",
    CRON_SECRET: process.env.CRON_SECRET ?? "7c2e9a4f1b8d6e3a5c0f9b2d4e7a1c8f",
    APP_URL: "http://localhost:3002",
    PAYMENTS_MODE: "test-bypass",
    LOG_LEVEL: "warn",
  };
  execFileSync("npx", ["tsx", "scripts/migrate.ts"], { env, stdio: "inherit" });
  execFileSync("npx", ["tsx", "--conditions=react-server", "scripts/seed.ts", "--reset"], {
    env,
    stdio: "inherit",
  });
}
