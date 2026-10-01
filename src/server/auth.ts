import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { createPublicClient, http, verifyMessage } from "viem";
import { generateSiweNonce, parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { getDb } from "@/db/client";
import { authNonces, sessions, users } from "@/db/schema";
import { AppError } from "@/core/errors";
import { CHAIN } from "@/config/network";
import { allowedOrigins, isAdminAddress, sha256Hex } from "./env";
import { newId } from "./util";

/**
 * Sign-in with a wallet (EIP-4361). Connecting a wallet proves nothing; the
 * account exists only once this module has verified a signed message.
 *
 * - The server issues a random nonce that expires and can be used once.
 * - The signed message must name the host and origin the request came from.
 * - The nonce is burned before the signature is checked, so a captured
 *   message + signature can't be replayed, even a valid one.
 * - The session is a random token in an httpOnly cookie; only its hash is stored.
 */

export const NONCE_TTL_MS = 10 * 60 * 1000;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionUser {
  userId: string;
  address: string;
  isAdmin: boolean;
  sessionId: string;
  kind: string;
}

export async function createNonce(now = new Date()): Promise<{ nonce: string; expiresAt: string }> {
  const db = await getDb();
  await db.delete(authNonces).where(lt(authNonces.expiresAt, new Date(now.getTime() - NONCE_TTL_MS)));
  const nonce = generateSiweNonce();
  const expiresAt = new Date(now.getTime() + NONCE_TTL_MS);
  await db.insert(authNonces).values({ nonce, createdAt: now, expiresAt });
  return { nonce, expiresAt: expiresAt.toISOString() };
}

export interface SignInInput {
  message: string;
  signature: string;
  /** Host header of the request. */
  host: string | null;
  /** Origin header of the request. */
  origin: string | null;
  now?: Date;
}

function refuse(message: string): never {
  throw new AppError(401, message);
}

async function signatureIsValid(address: `0x${string}`, message: string, signature: `0x${string}`, chainId: number): Promise<boolean> {
  try {
    if (await verifyMessage({ address, message, signature })) return true;
  } catch {
    // Not a plain 65-byte signature; it may be a smart-account signature.
  }
  if (chainId !== CHAIN.id || process.env.SCROLL_DB_MEMORY) return false;
  try {
    const client = createPublicClient({ transport: http(process.env.RPC_URL || CHAIN.publicRpcUrl) });
    return await client.verifyMessage({ address, message, signature });
  } catch {
    return false;
  }
}

export async function verifySignIn(input: SignInInput): Promise<{ token: string; address: string; expiresAt: Date }> {
  const now = input.now ?? new Date();
  if (typeof input.message !== "string" || input.message.length > 2000) refuse("Invalid sign-in message.");
  if (typeof input.signature !== "string" || !/^0x[0-9a-fA-F]{2,}$/.test(input.signature)) refuse("Invalid signature.");

  const parsed = parseSiweMessage(input.message);
  const { address, domain, nonce, uri, chainId, issuedAt, expirationTime } = parsed;
  if (!address || !domain || !nonce || !uri || !chainId || !issuedAt || !expirationTime || parsed.version !== "1") {
    refuse("The sign-in message is incomplete.");
  }

  // Domain and origin: the message must be for this site and come from its own page.
  if (!input.host || !input.origin) refuse("Sign-in must come from the SCROLL site.");
  let originUrl: URL;
  let uriUrl: URL;
  try {
    originUrl = new URL(input.origin!);
    uriUrl = new URL(uri!);
  } catch {
    refuse("Sign-in must come from the SCROLL site.");
  }
  if (originUrl!.host !== input.host || domain !== input.host || uriUrl!.origin !== originUrl!.origin) {
    refuse("This sign-in message was made for a different site.");
  }
  const allowed = allowedOrigins();
  if (allowed.length && !allowed.includes(originUrl!.origin)) {
    refuse("This sign-in message was made for a different site.");
  }

  if (issuedAt!.getTime() > now.getTime() + 5 * 60 * 1000 || now.getTime() - issuedAt!.getTime() > NONCE_TTL_MS) {
    refuse("This sign-in request has expired. Please try again.");
  }
  if (!validateSiweMessage({ message: parsed, domain: input.host!, nonce: nonce!, time: now })) {
    refuse("This sign-in request has expired. Please try again.");
  }

  // Burn the nonce first. One UPDATE decides the winner if two requests race.
  const db = await getDb();
  const burned = await db
    .update(authNonces)
    .set({ usedAt: now })
    .where(and(eq(authNonces.nonce, nonce!), isNull(authNonces.usedAt), gt(authNonces.expiresAt, now)))
    .returning({ nonce: authNonces.nonce });
  if (burned.length !== 1) refuse("This sign-in request has expired or was already used. Please try again.");

  const ok = await signatureIsValid(address!, input.message, input.signature as `0x${string}`, chainId!);
  if (!ok) refuse("The signature doesn't match this wallet.");

  return createSession(address!.toLowerCase(), now);
}

export async function createSession(address: string, now = new Date()) {
  const db = await getDb();
  const lower = address.toLowerCase();
  await db.insert(users).values({ id: newId("usr"), address: lower, createdAt: now }).onConflictDoNothing();
  const [user] = await db.update(users).set({ lastLoginAt: now }).where(eq(users.address, lower)).returning();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id: sha256Hex(token), userId: user.id, address: lower, kind: "wallet", createdAt: now, expiresAt });
  return { token, address: lower, expiresAt };
}

export async function sessionFromToken(token: string | undefined, now = new Date()): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const db = await getDb();
  const id = sha256Hex(token);
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, id), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!row) return null;
  // The role is decided here, on the server, on every request.
  return { userId: row.userId, address: row.address, isAdmin: isAdminAddress(row.address), sessionId: row.id, kind: row.kind };
}

export async function revokeSession(token: string | undefined, now = new Date()): Promise<void> {
  if (!token) return;
  const db = await getDb();
  await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, sha256Hex(token)));
}

export async function revokeAllSessions(userId: string, now = new Date()): Promise<void> {
  const db = await getDb();
  await db.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}
