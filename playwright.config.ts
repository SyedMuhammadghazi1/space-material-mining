import { defineConfig, devices } from "@playwright/test";

const PORT = 3002;
const BASE_URL = `http://localhost:${PORT}`;
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/space_mining_test";

/**
 * E2E smoke tests run against a PRODUCTION build (`next start`) on port 3002 with a freshly
 * migrated and seeded test database. Run `npm run build` first.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run start",
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      NODE_ENV: "production",
      DATABASE_URL: E2E_DATABASE_URL,
      APP_URL: BASE_URL,
      BETTER_AUTH_URL: BASE_URL,
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ?? "9f3c1a7b5d2e8f604b1c9a7e3d5f2b8c6a4e0d9b7c5a3e1f",
      CRON_SECRET: process.env.CRON_SECRET ?? "7c2e9a4f1b8d6e3a5c0f9b2d4e7a1c8f",
      PAYMENTS_MODE: "stripe",
      LOG_LEVEL: "warn",
      // Generous limits: the suite signs in repeatedly from one IP.
      AUTH_RATE_LIMIT_PER_MINUTE: "100",
    },
  },
});
