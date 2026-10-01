import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db/client";
import { policyVersions } from "@/db/schema";
import { AppError } from "@/core/errors";
import { PolicyError, validatePolicy, type PolicyConfig } from "@/core/policy";
import { APP_KEYS, TICKERS, type AppKey, type Ticker } from "@/config/apps";
import { CHAIN, TOKENS } from "@/config/network";
import { audit, newId } from "./util";

export interface PolicyVersion {
  id: string;
  version: number;
  status: "draft" | "published" | "retired";
  config: PolicyConfig;
  createdBy: string;
  createdAt: Date;
  publishedAt: Date | null;
}

function row(r: typeof policyVersions.$inferSelect): PolicyVersion {
  return { id: r.id, version: r.version, status: r.status as PolicyVersion["status"], config: r.config as PolicyConfig, createdBy: r.createdBy, createdAt: r.createdAt, publishedAt: r.publishedAt };
}

/** The token/network block every policy carries: the verified configuration, nothing typed by hand. */
export function networkSnapshot(): PolicyConfig["network"] {
  const tokens = {} as PolicyConfig["network"]["tokens"];
  for (const t of TICKERS) tokens[t] = { address: TOKENS[t].address, decimals: TOKENS[t].decimals };
  return { chainId: CHAIN.id, tokens };
}

/** An empty starting point for the editor. Every rate is zero and every token is off: the numbers are a business decision. */
export function blankPolicy(): PolicyConfig {
  const tickers = {} as Record<Ticker, PolicyConfig["tickers"][Ticker]>;
  for (const t of TICKERS) tickers[t] = { enabled: false, unitsPerMinute: "0", walletWeeklyCap: "0", weeklyPoolLimit: "0", minPayout: "0" };
  const apps = {} as Record<AppKey, { maxMinutesPerWeek: number }>;
  for (const a of APP_KEYS) apps[a] = { maxMinutesPerWeek: 0 };
  return { label: "", tickers, apps, network: networkSnapshot() };
}

function parse(input: unknown): PolicyConfig {
  try {
    // The network block always comes from server configuration, never from the form.
    return validatePolicy({ ...(input as object), network: networkSnapshot() });
  } catch (error) {
    if (error instanceof PolicyError) throw new AppError(400, error.issues.join(" "));
    throw error;
  }
}

export async function listPolicies(): Promise<PolicyVersion[]> {
  const db = await getDb();
  return (await db.select().from(policyVersions).orderBy(desc(policyVersions.version))).map(row);
}

export async function getPolicy(id: string, db?: DbOrTx): Promise<PolicyVersion | null> {
  const d = db ?? (await getDb());
  const [r] = await d.select().from(policyVersions).where(eq(policyVersions.id, id)).limit(1);
  return r ? row(r) : null;
}

/** The single published policy, or null. Without one, nothing is allocated. */
export async function publishedPolicy(db?: DbOrTx): Promise<PolicyVersion | null> {
  const d = db ?? (await getDb());
  const [r] = await d.select().from(policyVersions).where(eq(policyVersions.status, "published")).limit(1);
  return r ? row(r) : null;
}

export async function createPolicyDraft(actor: string, input: unknown): Promise<PolicyVersion> {
  const config = parse(input);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${policyVersions.version}), 0) + 1` }).from(policyVersions);
    const [created] = await tx
      .insert(policyVersions)
      .values({ id: newId("pol"), version: Number(next), status: "draft", config, createdBy: actor })
      .returning();
    await audit(tx, { actor, action: "policy.draft_created", entityType: "policy", entityId: created.id, data: { version: created.version, config } });
    return row(created);
  });
}

export async function updatePolicyDraft(actor: string, id: string, input: unknown): Promise<PolicyVersion> {
  const config = parse(input);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const before = await getPolicy(id, tx);
    if (!before) throw new AppError(404, "Policy not found.");
    // Only drafts can change. A published policy is what submissions were promised.
    const [updated] = await tx
      .update(policyVersions)
      .set({ config })
      .where(and(eq(policyVersions.id, id), eq(policyVersions.status, "draft")))
      .returning();
    if (!updated) throw new AppError(409, "Only a draft can be edited. Create a new version instead.");
    await audit(tx, { actor, action: "policy.draft_updated", entityType: "policy", entityId: id, data: { before: before.config, after: config } });
    return row(updated);
  });
}

export async function publishPolicy(actor: string, id: string, now = new Date()): Promise<PolicyVersion> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const draft = await getPolicy(id, tx);
    if (!draft) throw new AppError(404, "Policy not found.");
    if (draft.status !== "draft") throw new AppError(409, "This version is already published or retired.");
    const enabled = TICKERS.filter((t) => draft.config.tickers[t].enabled);
    if (enabled.length === 0) throw new AppError(400, "Enable at least one token before publishing.");
    const retired = await tx
      .update(policyVersions)
      .set({ status: "retired", retiredAt: now })
      .where(eq(policyVersions.status, "published"))
      .returning({ id: policyVersions.id });
    const [published] = await tx
      .update(policyVersions)
      .set({ status: "published", publishedAt: now })
      .where(and(eq(policyVersions.id, id), eq(policyVersions.status, "draft")))
      .returning();
    if (!published) throw new AppError(409, "This version is already published or retired.");
    await audit(tx, { actor, action: "policy.published", entityType: "policy", entityId: id, data: { version: published.version, retired: retired.map((r) => r.id) } });
    return row(published);
  });
}
