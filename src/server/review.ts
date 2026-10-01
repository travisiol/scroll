import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { evidence, reviewDecisions, submissions, users, verifiedUsage } from "@/db/schema";
import { AppError } from "@/core/errors";
import { MAX_WEEK_MINUTES } from "@/core/duration";
import { REVIEW_STATUSES, type ReviewStatus } from "@/core/status";
import { APP_KEYS, type AppKey } from "@/config/apps";
import { allocateForSubmission } from "./allocations";
import { audit, newId } from "./util";

/**
 * Review is manual. Nothing in this file reads a screenshot: a person does,
 * and enters what they verified. Every function takes the reviewer's address
 * from a server-verified admin session.
 */

export async function reviewQueue(status: ReviewStatus | "all" = "pending_review") {
  const db = await getDb();
  const rows = await db
    .select({
      submission: submissions,
      owner: users.address,
      files: sql<number>`(select count(*)::int from ${evidence} where ${evidence.submissionId} = ${submissions.id})`,
    })
    .from(submissions)
    .innerJoin(users, eq(users.id, submissions.userId))
    .where(status === "all" ? sql`${submissions.status} <> 'draft'` : eq(submissions.status, status))
    // Oldest first for work to do; newest first when browsing decided ones.
    .orderBy(status === "pending_review" ? asc(submissions.submittedAt) : desc(submissions.updatedAt))
    .limit(200);
  return rows;
}

export async function queueCounts(): Promise<Record<ReviewStatus, number>> {
  const db = await getDb();
  const rows = await db.select({ status: submissions.status, n: sql<number>`count(*)::int` }).from(submissions).groupBy(submissions.status);
  const out = Object.fromEntries(REVIEW_STATUSES.map((s) => [s, 0])) as Record<ReviewStatus, number>;
  for (const r of rows) out[r.status as ReviewStatus] = r.n;
  return out;
}

function parseUsage(input: unknown): Record<AppKey, number> {
  if (typeof input !== "object" || input === null) throw new AppError(400, "Invalid durations.");
  const out = {} as Record<AppKey, number>;
  for (const app of APP_KEYS) {
    const value = (input as Record<string, unknown>)[app] ?? 0;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_WEEK_MINUTES) {
      throw new AppError(400, `Invalid duration for ${app}.`);
    }
    out[app] = value;
  }
  const total = Object.values(out).reduce((a, b) => a + b, 0);
  if (total > MAX_WEEK_MINUTES) throw new AppError(400, "Those durations add up to more than a week.");
  return out;
}

async function currentUsage(db: Parameters<typeof audit>[0], submissionId: string): Promise<Record<string, number>> {
  const rows = await db.select().from(verifiedUsage).where(eq(verifiedUsage.submissionId, submissionId));
  return Object.fromEntries(rows.map((r) => [r.app, r.minutes]));
}

/** Save the durations the reviewer verified. One value per app for the whole submission, whatever the number of screenshots. */
export async function setVerifiedUsage(reviewer: string, submissionId: string, input: unknown, now = new Date()): Promise<Record<string, number>> {
  const usage = parseUsage(input);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [sub] = await tx.select().from(submissions).where(eq(submissions.id, submissionId)).for("update");
    if (!sub) throw new AppError(404, "Submission not found.");
    if (sub.status !== "pending_review") throw new AppError(409, "Durations can only be edited while a submission is pending review.");
    const before = await currentUsage(tx, submissionId);
    await tx.delete(verifiedUsage).where(eq(verifiedUsage.submissionId, submissionId));
    const rows = APP_KEYS.filter((app) => usage[app] > 0).map((app) => ({ submissionId, app, minutes: usage[app], updatedBy: reviewer, updatedAt: now }));
    if (rows.length) await tx.insert(verifiedUsage).values(rows);
    const after = Object.fromEntries(rows.map((r) => [r.app, r.minutes]));
    await audit(tx, { actor: reviewer, action: "review.durations_changed", entityType: "submission", entityId: submissionId, data: { before, after } });
    return after;
  });
}

export type ReviewAction = "approve" | "reject" | "request_changes";

const NEXT_STATUS: Record<ReviewAction, ReviewStatus> = { approve: "approved", reject: "rejected", request_changes: "needs_changes" };

export async function decide(reviewer: string, submissionId: string, input: { action: unknown; reason: unknown }, now = new Date()) {
  const action = input.action as ReviewAction;
  if (!(action in NEXT_STATUS)) throw new AppError(400, "Unknown review action.");
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 1000) : "";
  if (action !== "approve" && reason.length < 3) throw new AppError(400, "A reason is required. The user will see it.");

  const db = await getDb();
  return db.transaction(async (tx) => {
    // Whoever flips the status wins; a second reviewer's decision matches no row.
    const final = action !== "request_changes";
    const [sub] = await tx
      .update(submissions)
      .set({ status: NEXT_STATUS[action], reviewerNote: reason || null, decidedAt: final ? now : null, updatedAt: now })
      .where(and(eq(submissions.id, submissionId), eq(submissions.status, "pending_review")))
      .returning();
    if (!sub) {
      const [exists] = await tx.select({ id: submissions.id }).from(submissions).where(eq(submissions.id, submissionId));
      throw exists ? new AppError(409, "This submission is no longer pending review. Someone may have decided it already.") : new AppError(404, "Submission not found.");
    }

    const usage = await currentUsage(tx, submissionId);
    if (action === "approve" && Object.values(usage).every((m) => m === 0)) {
      throw new AppError(400, "Enter and save at least one verified duration before approving.");
    }

    await tx.insert(reviewDecisions).values({ id: newId("dec"), submissionId, reviewer, action, reason: reason || null, revision: sub.revision, usage, createdAt: now });
    await audit(tx, { actor: reviewer, action: `review.${action}`, entityType: "submission", entityId: submissionId, data: { reason: reason || null, revision: sub.revision, usage } });

    const allocations = action === "approve" ? await allocateForSubmission(tx, sub, usage as Partial<Record<AppKey, number>>, reviewer, now) : [];
    return { submission: sub, allocations };
  });
}

/** Other submissions from the same wallet, so the reviewer can spot overlapping periods. */
export async function neighbouringSubmissions(userId: string, exceptId: string) {
  const db = await getDb();
  return db
    .select({ id: submissions.id, weekStart: submissions.weekStart, status: submissions.status })
    .from(submissions)
    .where(and(eq(submissions.userId, userId), sql`${submissions.id} <> ${exceptId}`))
    .orderBy(desc(submissions.weekStart))
    .limit(8);
}
