import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { getEnv } from "@/env";
import { APP_NAME } from "@/lib/app-config";
import { AUTH_CLIENT_IP_HEADER } from "@/lib/client-ip";

function createAuth() {
  const env = getEnv();
  const baseURL = env.BETTER_AUTH_URL ?? env.APP_URL;
  return betterAuth({
    appName: APP_NAME,
    baseURL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [baseURL, env.APP_URL],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    user: {
      additionalFields: {
        // Roles are assigned by administrators only — never accepted from sign-up input.
        role: { type: "string", required: false, defaultValue: "customer", input: false },
        company: { type: "string", required: false, input: true },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    // Rate limiting (per client IP and per account) is enforced by our Postgres-backed limiter in the
    // auth route handler so it works across instances; Better Auth's in-memory limiter is disabled
    // to avoid double counting.
    rateLimit: { enabled: false },
    advanced: {
      useSecureCookies: baseURL.startsWith("https://"),
      // The client IP recorded on sessions comes from our resolver (src/lib/client-ip.ts): the auth
      // route handler puts it in this header after dropping any client-supplied value. Better Auth
      // must not read X-Forwarded-For itself (its default), which would disagree with — and be
      // easier to spoof than — the rest of the app.
      ipAddress: { ipAddressHeaders: [AUTH_CLIENT_IP_HEADER], ipv6Subnet: 128 },
    },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { __oqAuth?: Auth };

export const auth: Auth = globalForAuth.__oqAuth ?? createAuth();
if (process.env.NODE_ENV !== "production") globalForAuth.__oqAuth = auth;

export type Session = Auth["$Infer"]["Session"];
