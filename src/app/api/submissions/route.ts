import { assertSameOrigin, handle, readJson } from "@/server/http";
import { requireUser } from "@/server/session";
import { createDraft } from "@/server/submissions";

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = await readJson(request);
    const draft = await createDraft(user, { platform: body.platform, weekStart: body.weekStart });
    return Response.json({ id: draft.id, status: draft.status });
  });
}
