import "server-only";
import { randomBytes } from "node:crypto";
import { auditEvents } from "@/db/schema";
import type { DbOrTx } from "@/db/client";

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export interface AuditInput {
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  data?: unknown;
}

/** Written in the same transaction as the change it describes. */
export async function audit(db: DbOrTx, event: AuditInput): Promise<void> {
  await db.insert(auditEvents).values({
    id: newId("aud"),
    actor: event.actor,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    data: event.data ?? null,
  });
}

/** Postgres unique_violation, from either driver. */
export function isUniqueViolation(error: unknown): boolean {
  let e: unknown = error;
  for (let i = 0; i < 4 && e; i++) {
    const code = (e as { code?: string }).code;
    if (code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
