import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "@/db/client";
import { appSecret } from "./env";

/**
 * Private screenshot storage.
 *
 * Files are written outside `public/` and are only returned by
 * /api/evidence/[id]/file, which requires (1) a signed-in owner or admin and
 * (2) a short-lived signature bound to that viewer. There is no public URL.
 *
 * To move to an object store, implement StorageDriver against a private
 * bucket and return it from driver(). The signed-URL layer stays the same.
 */
export interface StorageDriver {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

const KEY = /^ev_[0-9a-f]{24}\.(png|jpg|webp)$/;

function localPath(key: string): string {
  if (!KEY.test(key)) throw new Error("Invalid storage key");
  const dir = join(dataDir(), "evidence");
  mkdirSync(dir, { recursive: true });
  return join(dir, key);
}

const local: StorageDriver = {
  put: (key, bytes) => writeFile(localPath(key), bytes, { flag: "wx" }),
  get: (key) => readFile(localPath(key)),
  remove: (key) => rm(localPath(key), { force: true }),
};

const memory = new Map<string, Buffer>();
const inMemory: StorageDriver = {
  put: async (key, bytes) => void memory.set(key, Buffer.from(bytes)),
  get: async (key) => {
    const found = memory.get(key);
    if (!found) throw new Error("ENOENT");
    return found;
  },
  remove: async (key) => void memory.delete(key),
};

export function storage(): StorageDriver {
  return process.env.SCROLL_DB_MEMORY ? inMemory : local;
}

export const SIGNED_URL_TTL_SECONDS = 5 * 60;

function mac(evidenceId: string, viewer: string, expires: number): Buffer {
  return createHmac("sha256", appSecret()).update(`${evidenceId}\n${viewer.toLowerCase()}\n${expires}`).digest();
}

/** A URL that works for this viewer only, for a few minutes. */
export function signedEvidenceUrl(evidenceId: string, viewer: string, now = Date.now()): string {
  const expires = Math.floor(now / 1000) + SIGNED_URL_TTL_SECONDS;
  return `/api/evidence/${evidenceId}/file?e=${expires}&s=${mac(evidenceId, viewer, expires).toString("base64url")}`;
}

export function verifyEvidenceSignature(evidenceId: string, viewer: string, expires: string | null, signature: string | null, now = Date.now()): boolean {
  const e = Number(expires);
  if (!signature || !Number.isInteger(e) || e * 1000 < now) return false;
  let given: Buffer;
  try {
    given = Buffer.from(signature, "base64url");
  } catch {
    return false;
  }
  const expected = mac(evidenceId, viewer, e);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
