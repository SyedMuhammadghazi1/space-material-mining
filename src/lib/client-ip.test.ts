import { afterEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/env";
import { clientIp, normalizeIp, resolveClientIp } from "./client-ip";

// Header names are case-insensitive; the canonical spelling is used here.
const xff = (value: string, extra: Record<string, string> = {}) =>
  new Headers({ "X-Forwarded-For": value, ...extra });
const hops = (trustedProxyHops: number) => ({ trustedProxyHops });

describe("resolveClientIp — X-Forwarded-For with TRUSTED_PROXY_HOPS", () => {
  it("takes the entry appended by the proxy in front of the app (hops = 1)", () => {
    expect(resolveClientIp(xff("203.0.113.7"), hops(1))).toBe("203.0.113.7");
  });

  it("ignores a spoofed leftmost entry", () => {
    // The client sent "X-Forwarded-For: 1.1.1.1"; the proxy appended the address it saw.
    expect(resolveClientIp(xff("1.1.1.1, 203.0.113.7"), hops(1))).toBe("203.0.113.7");
    expect(resolveClientIp(xff("1.1.1.1,2.2.2.2 ,  203.0.113.7"), hops(1))).toBe("203.0.113.7");
  });

  it("counts from the right for two proxies (hops = 2)", () => {
    // client-supplied, real client (added by the first proxy), first proxy (added by the second)
    expect(resolveClientIp(xff("1.1.1.1, 203.0.113.7, 10.0.0.2"), hops(2))).toBe("203.0.113.7");
    expect(resolveClientIp(xff("203.0.113.7, 10.0.0.2"), hops(2))).toBe("203.0.113.7");
  });

  it("returns null when there are fewer entries than hops", () => {
    expect(resolveClientIp(xff("10.0.0.2"), hops(2))).toBeNull();
    expect(resolveClientIp(xff("1.1.1.1, 10.0.0.2"), hops(3))).toBeNull();
  });

  it("returns null without the header or with hops = 0 (never trust it)", () => {
    expect(resolveClientIp(new Headers(), hops(1))).toBeNull();
    expect(resolveClientIp(xff("203.0.113.7"), hops(0))).toBeNull();
  });

  it("does not fall back to other headers", () => {
    const headers = new Headers({ "X-Real-IP": "203.0.113.7", "CF-Connecting-IP": "203.0.113.8" });
    expect(resolveClientIp(headers, hops(1))).toBeNull();
  });

  it("rejects values that are not IP addresses", () => {
    for (const bad of [
      "unknown",
      "",
      " ",
      "evil.example",
      "203.0.113.7:443",
      "999.1.1.1",
      "[::1]",
    ]) {
      expect(resolveClientIp(xff(`1.1.1.1, ${bad}`), hops(1))).toBeNull();
    }
    // An empty or invalid entry at the trusted position is not skipped in favour of a spoofable one.
    expect(resolveClientIp(xff("1.1.1.1, , 10.0.0.2"), hops(2))).toBeNull();
  });

  it("accepts IPv6 and canonicalises it", () => {
    expect(resolveClientIp(xff("1.1.1.1, 2001:DB8::1"), hops(1))).toBe("2001:db8::1");
    expect(resolveClientIp(xff("fe80::1%eth0"), hops(1))).toBe("fe80::1");
    expect(resolveClientIp(xff("::ffff:203.0.113.7"), hops(1))).toBe("203.0.113.7");
    expect(resolveClientIp(xff("::1"), hops(1))).toBe("::1");
  });
});

describe("resolveClientIp — CLIENT_IP_HEADER", () => {
  const options = { clientIpHeader: "x-real-ip", trustedProxyHops: 1 };

  it("uses only that header (first value, trimmed)", () => {
    expect(resolveClientIp(new Headers({ "X-Real-IP": " 203.0.113.7 " }), options)).toBe(
      "203.0.113.7",
    );
    expect(resolveClientIp(new Headers({ "X-Real-IP": "203.0.113.7, 10.0.0.1" }), options)).toBe(
      "203.0.113.7",
    );
    expect(
      resolveClientIp(new Headers({ "Fly-Client-IP": "2001:db8::7" }), {
        clientIpHeader: "fly-client-ip",
        trustedProxyHops: 1,
      }),
    ).toBe("2001:db8::7");
  });

  it("ignores X-Forwarded-For entirely", () => {
    expect(resolveClientIp(xff("203.0.113.7"), options)).toBeNull();
    expect(resolveClientIp(xff("203.0.113.7", { "X-Real-IP": "198.51.100.2" }), options)).toBe(
      "198.51.100.2",
    );
  });

  it("returns null for a missing or invalid value", () => {
    expect(resolveClientIp(new Headers(), options)).toBeNull();
    expect(resolveClientIp(new Headers({ "X-Real-IP": "localhost" }), options)).toBeNull();
  });
});

describe("normalizeIp", () => {
  it("validates with net.isIP", () => {
    expect(normalizeIp("192.0.2.1")).toBe("192.0.2.1");
    expect(normalizeIp("01.2.3.4")).toBeNull();
    expect(normalizeIp(null)).toBeNull();
    expect(normalizeIp("1.2.3.4%eth0")).toBeNull();
  });
});

describe("clientIp (configured from the environment)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetEnvCache();
  });
  const configure = (vars: Record<string, string | undefined>) => {
    process.env = {
      ...saved,
      DATABASE_URL: "postgres://u:p@localhost:5432/db",
      BETTER_AUTH_SECRET: "x".repeat(40),
      CRON_SECRET: "y".repeat(20),
      SKIP_ENV_VALIDATION: undefined,
      CLIENT_IP_HEADER: undefined,
      TRUSTED_PROXY_HOPS: undefined,
      ...vars,
    };
    resetEnvCache();
  };

  it("defaults to one trusted proxy hop", () => {
    configure({});
    expect(clientIp(xff("1.1.1.1, 203.0.113.7"))).toBe("203.0.113.7");
  });

  it("honours TRUSTED_PROXY_HOPS", () => {
    configure({ TRUSTED_PROXY_HOPS: "2" });
    expect(clientIp(xff("1.1.1.1, 203.0.113.7, 10.0.0.2"))).toBe("203.0.113.7");
    configure({ TRUSTED_PROXY_HOPS: "0" });
    expect(clientIp(xff("203.0.113.7"))).toBeNull();
  });

  it("honours CLIENT_IP_HEADER (case-insensitive name)", () => {
    configure({ CLIENT_IP_HEADER: "CF-Connecting-IP" });
    expect(clientIp(xff("203.0.113.7", { "cf-connecting-ip": "198.51.100.2" }))).toBe(
      "198.51.100.2",
    );
  });

  it("rejects an X-Forwarded-* header as CLIENT_IP_HEADER (its first value is client-controlled)", () => {
    configure({ CLIENT_IP_HEADER: "X-Forwarded-For" });
    expect(() => clientIp(new Headers())).toThrow(/CLIENT_IP_HEADER/);
  });

  it("rejects an invalid TRUSTED_PROXY_HOPS", () => {
    configure({ TRUSTED_PROXY_HOPS: "-1" });
    expect(() => clientIp(new Headers())).toThrow(/TRUSTED_PROXY_HOPS/);
  });
});
