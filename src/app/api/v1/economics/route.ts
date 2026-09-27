import { errorResponse } from "@/server/errors";
import { readJsonCapped } from "@/server/request";
import { STAFF_ROLES } from "@/server/authz";
import { previewEconomics } from "@/server/scenarios";
import { requireApiRole } from "@/server/session";

export const dynamic = "force-dynamic";

/** Economics explorer backend: validates inputs server-side and runs the planning models. */
export async function POST(req: Request) {
  try {
    const actor = await requireApiRole(req, STAFF_ROLES);
    return Response.json(await previewEconomics(actor, await readJsonCapped(req, 64 * 1024)));
  } catch (err) {
    return errorResponse(err);
  }
}
