import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/env";
import { JOBS, isJobName } from "@/jobs";
import { logger } from "@/lib/logger";
import { NotFoundError, UnauthorizedError, errorResponse } from "@/server/errors";

export const dynamic = "force-dynamic";

function authorised(req: Request): boolean {
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${getEnv().CRON_SECRET}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** POST /api/cron/<job> with `Authorization: Bearer $CRON_SECRET`. Jobs are idempotent. */
export async function POST(req: Request, ctx: { params: Promise<{ job: string }> }) {
  try {
    if (!authorised(req)) throw new UnauthorizedError("Invalid cron secret");
    const { job } = await ctx.params;
    if (!isJobName(job)) throw new NotFoundError("Unknown job");
    const started = Date.now();
    const result = await JOBS[job]();
    logger.info({ job, ms: Date.now() - started }, "cron job completed");
    return Response.json({ job, result });
  } catch (err) {
    return errorResponse(err);
  }
}
