import { AppError } from "@/core/errors";
import { UPLOADS } from "@/config/uploads";
import { assertSameOrigin, handle, readBytes, readJson } from "@/server/http";
import { requireUser } from "@/server/session";
import { signedEvidenceUrl } from "@/server/storage";
import { addEvidence, deleteDraft, deleteEvidenceFiles, removeEvidence, submitForReview } from "@/server/submissions";

type Ctx = RouteContext<"/api/submissions/[id]/[op]">;

export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id, op } = await ctx.params;

    if (op === "evidence") {
      // The body is the raw file. Its type is decided from its bytes on the server.
      const bytes = await readBytes(request, UPLOADS.maxBytes);
      const { evidence, duplicate } = await addEvidence(user, id, bytes);
      return Response.json({ evidence: { ...evidence, url: signedEvidenceUrl(evidence.id, user.address) }, duplicate });
    }

    if (op === "submit") {
      const body = await readJson(request);
      const updated = await submitForReview(user, id, { confirmed: body.confirmed });
      return Response.json({ id: updated.id, status: updated.status });
    }

    throw new AppError(404, "Not found.");
  });
}

export async function DELETE(request: Request, ctx: Ctx) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id, op } = await ctx.params;

    if (op === "evidence") {
      const evidenceId = new URL(request.url).searchParams.get("evidenceId") ?? "";
      await removeEvidence(user, id, evidenceId);
      return Response.json({ ok: true });
    }
    if (op === "draft") {
      await deleteDraft(user, id);
      return Response.json({ ok: true });
    }
    if (op === "files") {
      return Response.json({ deleted: await deleteEvidenceFiles(user, id) });
    }
    throw new AppError(404, "Not found.");
  });
}
