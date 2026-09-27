import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as authPOST } from "@/app/api/auth/[...all]/route";
import { resetEnvCache } from "@/env";
import { RateLimitedError } from "@/server/errors";
import { rateLimit } from "@/server/rate-limit";
import { requestQuote } from "@/server/quotes";
import { createActor, seedReference } from "./helpers";

beforeEach(async () => {
  await seedReference();
});

afterEach(() => {
  delete process.env.AUTH_RATE_LIMIT_PER_MINUTE;
  delete process.env.PUBLIC_WRITE_RATE_LIMIT_PER_HOUR;
  resetEnvCache();
});

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
