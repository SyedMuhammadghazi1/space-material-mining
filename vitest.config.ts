import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/space_mining_test";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
          setupFiles: ["tests/integration/setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
          env: {
            NODE_ENV: "test",
            DATABASE_URL: TEST_DATABASE_URL,
            BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-000",
            BETTER_AUTH_URL: "http://localhost:3002",
            CRON_SECRET: "test-cron-secret-0123456789",
            PAYMENTS_MODE: "test-bypass",
            STRIPE_WEBHOOK_SECRET: "whsec_test_integration_secret",
            LOG_LEVEL: "silent",
            SKIP_ENV_VALIDATION: "",
          },
        },
      },
    ],
  },
});
