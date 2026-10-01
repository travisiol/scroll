import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, type Tx } from "@/db/client";
import { payoutJobs, poolMovements, poolWeekUsage, rewardAllocations, rewardPools, submissions, users } from "@/db/schema";
import { AppError } from "@/core/errors";
import { computeAllocations, type PolicyConfig } from "@/core/policy";
import { isBaseUnits, toBig } from "@/core/units";
import type { HoldReason } from "@/core/status";
import { TICKERS, isTicker, type AppKey, type Ticker } from "@/config/apps";
import { getPolicy } from "./policies";
import { audit, newId } from "./util";

type AllocationRow = typeof rewardAllocations.$inferSelect;

/**
 * Reserve pool inventory for one allocation. Runs inside the caller's
 * transaction. Each step is a single conditional UPDATE, so two reviewers
 * approving at the same moment can't both take the last units: the second
 * UPDATE re-checks the row after the first commits and matches nothing.
 *
 * The allocation amount is never reduced to fit. If the pool can't cover it,
 * the allocation waits in `awaiting_funding` at its full amount.
 */
async function reserve(tx: Tx, a: AllocationRow, policy: PolicyConfig): Promise<HoldReason | null> {
  const rule = policy.tickers[a.ticker as Ticker];

  await tx.insert(poolWeekUsage).values({ ticker: a.ticker, weekStart: a.weekStart }).onConflictDoNothing();
  const week = await tx
    .update(poolWeekUsage)
    .set({ reserved: sql`${poolWeekUsage.reserved} + ${a.amount}::numeric` })
    .where(and(eq(poolWeekUsage.ticker, a.ticker), eq(poolWeekUsage.weekStart, a.weekStart), sql`${poolWeekUsage.reserved} + ${a.amount}::numeric <= ${rule.weeklyPoolLimit}::numeric`))
    .returning({ ticker: poolWeekUsage.ticker });
  if (week.length === 0) return "weekly_pool_limit";

  await tx.insert(rewardPools).values({ ticker: a.ticker }).onConflictDoNothing();
  const pool = await tx
    .update(rewardPools)
    .set({ reserved: sql`${rewardPools.reserved} + ${a.amount}::numeric`, updatedAt: new Date() })
    .where(and(eq(rewardPools.ticker, a.ticker), sql`${rewardPools.funded} - ${rewardPools.reserved} - ${rewardPools.paid} >= ${a.amount}::numeric`))
    .returning({ ticker: rewardPools.ticker });
  if (pool.length === 0) {
    await tx
      .update(poolWeekUsage)
      .set({ reserved: sql`${poolWeekUsage.reserved} - ${a.amount}::numeric` })
      .where(and(eq(poolWeekUsage.ticker, a.ticker), eq(poolWeekUsage.weekStart, a.weekStart)));
    return "pool_inventory";
  }

  await tx.insert(poolMovements).values({ id: newId("mov"), ticker: a.ticker, kind: "reserve", amount: a.amount, allocationId: a.id, actor: "system" });
  return null;
}

/** Queue every reserved-but-held allocation of this wallet and token once their total reaches the minimum payout. */
async function queueIfPayable(tx: Tx, userId: string, ticker: string, minPayout: string, now: Date): Promise<void> {
  const held = await tx
    .select()
    .from(rewardAllocations)
    .where(and(eq(rewardAllocations.userId, userId), eq(rewardAllocations.ticker, ticker), eq(rewardAllocations.state, "allocated"), eq(rewardAllocations.reserved, true)));
  const total = held.reduce((sum, h) => sum + toBig(h.amount), BigInt(0));
  if (held.length === 0 || total < toBig(minPayout)) return;
  for (const h of held) {
    await tx.insert(payoutJobs).values({ id: newId("job"), allocationId: h.id, state: "queued", nextRunAt: now }).onConflictDoNothing();
    await tx.update(rewardAllocations).set({ state: "queued", holdReason: null, updatedAt: now }).where(eq(rewardAllocations.id, h.id));
  }
}

async function reserveAndQueue(tx: Tx, a: AllocationRow, policy: PolicyConfig, now: Date): Promise<void> {
  const hold = await reserve(tx, a, policy);
  if (hold) {
    await tx.update(rewardAllocations).set({ state: "awaiting_funding", holdReason: hold, reserved: false, updatedAt: now }).where(eq(rewardAllocations.id, a.id));
    return;
  }
  await tx.update(rewardAllocations).set({ state: "allocated", holdReason: "below_minimum", reserved: true, updatedAt: now }).where(eq(rewardAllocations.id, a.id));
  await queueIfPayable(tx, a.userId, a.ticker, policy.tickers[a.ticker as Ticker].minPayout, now);
}

/**
 * Called inside the approval transaction. Uses the policy snapshotted on the
 * submission. Without one, nothing is allocated.
 */
export async function allocateForSubmission(tx: Tx, submission: typeof submissions.$inferSelect, usage: Partial<Record<AppKey, number>>, actor: string, now: Date): Promise<AllocationRow[]> {
  if (!submission.policyVersionId) return [];
  const policy = await getPolicy(submission.policyVersionId, tx);
  if (!policy) return [];
  const [owner] = await tx.select().from(users).where(eq(users.id, submission.userId)).limit(1);
  const created: AllocationRow[] = [];
  for (const line of computeAllocations(policy.config, usage)) {
    const token = policy.config.network.tokens[line.ticker];
    const [row] = await tx
      .insert(rewardAllocations)
      .values({
        id: newId("alc"),
        submissionId: submission.id,
        userId: submission.userId,
        recipient: owner.address,
        ticker: line.ticker,
        tokenAddress: token.address,
        chainId: policy.config.network.chainId,
        decimals: token.decimals,
        weekStart: submission.weekStart,
        eligibleMinutes: line.eligibleMinutes,
        amount: line.amount.toString(),
        policyVersionId: policy.id,
        state: "awaiting_funding",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await reserveAndQueue(tx, row, policy.config, now);
    const [after] = await tx.select().from(rewardAllocations).where(eq(rewardAllocations.id, row.id));
    await audit(tx, { actor, action: "allocation.created", entityType: "allocation", entityId: row.id, data: { ticker: line.ticker, amount: row.amount, eligibleMinutes: line.eligibleMinutes, cappedByWallet: line.cappedByWallet, state: after.state, holdReason: after.holdReason, policyVersion: policy.version } });
    created.push(after);
  }
  return created;
}

export interface PoolView {
  ticker: Ticker;
  funded: string;
  reserved: string;
  paid: string;
  available: string;
  awaitingFunding: string;
  awaitingCount: number;
}

export async function listPools(): Promise<PoolView[]> {
  const db = await getDb();
  const pools = await db.select().from(rewardPools);
  const waiting = await db
    .select({ ticker: rewardAllocations.ticker, total: sql<string>`coalesce(sum(${rewardAllocations.amount}), 0)::text`, count: sql<number>`count(*)::int` })
    .from(rewardAllocations)
    .where(eq(rewardAllocations.state, "awaiting_funding"))
    .groupBy(rewardAllocations.ticker);
  return TICKERS.map((ticker) => {
    const p = pools.find((x) => x.ticker === ticker);
    const w = waiting.find((x) => x.ticker === ticker);
    const funded = toBig(p?.funded ?? "0");
    const reserved = toBig(p?.reserved ?? "0");
    const paid = toBig(p?.paid ?? "0");
    return { ticker, funded: funded.toString(), reserved: reserved.toString(), paid: paid.toString(), available: (funded - reserved - paid).toString(), awaitingFunding: w?.total ?? "0", awaitingCount: w?.count ?? 0 };
  });
}

/** Record tokens added to the reward pool's ledger. This does not move tokens; it records that the treasury holds them. */
export async function fundPool(actor: string, input: { ticker: unknown; amount: unknown; note: unknown }, now = new Date()): Promise<void> {
  const { ticker, amount } = input;
  if (typeof ticker !== "string" || !isTicker(ticker)) throw new AppError(400, "Unknown token.");
  if (!isBaseUnits(amount) || toBig(amount) === BigInt(0)) throw new AppError(400, "Enter an amount above zero.");
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 300) : "";
  if (!note) throw new AppError(400, "Add a note: where this funding came from.");
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.insert(rewardPools).values({ ticker }).onConflictDoNothing();
    await tx.update(rewardPools).set({ funded: sql`${rewardPools.funded} + ${amount}::numeric`, updatedAt: now }).where(eq(rewardPools.ticker, ticker));
    await tx.insert(poolMovements).values({ id: newId("mov"), ticker, kind: "fund", amount, note, actor, createdAt: now });
    await audit(tx, { actor, action: "pool.funded", entityType: "pool", entityId: ticker, data: { amount, note } });
  });
  await retryAwaitingFunding(actor, ticker, now);
}

/** Try again, oldest first, to reserve inventory for allocations that are waiting. Each one is its own transaction. */
export async function retryAwaitingFunding(actor: string, ticker?: string, now = new Date()): Promise<{ reserved: number; stillWaiting: number }> {
  const db = await getDb();
  const waiting = await db
    .select({ id: rewardAllocations.id })
    .from(rewardAllocations)
    .where(and(eq(rewardAllocations.state, "awaiting_funding"), ticker ? eq(rewardAllocations.ticker, ticker) : inArray(rewardAllocations.ticker, [...TICKERS])))
    .orderBy(asc(rewardAllocations.createdAt));
  let reserved = 0;
  for (const w of waiting) {
    await db.transaction(async (tx) => {
      const [a] = await tx.select().from(rewardAllocations).where(and(eq(rewardAllocations.id, w.id), eq(rewardAllocations.state, "awaiting_funding"))).for("update");
      if (!a) return;
      const policy = await getPolicy(a.policyVersionId, tx);
      if (!policy) return;
      await reserveAndQueue(tx, a, policy.config, now);
      const [after] = await tx.select().from(rewardAllocations).where(eq(rewardAllocations.id, a.id));
      if (after.state !== "awaiting_funding") {
        reserved += 1;
        await audit(tx, { actor, action: "allocation.reserved", entityType: "allocation", entityId: a.id, data: { state: after.state } });
      }
    });
  }
  return { reserved, stillWaiting: waiting.length - reserved };
}

export async function poolMovementsFor(limit = 50) {
  const db = await getDb();
  return db.select().from(poolMovements).orderBy(sql`${poolMovements.createdAt} desc`).limit(limit);
}
