import { AppError } from "@/core/errors";
import { handle } from "@/server/http";
import { requireUser } from "@/server/session";
import { storage, verifyEvidenceSignature } from "@/server/storage";
import { evidenceForDownload } from "@/server/submissions";

export const dynamic = "force-dynamic";

/**
 * The only way a screenshot leaves storage. Three checks, all required:
 * a signed-in session, a short-lived signature bound to that session's
 * wallet, and ownership (or the reviewer role).
 */
export async function GET(request: Request, ctx: RouteContext<"/api/evidence/[id]/file">) {
  return handle(async () => {
    const viewer = await requireUser();
    const { id } = await ctx.params;
    const query = new URL(request.url).searchParams;
    if (!verifyEvidenceSignature(id, viewer.address, query.get("e"), query.get("s"))) {
      throw new AppError(403, "This link has expired. Reload the page.");
    }
    const row = await evidenceForDownload(id);
    if (!row || (row.userId !== viewer.userId && !viewer.isAdmin)) throw new AppError(404, "Not found.");
    if (row.evidence.fileDeletedAt) throw new AppError(410, "This screenshot was deleted.");
    const bytes = await storage().get(row.evidence.storageKey);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": row.evidence.mime,
        "content-length": String(bytes.length),
        "cache-control": "private, no-store",
        "content-disposition": "inline",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  });
}
