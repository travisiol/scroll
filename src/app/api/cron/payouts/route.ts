import { timingSafeEqual } from "node:crypto";
import { AppError } from "@/core/errors";
import { cronSecret } from "@/server/env";
import { handle } from "@/server/http";
import { tick } from "@/server/payouts/worker";
import { purgeExpiredEvidence } from "@/server/submissions";

export const dynamic = "force-dynamic";

/**
 * The scheduled entry point: `npm run worker`, or any cron, calls this with
 * `Authorization: Bearer $CRON_SECRET`. It advances the payout queue and
 * applies the screenshot retention policy. Disabled until CRON_SECRET is set.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const secret = cronSecret();
    if (!secret) throw new AppError(503, "CRON_SECRET is not configured.");
    const given = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
    const expected = Buffer.from(secret);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new AppError(401, "Unauthorized.");
    const payouts = await tick();
    const purged = await purgeExpiredEvidence();
    return Response.json({ payouts, purged });
  });
}
