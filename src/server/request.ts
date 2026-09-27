import { getEnv } from "@/env";

/**
 * Best-effort client IP. X-Forwarded-For is only trusted when TRUST_PROXY=true (i.e. the app runs
 * behind a load balancer that overwrites the header); otherwise all clients share one bucket key.
 */
export function clientIp(headers: Headers): string {
  if (getEnv().TRUST_PROXY) {
    const xff = headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0]!.trim().slice(0, 64);
    const real = headers.get("x-real-ip");
    if (real) return real.trim().slice(0, 64);
  }
  return "direct";
}
