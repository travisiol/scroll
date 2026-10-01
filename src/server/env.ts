import "server-only";
import { createHash, randomBytes } from "node:crypto";

/** Server-side configuration. Nothing in this file is ever sent to the browser. */

function addressList(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[\s,]+/)
    .map((v) => v.trim().toLowerCase())
    .filter((v) => /^0x[0-9a-f]{40}$/.test(v));
}

/** The admin allowlist lives on the server. A client can't add itself to it. */
export function adminAddresses(): string[] {
  return addressList(process.env.ADMIN_WALLETS);
}

export function isAdminAddress(address: string): boolean {
  return adminAddresses().includes(address.toLowerCase());
}

let devSecret: string | null = null;

/** Signs short-lived screenshot URLs. Required in production. */
export function appSecret(): string {
  const configured = process.env.APP_SECRET;
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_SECRET (32+ characters) is required in production.");
  }
  const g = globalThis as { __scrollDevSecret?: string };
  devSecret ??= g.__scrollDevSecret ??= randomBytes(32).toString("hex");
  return devSecret;
}

/**
 * Hosts allowed to sign in. APP_ORIGINS is a comma-separated list of origins
 * (https://scroll.example). When unset, only the host the request arrived on
 * is accepted, which is right for local development.
 */
export function allowedOrigins(): string[] {
  return (process.env.APP_ORIGINS ?? "")
    .split(",")
    .map((v) => v.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function cronSecret(): string | null {
  const s = process.env.CRON_SECRET;
  return s && s.length >= 16 ? s : null;
}
