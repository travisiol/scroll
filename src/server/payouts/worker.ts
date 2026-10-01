import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, type Tx } from "@/db/client";
import { payoutAttempts, payoutJobs, poolMovements, rewardAllocations, rewardPools } from "@/db/schema";
import { AppError } from "@/core/errors";
import { getSettings } from "../settings";
import { audit, newId } from "../util";
import { PayoutSetupError, type AdapterAvailability, type PayoutAdapter, type PreparedTransfer, type TransferRequest } from "./adapter";
import { createEvmAdapter, treasuryKey } from "./evm";

/**
 * The payout worker. Jobs live in Postgres, so they survive restarts.
 * `tick()` is called by `npm run worker`, by a cron hitting
 * /api/cron/payouts, or by an admin pressing "Run payouts now".
 *
 * Why a retry can't pay twice:
 *  1. A transfer is signed first and its hash is stored (state `signed`)
 *     before a single byte reaches the network.
 *  2. A job with an unresolved attempt (`signed` or `broadcast`) never gets a
 *     new one. It is reconciled: looked up by hash, and at most the same
 *     signed bytes are sent again. A unique index enforces "one open attempt".
 *  3. A new attempt is only possible after the previous one provably can't
 *     land: it reverted on chain, or its nonce was used by something else.
 *  4. An allocation is marked paid only by a confirmed receipt, in one
 *     transaction that also moves the pool from reserved to paid.
 */

const LOCK_MS = 2 * 60 * 1000;
const POLL_MS = 15 * 1000;
const NONCE_LOCK = 742_001;

type Job = typeof payoutJobs.$inferSelect;
type Attempt = typeof payoutAttempts.$inferSelect;

/** The app only ever uses the real adapter. Without a treasury key there is none. */
export function payoutAdapter(): AdapterAvailability {
  const key = treasuryKey();
  if (!key) {
    return { adapter: null, missing: [process.env.TREASURY_PRIVATE_KEY ? "TREASURY_PRIVATE_KEY is set but is not a 32-byte hex key." : "TREASURY_PRIVATE_KEY is not set (the wallet that holds the reward tokens)."] };
  }
  return { adapter: createEvmAdapter(key), missing: [] };
}

export interface TickResult {
  ran: boolean;
  reason?: string;
  processed: number;
  confirmed: number;
  submitted: number;
  failed: number;
  waiting: number;
}

async function claim(now: Date): Promise<Job | null> {
  const db = await getDb();
  const lockedUntil = new Date(now.getTime() + LOCK_MS).toISOString();
  const at = now.toISOString();
  const rows = await db.execute(sql`
    update payout_jobs set locked_until = ${lockedUntil}::timestamptz, runs = runs + 1, updated_at = ${at}::timestamptz
    where id = (
      select id from payout_jobs
      where state in ('queued', 'submitted') and next_run_at <= ${at}::timestamptz and (locked_until is null or locked_until < ${at}::timestamptz)
      order by created_at asc
      limit 1
      for update skip locked
    )
    returning id`);
  const id = (rows.rows[0] as { id?: string } | undefined)?.id;
  if (!id) return null;
  const [job] = await db.select().from(payoutJobs).where(eq(payoutJobs.id, id));
  return job ?? null;
}

async function release(jobId: string, patch: Partial<Job>, now: Date): Promise<void> {
  const db = await getDb();
  await db.update(payoutJobs).set({ lockedUntil: null, updatedAt: now, ...patch }).where(eq(payoutJobs.id, jobId));
}

function asPrepared(a: Attempt): PreparedTransfer {
  return { sender: a.sender, nonce: a.nonce, txHash: a.txHash, rawTx: a.rawTx };
}

async function finalizeConfirmed(tx: Tx, job: Job, attempt: Attempt, blockNumber: number, now: Date): Promise<boolean> {
  // Only the first caller to flip the attempt moves the money in the ledger.
  const flipped = await tx
    .update(payoutAttempts)
    .set({ state: "confirmed", blockNumber, updatedAt: now })
    .where(and(eq(payoutAttempts.id, attempt.id), inArray(payoutAttempts.state, ["signed", "broadcast"])))
    .returning({ id: payoutAttempts.id });
  if (flipped.length !== 1) return false;
  const [a] = await tx.select().from(rewardAllocations).where(eq(rewardAllocations.id, job.allocationId));
  await tx.update(rewardAllocations).set({ state: "confirmed", holdReason: null, updatedAt: now }).where(eq(rewardAllocations.id, a.id));
  await tx
    .update(rewardPools)
    .set({ reserved: sql`${rewardPools.reserved} - ${a.amount}::numeric`, paid: sql`${rewardPools.paid} + ${a.amount}::numeric`, updatedAt: now })
    .where(eq(rewardPools.ticker, a.ticker));
  await tx.insert(poolMovements).values({ id: newId("mov"), ticker: a.ticker, kind: "pay", amount: a.amount, allocationId: a.id, note: attempt.txHash, actor: "system", createdAt: now });
  await tx.update(payoutJobs).set({ state: "confirmed", lockedUntil: null, lastError: null, updatedAt: now }).where(eq(payoutJobs.id, job.id));
  await audit(tx, { actor: "system", action: "payout.confirmed", entityType: "allocation", entityId: a.id, data: { txHash: attempt.txHash, blockNumber, adapter: attempt.adapter, amount: a.amount, ticker: a.ticker } });
  return true;
}

async function failJob(job: Job, attempt: Attempt, attemptState: "reverted" | "dropped", reason: string, now: Date): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(payoutAttempts).set({ state: attemptState, error: reason, updatedAt: now }).where(eq(payoutAttempts.id, attempt.id));
    await tx.update(payoutJobs).set({ state: "failed", lockedUntil: null, lastError: reason, updatedAt: now }).where(eq(payoutJobs.id, job.id));
    // The reservation is kept: the allocation is still owed.
    await tx.update(rewardAllocations).set({ state: "failed", updatedAt: now }).where(eq(rewardAllocations.id, job.allocationId));
    await audit(tx, { actor: "system", action: "payout.failed", entityType: "allocation", entityId: job.allocationId, data: { txHash: attempt.txHash, attemptState, reason } });
  });
}

async function markSubmitted(job: Job, attempt: Attempt, now: Date): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(payoutAttempts).set({ state: "broadcast", error: null, updatedAt: now }).where(and(eq(payoutAttempts.id, attempt.id), inArray(payoutAttempts.state, ["signed", "broadcast"])));
    await tx.update(payoutJobs).set({ state: "submitted", lockedUntil: null, lastError: null, nextRunAt: new Date(now.getTime() + POLL_MS), updatedAt: now }).where(eq(payoutJobs.id, job.id));
    await tx.update(rewardAllocations).set({ state: "submitted", updatedAt: now }).where(and(eq(rewardAllocations.id, job.allocationId), inArray(rewardAllocations.state, ["queued", "submitted"])));
    if (attempt.state === "signed") {
      await audit(tx, { actor: "system", action: "payout.submitted", entityType: "allocation", entityId: job.allocationId, data: { txHash: attempt.txHash, adapter: attempt.adapter } });
    }
  });
}

type Outcome = "confirmed" | "submitted" | "failed" | "waiting";

async function processJob(adapter: PayoutAdapter, job: Job, now: Date): Promise<Outcome> {
  const db = await getDb();
  const [a] = await db.select().from(rewardAllocations).where(eq(rewardAllocations.id, job.allocationId));
  const request: TransferRequest = { chainId: a.chainId, token: a.tokenAddress, to: a.recipient, amount: BigInt(a.amount), ticker: a.ticker };

  const [open] = await db.select().from(payoutAttempts).where(and(eq(payoutAttempts.jobId, job.id), inArray(payoutAttempts.state, ["signed", "broadcast"])));

  if (open) {
    // Reconcile first. A new transfer is never created while one is unresolved.
    const result = await adapter.check(asPrepared(open), request);
    if (result.status === "confirmed") {
      await db.transaction((tx) => finalizeConfirmed(tx, job, open, result.blockNumber, now));
      return "confirmed";
    }
    if (result.status === "pending") {
      await markSubmitted(job, open, now);
      return "submitted";
    }
    if (result.status === "reverted") {
      await failJob(job, open, "reverted", result.reason, now);
      return "failed";
    }
    if (result.status === "nonce_consumed") {
      await failJob(job, open, "dropped", "The network never saw this transfer and its nonce was used by another transaction. Inspect the treasury wallet, then retry.", now);
      return "failed";
    }
    // Missing and the nonce is free: send the same signed bytes again.
    await adapter.broadcast(asPrepared(open));
    await markSubmitted(job, open, now);
    return "submitted";
  }

  // No open attempt. Sign, store, then send.
  let attempt: Attempt;
  try {
    attempt = await db.transaction(async (tx) => {
      // One signer at a time, so two workers can't hand out the same nonce.
      await tx.execute(sql`select pg_advisory_xact_lock(${NONCE_LOCK})`);
      const [last] = await tx
        .select({ nonce: payoutAttempts.nonce })
        .from(payoutAttempts)
        .where(and(eq(payoutAttempts.sender, adapter.sender()), inArray(payoutAttempts.state, ["signed", "broadcast"])))
        .orderBy(desc(payoutAttempts.nonce))
        .limit(1);
      const prepared = await adapter.prepare(request, last ? last.nonce + 1 : 0);
      const [row] = await tx
        .insert(payoutAttempts)
        .values({ id: newId("att"), jobId: job.id, adapter: adapter.name, sender: prepared.sender, nonce: prepared.nonce, txHash: prepared.txHash, rawTx: prepared.rawTx, state: "signed", createdAt: now, updatedAt: now })
        .returning();
      return row;
    });
  } catch (error) {
    if (error instanceof PayoutSetupError) {
      await release(job.id, { lastError: error.message, nextRunAt: new Date(now.getTime() + 4 * POLL_MS) }, now);
      return "waiting";
    }
    throw error;
  }

  // The hash is on disk. From here on, any crash is recovered by the reconcile branch above.
  await adapter.broadcast(asPrepared(attempt));
  await markSubmitted(job, attempt, now);
  return "submitted";
}

export interface TickOptions {
  adapter?: PayoutAdapter;
  limit?: number;
  now?: Date;
  /** Tests drive the worker without the admin switch. */
  ignoreSwitch?: boolean;
}

export async function tick(options: TickOptions = {}): Promise<TickResult> {
  const result: TickResult = { ran: false, processed: 0, confirmed: 0, submitted: 0, failed: 0, waiting: 0 };
  if (!options.ignoreSwitch && !(await getSettings()).payoutsEnabled) return { ...result, reason: "Payouts are switched off." };
  let adapter = options.adapter;
  if (!adapter) {
    const available = payoutAdapter();
    if (!available.adapter) return { ...result, reason: available.missing.join(" ") };
    adapter = available.adapter;
  }
  result.ran = true;
  const limit = options.limit ?? 20;
  for (let i = 0; i < limit; i++) {
    const now = options.now ?? new Date();
    const job = await claim(now);
    if (!job) break;
    result.processed += 1;
    try {
      const outcome = await processJob(adapter, job, now);
      result[outcome] += 1;
    } catch (error) {
      // Unknown failure (RPC down, crash mid-broadcast). Leave everything as stored; the next tick reconciles by hash.
      const message = error instanceof Error ? error.message.slice(0, 300) : "unknown error";
      await release(job.id, { lastError: message, nextRunAt: new Date(now.getTime() + 2 * POLL_MS) }, now);
      result.waiting += 1;
    }
  }
  return result;
}

/** Admin retry of a failed job. Possible only when no transfer is unresolved. */
export async function retryFailedJob(actor: string, jobId: string, now = new Date()): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [job] = await tx.select().from(payoutJobs).where(eq(payoutJobs.id, jobId)).for("update");
    if (!job) throw new AppError(404, "Payout job not found.");
    if (job.state !== "failed") throw new AppError(409, "Only a failed payout can be retried.");
    const open = await tx.select({ id: payoutAttempts.id }).from(payoutAttempts).where(and(eq(payoutAttempts.jobId, jobId), inArray(payoutAttempts.state, ["signed", "broadcast"])));
    const paid = await tx.select({ id: payoutAttempts.id }).from(payoutAttempts).where(and(eq(payoutAttempts.jobId, jobId), eq(payoutAttempts.state, "confirmed")));
    if (open.length || paid.length) throw new AppError(409, "This payout still has a transfer that may land. It can't be retried.");
    await tx.update(payoutJobs).set({ state: "queued", lockedUntil: null, nextRunAt: now, updatedAt: now }).where(eq(payoutJobs.id, jobId));
    await tx.update(rewardAllocations).set({ state: "queued", updatedAt: now }).where(eq(rewardAllocations.id, job.allocationId));
    await audit(tx, { actor, action: "payout.retry_requested", entityType: "allocation", entityId: job.allocationId, data: { jobId, previousError: job.lastError } });
  });
}

export async function listPayoutJobs(states?: string[]) {
  const db = await getDb();
  const rows = await db
    .select({ job: payoutJobs, allocation: rewardAllocations })
    .from(payoutJobs)
    .innerJoin(rewardAllocations, eq(rewardAllocations.id, payoutJobs.allocationId))
    .where(states?.length ? inArray(payoutJobs.state, states) : sql`true`)
    .orderBy(desc(payoutJobs.updatedAt))
    .limit(200);
  if (!rows.length) return [];
  const attempts = await db.select().from(payoutAttempts).where(inArray(payoutAttempts.jobId, rows.map((r) => r.job.id))).orderBy(asc(payoutAttempts.createdAt));
  return rows.map((r) => ({ ...r, attempts: attempts.filter((x) => x.jobId === r.job.id) }));
}
