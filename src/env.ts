import { z } from "zod";

/**
 * Environment validation. Parsed lazily on first use so `next build` can run with
 * SKIP_ENV_VALIDATION=1 (placeholders are substituted) while runtime fails fast. The flag is
 * ignored by a production server (see `skipValidation`).
 */
const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.url(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    APP_URL: z.url().default("http://localhost:3002"),
    NEXT_PUBLIC_APP_NAME: z.string().min(1).default("Orbital Quarry"),
    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    BETTER_AUTH_URL: z.url().optional(),
    CRON_SECRET: z.string().min(16, "CRON_SECRET must be at least 16 characters"),
    // Client IP resolution (rate limits, audit log, sessions): see src/lib/client-ip.ts.
    CLIENT_IP_HEADER: z
      .string()
      .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/, "CLIENT_IP_HEADER must be a single header name")
      .transform((h) => h.toLowerCase())
      .refine((h) => !h.startsWith("x-forwarded-"), {
        message:
          "CLIENT_IP_HEADER must be a header clients cannot spoof, not X-Forwarded-* (use TRUSTED_PROXY_HOPS for X-Forwarded-For)",
      })
      .optional(),
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(20).default(1),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),

    PAYMENTS_MODE: z.enum(["stripe", "test-bypass"]).default("stripe"),
    STRIPE_SECRET_KEY: z
      .string()
      .startsWith("sk_")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    STRIPE_WEBHOOK_SECRET: z
      .string()
      .startsWith("whsec_")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    STRIPE_CURRENCY: z.string().length(3).default("usd"),
    INVOICE_DAYS_UNTIL_DUE: z.coerce.number().int().min(1).max(90).default(14),

    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().default(587),
    SMTP_SECURE: bool,
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    EMAIL_FROM: z.string().default("Orbital Quarry <no-reply@example.com>"),
    OPS_ALERT_EMAILS: z.string().optional(),

    QUOTE_MARGIN_PERCENT: z.coerce.number().min(0).max(500).default(25),
    QUOTE_VALIDITY_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    DEPOSIT_PERCENT: z.coerce.number().min(0).max(100).default(10),
    IN_SPACE_PROPELLANT_COST_PER_KG_CENTS: z.coerce.number().int().min(0).default(100_000),
    FABRICATION_ENERGY_COST_PER_KWH_CENTS: z.coerce.number().int().min(0).default(200),
    LAUNCH_COST_PER_KG_CENTS: z.coerce.number().int().min(0).default(250_000),

    RIG_SILENT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    TELEMETRY_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
    AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),
    PUBLIC_WRITE_RATE_LIMIT_PER_HOUR: z.coerce.number().int().min(1).default(20),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.PAYMENTS_MODE === "test-bypass") {
      ctx.addIssue({
        code: "custom",
        path: ["PAYMENTS_MODE"],
        message: "PAYMENTS_MODE=test-bypass is never allowed when NODE_ENV=production",
      });
    }
  });

export type Env = z.infer<typeof schema>;

const BUILD_PLACEHOLDERS: Record<string, string> = {
  DATABASE_URL: "postgres://placeholder:placeholder@localhost:5432/placeholder",
  BETTER_AUTH_SECRET: "build-placeholder-secret-not-used-at-runtime",
  CRON_SECRET: "build-placeholder-cron-secret",
};

let cached: Env | undefined;

/**
 * SKIP_ENV_VALIDATION exists for `next build` (CI, Docker) only. With NODE_ENV=production it is
 * honoured solely while Next.js is building (`NEXT_PHASE=phase-production-build`), so a production
 * server that inherits the flag still validates and fails fast instead of silently running on
 * placeholder secrets.
 */
function skipValidation(): boolean {
  const flag = process.env.SKIP_ENV_VALIDATION;
  if (flag !== "1" && flag !== "true") return false;
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.NEXT_PHASE === "phase-production-build";
}

export function getEnv(): Env {
  if (cached) return cached;
  const skip = skipValidation();
  // Empty strings count as "unset" so `.env.example`-style blank lines behave like omitted keys.
  const source = skip
    ? { ...BUILD_PLACEHOLDERS, ...stripEmpty(process.env) }
    : stripEmpty(process.env);
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    if (skip) {
      cached = schema.parse({ ...BUILD_PLACEHOLDERS, NODE_ENV: "development" });
      return cached;
    }
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

function stripEmpty(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => !!e[1]));
}

/** Test helper: forget the cached env so tests can change process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
