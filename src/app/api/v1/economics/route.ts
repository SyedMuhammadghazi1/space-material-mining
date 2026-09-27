import { ValidationError, errorResponse } from "@/server/errors";
import { STAFF_ROLES } from "@/server/authz";
import { previewEconomics } from "@/server/scenarios";
import { requireApiRole } from "@/server/session";

export const dynamic = "force-dynamic";

/** Economics explorer backend: validates inputs server-side and runs the planning models. */
export async function POST(req: Request) {
  try {
    const actor = await requireApiRole(req, STAFF_ROLES);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new ValidationError("Body must be valid JSON");
    }
    return Response.json(await previewEconomics(actor, body));
  } catch (err) {
    return errorResponse(err);
  }
}
