import { parseBearer } from "@/server/api-keys";
import { UnauthorizedError, errorResponse } from "@/server/errors";
import { authenticateRigKey } from "@/server/rigs";

export const dynamic = "force-dynamic";

/** Lets a rig (or the simulator) discover its identity and last accepted sequence number. */
export async function GET(req: Request) {
  try {
    const token = parseBearer(req.headers.get("authorization"));
    const rig = token ? await authenticateRigKey(token) : null;
    if (!rig) throw new UnauthorizedError("Invalid or revoked API key");
    return Response.json({
      id: rig.id,
      name: rig.name,
      processId: rig.processId,
      ratedPowerKw: rig.ratedPowerKw,
      temperatureRangeC: [rig.tempMinC, rig.tempMaxC],
      lastSeq: rig.lastSeq,
      lastSeenAt: rig.lastSeenAt,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
