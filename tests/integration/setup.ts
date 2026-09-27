import { afterAll, beforeEach } from "vitest";
import { clearOutbox } from "@/lib/mailer";
import { resetEnvCache } from "@/env";
import { pool } from "@/db";
import { truncateAll } from "./helpers";

beforeEach(async () => {
  resetEnvCache();
  clearOutbox();
  await truncateAll();
});

afterAll(async () => {
  await pool.end();
  const g = globalThis as Record<string, unknown>;
  delete g.__oqPool;
  delete g.__oqAuth;
});
