/**
 * The one place the client IP is derived from request headers (rate limits, audit log, Better Auth
 * sessions). Configure it for the hosting platform — see docs/DEPLOYMENT.md:
 *
 * - `CLIENT_IP_HEADER`: a single header the platform sets and clients cannot spoof (`x-real-ip` on
 *   Vercel, `fly-client-ip` on Fly.io, `cf-connecting-ip` behind Cloudflare). Only that header is
 *   used.
 * - otherwise `TRUSTED_PROXY_HOPS` (default 1): proxies in front of the app that each append the
 *   address they saw to X-Forwarded-For. The entry that many positions from the right is the one
 *   the outermost trusted proxy appended; everything left of it is client-controlled. `0` never
 *   trusts the header.
 *
 * Returns null when no trustworthy, valid IP is available — callers must not lump such requests
 * into one shared bucket where that would let one client lock out everyone.
 */
import { isIP } from "node:net";
import { getEnv } from "@/env";

export interface ClientIpOptions {
  clientIpHeader?: string;
  trustedProxyHops: number;
}

const FORWARDED_FOR = "x-forwarded-for";

/**
 * Header the auth route handler sets to the resolved IP for Better Auth (configured as its only
 * `ipAddressHeaders` entry). The handler always drops any client-supplied value first.
 */
export const AUTH_CLIENT_IP_HEADER = "x-oq-client-ip";

export function resolveClientIp(headers: Headers, options: ClientIpOptions): string | null {
  if (options.clientIpHeader) {
    return normalizeIp(headers.get(options.clientIpHeader)?.split(",")[0]);
  }
  const hops = options.trustedProxyHops;
  if (hops < 1) return null;
  const entries = headers.get(FORWARDED_FOR)?.split(",") ?? [];
  if (entries.length < hops) return null;
  return normalizeIp(entries[entries.length - hops]);
}

/** Client IP for this request per the environment configuration, or null. */
export function clientIp(headers: Headers): string | null {
  const env = getEnv();
  return resolveClientIp(headers, {
    clientIpHeader: env.CLIENT_IP_HEADER,
    trustedProxyHops: env.TRUSTED_PROXY_HOPS,
  });
}

/**
 * Returns the address if `net.isIP` accepts it, in a canonical form so one client maps to one key:
 * IPv6 lower-cased without a zone index (`fe80::1%eth0`), IPv4-mapped IPv6 as plain IPv4.
 */
export function normalizeIp(value: string | null | undefined): string | null {
  let ip = value?.trim() ?? "";
  if (ip.includes(":")) ip = ip.split("%")[0]!.toLowerCase();
  const family = isIP(ip);
  if (family === 4) return ip;
  if (family !== 6) return null;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip)?.[1];
  return mapped && isIP(mapped) === 4 ? mapped : ip;
}
