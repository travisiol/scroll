import { AppError } from "@/core/errors";
import { createNonce, revokeAllSessions, revokeSession, verifySignIn } from "@/server/auth";
import { assertSameOrigin, handle, readJson } from "@/server/http";
import { clearSessionCookie, currentSession, sessionToken, setSessionCookie } from "@/server/session";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: RouteContext<"/api/auth/[op]">) {
  return handle(async () => {
    const { op } = await ctx.params;
    if (op === "nonce") {
      return Response.json(await createNonce(), { headers: { "cache-control": "no-store" } });
    }
    if (op === "me") {
      const session = await currentSession();
      return Response.json(
        { session: session ? { address: session.address, isAdmin: session.isAdmin } : null },
        { headers: { "cache-control": "no-store" } },
      );
    }
    throw new AppError(404, "Not found.");
  });
}

export async function POST(request: Request, ctx: RouteContext<"/api/auth/[op]">) {
  return handle(async () => {
    const { op } = await ctx.params;
    assertSameOrigin(request);

    if (op === "verify") {
      const body = await readJson<{ message: string; signature: string }>(request);
      const { token, address, expiresAt } = await verifySignIn({
        message: body.message,
        signature: body.signature,
        host: request.headers.get("host"),
        origin: request.headers.get("origin"),
      });
      await setSessionCookie(token, expiresAt);
      return Response.json({ address });
    }

    if (op === "logout") {
      await revokeSession(await sessionToken());
      await clearSessionCookie();
      return Response.json({ ok: true });
    }

    if (op === "logout-all") {
      const session = await currentSession();
      if (session) await revokeAllSessions(session.userId);
      await clearSessionCookie();
      return Response.json({ ok: true });
    }

    throw new AppError(404, "Not found.");
  });
}
