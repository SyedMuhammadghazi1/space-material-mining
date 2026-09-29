import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import { POST as authPOST } from "@/app/api/auth/[...all]/route";
import { db } from "@/db";
import { auditLog, session, user } from "@/db/schema";
import { resetEnvCache } from "@/env";
import { AUTH_CLIENT_IP_HEADER } from "@/lib/client-ip";
import { audit } from "@/server/audit";
import { RateLimitedError } from "@/server/errors";
import { rateLimit } from "@/server/rate-limit";
import { requestQuote } from "@/server/quotes";
import { getApiActor } from "@/server/session";
import { createActor, seedReference, signUpWithSession } from "./helpers";

beforeEach(async () => {
  await seedReference();
});

afterEach(() => {
  delete process.env.AUTH_RATE_LIMIT_PER_MINUTE;
  delete process.env.PUBLIC_WRITE_RATE_LIMIT_PER_HOUR;
  delete process.env.TRUSTED_PROXY_HOPS;
  delete process.env.CLIENT_IP_HEADER;
  resetEnvCache();
});

let seq = 0;
/** POST to a Better Auth endpoint through our route handler, as a browser behind one proxy would. */
function authRequest(
  endpoint: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
  encoding: "json" | "form" = "json",
) {
  return authPOST(
    new Request(`http://localhost:3002/api/auth/${endpoint}`, {
      method: "POST",
      headers: {
        "content-type":
          encoding === "json" ? "application/json" : "application/x-www-form-urlencoded",
        origin: "http://localhost:3002",
        ...headers,
      },
      body:
        encoding === "json"
          ? JSON.stringify(body)
          : new URLSearchParams(body as Record<string, string>).toString(),
    }),
  );
}
const signIn = (email: string, headers: Record<string, string> = {}) =>
  authRequest("sign-in/email", { email, password: "wrong-password-123" }, headers);
const freshEmail = () => `probe-${++seq}-${Date.now()}@example.test`;
const via = (xff: string) => ({ "x-forwarded-for": xff });
const limitTo = (n: number) => {
  process.env.AUTH_RATE_LIMIT_PER_MINUTE = String(n);
  resetEnvCache();
};

describe("Postgres fixed-window rate limiter", () => {
  it("counts per key and window across concurrent callers", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => rateLimit("test:key", 5, 60)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results.filter((r) => !r.ok).every((r) => r.retryAfterSeconds >= 1)).toBe(true);
    expect((await rateLimit("test:other", 5, 60)).ok).toBe(true);
  });

  it("limits sign-in attempts per client with a 429", async () => {
    process.env.AUTH_RATE_LIMIT_PER_MINUTE = "3";
    resetEnvCache();
    const attempt = () =>
      authPOST(
        new Request("http://localhost:3002/api/auth/sign-in/email", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:3002" },
          body: JSON.stringify({ email: "nobody@example.test", password: "wrong-password-123" }),
        }),
      );
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await attempt()).status);
    expect(statuses.slice(0, 3).every((s) => s !== 429)).toBe(true);
    expect(statuses[3]).toBe(429);
  });

  it("limits quote requests per customer", async () => {
    process.env.PUBLIC_WRITE_RATE_LIMIT_PER_HOUR = "2";
    resetEnvCache();
    const customer = await createActor("customer");
    const rfq = () => requestQuote(customer, { itemCode: "O2", quantity: 10, deliveryNode: "LLO" });
    await rfq();
    await rfq();
    await expect(rfq()).rejects.toBeInstanceOf(RateLimitedError);
    const other = await createActor("customer");
    await expect(
      requestQuote(other, { itemCode: "O2", quantity: 10, deliveryNode: "LLO" }),
    ).resolves.toBeTruthy();
  });
});

describe("auth endpoints are limited per client IP and per account", () => {
  it("limits one IP across many accounts", async () => {
    limitTo(3);
    const statuses = [];
    for (let i = 0; i < 4; i++)
      statuses.push((await signIn(freshEmail(), via("203.0.113.9"))).status);
    expect(statuses.slice(0, 3).every((s) => s !== 429)).toBe(true);
    expect(statuses[3]).toBe(429);
    // Another client is unaffected.
    expect((await signIn(freshEmail(), via("203.0.113.10"))).status).not.toBe(429);
  });

  it("ignores a spoofed leftmost X-Forwarded-For entry", async () => {
    limitTo(3);
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      const spoofed = `198.51.100.${i + 1}, 203.0.113.9`; // client-chosen, then proxy-appended
      statuses.push((await signIn(freshEmail(), via(spoofed))).status);
    }
    expect(statuses[3]).toBe(429);
  });

  it("limits one account across many IPs (JSON and form bodies alike)", async () => {
    limitTo(3);
    const email = freshEmail();
    const statuses = [];
    for (let i = 0; i < 3; i++)
      statuses.push((await signIn(email, via(`203.0.113.${i + 1}`))).status);
    const form = await authRequest(
      "sign-in/email",
      { email: email.toUpperCase(), password: "wrong-password-123" },
      via("203.0.113.99"),
      "form",
    );
    expect(statuses.every((s) => s !== 429)).toBe(true);
    expect(form.status).toBe(429);
  });

  it("without a trustworthy IP, clients don't share one bucket but per-account limits still apply", async () => {
    limitTo(3);
    process.env.TRUSTED_PROXY_HOPS = "0";
    resetEnvCache();
    const others = [];
    for (let i = 0; i < 6; i++)
      others.push((await signIn(freshEmail(), via("203.0.113.9"))).status);
    expect(others.every((s) => s !== 429)).toBe(true);
    const email = freshEmail();
    const same = [];
    for (let i = 0; i < 4; i++) same.push((await signIn(email)).status);
    expect(same[3]).toBe(429);
  });

  it("limits sign-up per account", async () => {
    limitTo(2);
    const email = freshEmail();
    const body = { email, password: "short", name: "Probe" }; // rejected by Better Auth: no user
    const statuses = [];
    for (let i = 0; i < 3; i++)
      statuses.push((await authRequest("sign-up/email", body, via(`203.0.113.${i + 1}`))).status);
    expect(statuses[2]).toBe(429);
  });
});

describe("client IP recorded by Better Auth and the audit log", () => {
  it("stores the resolved IP on new sessions and ignores a client-supplied internal header", async () => {
    const email = freshEmail();
    const res = await authRequest(
      "sign-up/email",
      { email, password: "correct-horse-battery", name: "Probe" },
      { "x-forwarded-for": "6.6.6.6, 203.0.113.44", [AUTH_CLIENT_IP_HEADER]: "6.6.6.6" },
    );
    expect(res.status).toBe(200);
    const [row] = await db
      .select({ ip: session.ipAddress })
      .from(session)
      .innerJoin(user, eq(user.id, session.userId))
      .where(eq(user.email, email));
    expect(row!.ip).toBe("203.0.113.44");
  });

  it("records the actor's IP on audit entries", async () => {
    const { cookie } = await signUpWithSession("admin");
    const actor = await getApiActor(
      new Request("http://localhost:3002/api/v1/orders", {
        headers: { cookie, "x-forwarded-for": "6.6.6.6, 2001:DB8::5" },
      }),
    );
    expect(actor.ip).toBe("2001:db8::5");
    await audit(db, actor, { action: "test.ip", entityType: "test" });
    const [entry] = await db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(1);
    expect(entry!.ip).toBe("2001:db8::5");
  });
});
