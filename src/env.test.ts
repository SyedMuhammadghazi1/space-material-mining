import { afterEach, describe, expect, it } from "vitest";
import { getEnv, resetEnvCache } from "./env";

const saved = { ...process.env };

function withEnv(vars: Record<string, string | undefined>) {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCache();
}

const valid = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  BETTER_AUTH_SECRET: "x".repeat(40),
  CRON_SECRET: "y".repeat(20),
  SKIP_ENV_VALIDATION: undefined,
};

afterEach(() => withEnv({}));

describe("env validation", () => {
  it("parses and applies defaults", () => {
    withEnv({ ...valid, NODE_ENV: "development", DEPOSIT_PERCENT: undefined });
    const env = getEnv();
    expect(env.DEPOSIT_PERCENT).toBe(10);
    expect(env.PAYMENTS_MODE).toBe("stripe");
  });

  it("treats blank values as unset", () => {
    withEnv({ ...valid, NODE_ENV: "development", BETTER_AUTH_URL: "", SMTP_HOST: "" });
    expect(getEnv().BETTER_AUTH_URL).toBeUndefined();
    expect(getEnv().SMTP_HOST).toBeUndefined();
  });

  it("fails fast on missing secrets", () => {
    withEnv({ ...valid, NODE_ENV: "development", BETTER_AUTH_SECRET: "short" });
    expect(() => getEnv()).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("never allows the payments test bypass in production", () => {
    withEnv({ ...valid, NODE_ENV: "production", PAYMENTS_MODE: "test-bypass" });
    expect(() => getEnv()).toThrow(/test-bypass/);
  });

  it("substitutes placeholders when SKIP_ENV_VALIDATION=1 during `next build`", () => {
    withEnv({
      NODE_ENV: "production",
      NEXT_PHASE: "phase-production-build",
      SKIP_ENV_VALIDATION: "1",
      DATABASE_URL: undefined,
      BETTER_AUTH_SECRET: undefined,
      CRON_SECRET: undefined,
    });
    expect(getEnv().DATABASE_URL).toMatch(/placeholder/);
  });

  it("ignores SKIP_ENV_VALIDATION in a running production server", () => {
    for (const flag of ["1", "true"]) {
      withEnv({
        NODE_ENV: "production",
        NEXT_PHASE: undefined,
        SKIP_ENV_VALIDATION: flag,
        DATABASE_URL: undefined,
        BETTER_AUTH_SECRET: undefined,
        CRON_SECRET: undefined,
      });
      expect(() => getEnv()).toThrow(/Invalid environment configuration/);
    }
    // Any other Next.js phase (e.g. `next start` → phase-production-server) is runtime too.
    withEnv({
      NODE_ENV: "production",
      NEXT_PHASE: "phase-production-server",
      SKIP_ENV_VALIDATION: "1",
      BETTER_AUTH_SECRET: undefined,
    });
    expect(() => getEnv()).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("never substitutes placeholders for real values in a running production server", () => {
    withEnv({ ...valid, NODE_ENV: "production", SKIP_ENV_VALIDATION: "1", NEXT_PHASE: undefined });
    const env = getEnv();
    expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
    expect(env.BETTER_AUTH_SECRET).toBe(valid.BETTER_AUTH_SECRET);
    expect(env.NODE_ENV).toBe("production");
    // …and production-only rules still apply.
    withEnv({
      ...valid,
      NODE_ENV: "production",
      SKIP_ENV_VALIDATION: "1",
      NEXT_PHASE: undefined,
      PAYMENTS_MODE: "test-bypass",
    });
    expect(() => getEnv()).toThrow(/test-bypass/);
  });
});
