import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/** Recreates the test database schema from the committed migrations once per test run. */
export default async function globalSetup() {
  const url =
    process.env.TEST_DATABASE_URL ??
    "postgres://postgres:postgres@localhost:5432/space_mining_test";
  if (!/_test\b|test/.test(new URL(url).pathname)) {
    throw new Error(`Refusing to reset a database that does not look like a test database: ${url}`);
  }
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await pool.query(
      "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;",
    );
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  } finally {
    await pool.end();
  }
}
