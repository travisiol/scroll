import "server-only";
import { cookies } from "next/headers";
import { AppError } from "@/core/errors";
import { sessionFromToken, type SessionUser } from "./auth";

export const SESSION_COOKIE = "scroll_session";

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function currentSession(): Promise<SessionUser | null> {
  return sessionFromToken(await sessionToken());
}

export async function requireUser(): Promise<SessionUser> {
  const session = await currentSession();
  if (!session) throw new AppError(401, "Sign in with your wallet to continue.");
  return session;
}

/** Every admin route and page calls this. The role is re-derived from the server allowlist each time. */
export async function requireAdmin(): Promise<SessionUser> {
  const session = await requireUser();
  if (!session.isAdmin) throw new AppError(403, "This wallet is not a SCROLL reviewer.");
  return session;
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** For pages: the session if it belongs to a reviewer, otherwise null. Layouts are not a security boundary, so every admin page calls this itself. */
export async function currentAdmin(): Promise<SessionUser | null> {
  const session = await currentSession();
  return session?.isAdmin ? session : null;
}
