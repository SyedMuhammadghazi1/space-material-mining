import { getEnv } from "@/env";
import { telemetryBatchSchema } from "@/lib/telemetry-schema";
import { parseBearer } from "@/server/api-keys";
import { UnauthorizedError, ValidationError, errorResponse } from "@/server/errors";
import { enforceRateLimit } from "@/server/rate-limit";
import { clientIp } from "@/server/request";
import { authenticateRigKey } from "@/server/rigs";
import { ingestTelemetry } from "@/server/telemetry";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 512 * 1024;

/**
 * Rig telemetry ingest. Auth: `Authorization: Bearer <rig API key>`.
 * Body: { readings: [{ seq, timestamp, regolithProcessedKg, powerKw, temperatureC, outputKg }] }.
 * Idempotent on (rig, seq); newly accepted output is credited to the rig's depot ledger.
 */
export async function POST(req: Request) {
  try {
    const token = parseBearer(req.headers.get("authorization"));
    if (!token) {
      await enforceRateLimit(`telemetry:anon:${clientIp(req.headers)}`, 30, 60);
      throw new UnauthorizedError("Missing or malformed bearer API key");
    }
    const rig = await authenticateRigKey(token);
    if (!rig) {
      await enforceRateLimit(`telemetry:badkey:${clientIp(req.headers)}`, 30, 60);
      throw new UnauthorizedError("Invalid or revoked API key");
    }
    await enforceRateLimit(`telemetry:rig:${rig.id}`, getEnv().TELEMETRY_RATE_LIMIT_PER_MINUTE, 60);

    const length = Number(req.headers.get("content-length") ?? 0);
    if (length > MAX_BODY_BYTES) throw new ValidationError("Payload too large (max 512 KiB)");
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) throw new ValidationError("Payload too large (max 512 KiB)");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ValidationError("Body must be valid JSON");
    }
    const batch = telemetryBatchSchema.parse(json);
    const result = await ingestTelemetry(rig, batch);
    return Response.json(result, { status: result.accepted > 0 ? 201 : 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
