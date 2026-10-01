import { AppError } from "@/core/errors";
import { fundPool, retryAwaitingFunding } from "@/server/allocations";
import { assertSameOrigin, handle, readJson } from "@/server/http";
import { retryFailedJob, tick } from "@/server/payouts/worker";
import { createPolicyDraft, publishPolicy, updatePolicyDraft } from "@/server/policies";
import { decide, setVerifiedUsage } from "@/server/review";
import { requireAdmin } from "@/server/session";
import { updateSettings } from "@/server/settings";
import { purgeExpiredEvidence } from "@/server/submissions";

/**
 * Every admin mutation goes through this one handler, and the first thing it
 * does is requireAdmin(): the reviewer role is checked on the server for each
 * request, from the allowlist. Nothing the browser sends can grant it.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/[...op]">) {
  return handle(async () => {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const actor = admin.address;
    const { op } = await ctx.params;
    const route = op.join("/");
    const body = await readJson(request);

    // submissions/<id>/usage | submissions/<id>/decision
    if (op[0] === "submissions" && op.length === 3) {
      if (op[2] === "usage") return Response.json({ usage: await setVerifiedUsage(actor, op[1], body.usage) });
      if (op[2] === "decision") {
        const { submission, allocations } = await decide(actor, op[1], { action: body.action, reason: body.reason });
        return Response.json({ status: submission.status, allocations: allocations.length });
      }
    }

    if (route === "policy") return Response.json({ id: (await createPolicyDraft(actor, body.config)).id });
    if (op[0] === "policy" && op.length === 2) return Response.json({ id: (await updatePolicyDraft(actor, op[1], body.config)).id });
    if (op[0] === "policy" && op.length === 3 && op[2] === "publish") return Response.json({ version: (await publishPolicy(actor, op[1])).version });

    if (route === "pools/fund") {
      await fundPool(actor, { ticker: body.ticker, amount: body.amount, note: body.note });
      return Response.json({ ok: true });
    }
    if (route === "pools/retry") return Response.json(await retryAwaitingFunding(actor));

    if (route === "payouts/run") return Response.json(await tick());
    if (op[0] === "payouts" && op.length === 3 && op[2] === "retry") {
      await retryFailedJob(actor, op[1]);
      return Response.json({ ok: true });
    }

    if (route === "settings") return Response.json(await updateSettings(actor, { payoutsEnabled: body.payoutsEnabled as boolean | undefined }));
    if (route === "retention/run") return Response.json({ deleted: await purgeExpiredEvidence() });

    throw new AppError(404, "Not found.");
  });
}
