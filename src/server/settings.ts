import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { settings } from "@/db/schema";
import { audit } from "./util";

export interface AppSettings {
  /** The admin switch for sending transfers. Off until someone turns it on. */
  payoutsEnabled: boolean;
}

const DEFAULTS: AppSettings = { payoutsEnabled: false };

export async function getSettings(): Promise<AppSettings> {
  const db = await getDb();
  const [row] = await db.select().from(settings).where(eq(settings.key, "app")).limit(1);
  return { ...DEFAULTS, ...((row?.value as Partial<AppSettings>) ?? {}) };
}

export async function updateSettings(actor: string, patch: Partial<AppSettings>, now = new Date()): Promise<AppSettings> {
  const before = await getSettings();
  const after: AppSettings = { payoutsEnabled: typeof patch.payoutsEnabled === "boolean" ? patch.payoutsEnabled : before.payoutsEnabled };
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.insert(settings).values({ key: "app", value: after, updatedAt: now }).onConflictDoUpdate({ target: settings.key, set: { value: after, updatedAt: now } });
    await audit(tx, { actor, action: "settings.updated", entityType: "settings", entityId: "app", data: { before, after } });
  });
  return after;
}
