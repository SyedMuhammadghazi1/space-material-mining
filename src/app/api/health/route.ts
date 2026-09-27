export const dynamic = "force-dynamic";

/** Liveness: the process is up. Deliberately does not touch the database. */
export function GET() {
  return Response.json(
    { status: "ok", uptimeSeconds: Math.round(process.uptime()) },
    { headers: { "cache-control": "no-store" } },
  );
}
