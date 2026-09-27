/**
 * Applies committed SQL migrations from ./drizzle (or $MIGRATIONS_DIR).
 * Bundled to dist/migrate.mjs for the production image: `node migrate.mjs`.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const migrationsFolder = process.env.MIGRATIONS_DIR ?? "./drizzle";
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
    console.log(JSON.stringify({ level: "info", msg: "migrations applied", migrationsFolder }));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(
    JSON.stringify({ level: "error", msg: "migration failed", error: String(err?.message ?? err) }),
  );
  process.exit(1);
});
