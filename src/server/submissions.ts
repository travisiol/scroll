import "server-only";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { evidence, payoutAttempts, payoutJobs, reviewDecisions, rewardAllocations, submissions, users, verifiedUsage } from "@/db/schema";
import { AppError } from "@/core/errors";
import { sniffImage } from "@/core/image";
import { isSelectableWeek } from "@/core/weeks";
import type { AllocationState, HoldReason, ReviewStatus } from "@/core/status";
import { PLATFORMS, type Platform } from "@/config/apps";
import { ACCEPTED_MIME, UPLOADS, formatBytes } from "@/config/uploads";
import { sha256Hex } from "./env";
import { publishedPolicy } from "./policies";
import { storage } from "./storage";
import { audit, isUniqueViolation, newId } from "./util";

type SubmissionRow = typeof submissions.$inferSelect;

const EDITABLE: ReviewStatus[] = ["draft", "needs_changes"];

export interface EvidenceView {
  id: string;
  kind: "primary" | "supplementary";
  mime: string;
  bytes: number;
  width: number;
  height: number;
  createdAt: Date;
  fileDeleted: boolean;
}

export interface AllocationView {
  id: string;
  ticker: string;
  amount: string;
  decimals: number;
  eligibleMinutes: number;
  state: AllocationState;
  holdReason: HoldReason | null;
  weekStart: string;
  submissionId: string;
  createdAt: Date;
  updatedAt: Date;
  tx: { hash: string; state: string } | null;
}

export interface SubmissionDetail {
  submission: SubmissionRow;
  owner: string;
  evidence: EvidenceView[];
  usage: { app: string; minutes: number }[];
  decisions: { id: string; action: string; reason: string | null; revision: number; createdAt: Date; reviewer: string }[];
  allocations: AllocationView[];
}

async function owned(userId: string, id: string): Promise<SubmissionRow> {
  const db = await getDb();
  const [row] = await db.select().from(submissions).where(and(eq(submissions.id, id), eq(submissions.userId, userId))).limit(1);
  // Someone else's submission looks exactly like one that doesn't exist.
  if (!row) throw new AppError(404, "Submission not found.");
  return row;
}

export async function listSubmissions(userId: string): Promise<SubmissionRow[]> {
  const db = await getDb();
  return db.select().from(submissions).where(eq(submissions.userId, userId)).orderBy(desc(submissions.weekStart));
}

export async function createDraft(user: { userId: string; address: string }, input: { platform: unknown; weekStart: unknown }, now = new Date()): Promise<SubmissionRow> {
  const platform = input.platform as Platform;
  if (typeof platform !== "string" || !(platform in PLATFORMS)) throw new AppError(400, "Choose iOS Screen Time or Android Digital Wellbeing.");
  const weekStart = input.weekStart;
  if (typeof weekStart !== "string" || !isSelectableWeek(weekStart, now, UPLOADS.weeksBack)) {
    throw new AppError(400, "Choose one of the listed reporting weeks.");
  }
  const db = await getDb();
  const [existing] = await db.select().from(submissions).where(and(eq(submissions.userId, user.userId), eq(submissions.weekStart, weekStart))).limit(1);
  if (existing) {
    if (existing.status === "draft") {
      const [updated] = await db.update(submissions).set({ platform, updatedAt: now }).where(and(eq(submissions.id, existing.id), eq(submissions.status, "draft"))).returning();
      if (updated) return updated;
    }
    throw new AppError(409, "You already have a submission for that week.", `existing:${existing.id}`);
  }
  try {
    const [created] = await db
      .insert(submissions)
      .values({ id: newId("sub"), userId: user.userId, platform, weekStart, status: "draft", createdAt: now, updatedAt: now })
      .returning();
    return created;
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError(409, "You already have a submission for that week.");
    throw error;
  }
}

export async function addEvidence(user: { userId: string; address: string }, submissionId: string, bytes: Uint8Array, now = new Date()): Promise<{ evidence: EvidenceView; duplicate: boolean }> {
  const sub = await owned(user.userId, submissionId);
  if (!EDITABLE.includes(sub.status as ReviewStatus)) throw new AppError(409, "This submission can't be changed while it is in review or decided.");

  if (bytes.length === 0) throw new AppError(400, "That file is empty.");
  if (bytes.length > UPLOADS.maxBytes) throw new AppError(413, `Screenshots can be up to ${formatBytes(UPLOADS.maxBytes)}.`);
  const image = sniffImage(bytes);
  if (!image) throw new AppError(415, "That file isn't a PNG, JPEG or WebP image.");
  if (image.width < UPLOADS.minWidth || image.height < UPLOADS.minHeight) {
    throw new AppError(422, `That image is too small to read (minimum ${UPLOADS.minWidth}×${UPLOADS.minHeight}).`);
  }
  if (image.width > UPLOADS.maxWidth || image.height > UPLOADS.maxHeight) {
    throw new AppError(422, `That image is too large (maximum ${UPLOADS.maxWidth}×${UPLOADS.maxHeight}).`);
  }

  const db = await getDb();
  const hash = sha256Hex(bytes);
  const [same] = await db.select().from(evidence).where(eq(evidence.sha256, hash)).limit(1);
  if (same) {
    if (same.submissionId === submissionId) return { evidence: view(same), duplicate: true };
    throw new AppError(409, "This exact file has already been submitted. The same screenshot can't be used twice.", "duplicate_file");
  }

  const current = await db.select({ id: evidence.id }).from(evidence).where(eq(evidence.submissionId, submissionId));
  if (current.length >= UPLOADS.maxFilesPerSubmission) {
    throw new AppError(409, `A submission can hold up to ${UPLOADS.maxFilesPerSubmission} screenshots. Remove one first.`);
  }

  const id = newId("ev");
  const key = `${id}.${ACCEPTED_MIME[image.mime].ext}`;
  await storage().put(key, bytes);
  try {
    const [created] = await db
      .insert(evidence)
      .values({ id, submissionId, kind: current.length === 0 ? "primary" : "supplementary", storageKey: key, sha256: hash, mime: image.mime, bytes: bytes.length, width: image.width, height: image.height, createdAt: now })
      .returning();
    await db.update(submissions).set({ updatedAt: now }).where(eq(submissions.id, submissionId));
    return { evidence: view(created), duplicate: false };
  } catch (error) {
    await storage().remove(key);
    if (isUniqueViolation(error)) throw new AppError(409, "This exact file has already been submitted. The same screenshot can't be used twice.", "duplicate_file");
    throw error;
  }
}

export async function removeEvidence(user: { userId: string }, submissionId: string, evidenceId: string): Promise<void> {
  const sub = await owned(user.userId, submissionId);
  if (!EDITABLE.includes(sub.status as ReviewStatus)) throw new AppError(409, "This submission can't be changed while it is in review or decided.");
  const db = await getDb();
  const [removed] = await db.delete(evidence).where(and(eq(evidence.id, evidenceId), eq(evidence.submissionId, submissionId))).returning();
  if (!removed) throw new AppError(404, "Screenshot not found.");
  await storage().remove(removed.storageKey);
  // Keep exactly one primary screenshot.
  const rest = await db.select().from(evidence).where(eq(evidence.submissionId, submissionId)).orderBy(asc(evidence.createdAt));
  if (rest.length && !rest.some((e) => e.kind === "primary")) {
    await db.update(evidence).set({ kind: "primary" }).where(eq(evidence.id, rest[0].id));
  }
}

export async function submitForReview(user: { userId: string; address: string }, submissionId: string, input: { confirmed: unknown }, now = new Date()): Promise<SubmissionRow> {
  const sub = await owned(user.userId, submissionId);
  if (input.confirmed !== true) throw new AppError(400, "Confirm that app names, durations and the reporting period are readable.");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const files = await tx.select({ id: evidence.id }).from(evidence).where(and(eq(evidence.submissionId, submissionId), isNull(evidence.fileDeletedAt)));
    if (files.length === 0) throw new AppError(400, "Add at least one screenshot first.");
    // Snapshot the policy in force now. A later policy edit can't change this submission.
    const policy = sub.policyVersionId ? null : await publishedPolicy(tx);
    const [updated] = await tx
      .update(submissions)
      .set({
        status: "pending_review",
        revision: sql`${submissions.revision} + 1`,
        userConfirmed: true,
        submittedAt: now,
        updatedAt: now,
        policyVersionId: sub.policyVersionId ?? policy?.id ?? null,
      })
      .where(and(eq(submissions.id, submissionId), inArray(submissions.status, EDITABLE)))
      .returning();
    if (!updated) throw new AppError(409, "This submission was already sent for review.");
    await audit(tx, { actor: user.address, action: "submission.submitted", entityType: "submission", entityId: submissionId, data: { revision: updated.revision, policyVersionId: updated.policyVersionId, files: files.length } });
    return updated;
  });
}

export async function deleteDraft(user: { userId: string }, submissionId: string): Promise<void> {
  const sub = await owned(user.userId, submissionId);
  if (sub.status !== "draft") throw new AppError(409, "Only a draft can be deleted.");
  const db = await getDb();
  const files = await db.select().from(evidence).where(eq(evidence.submissionId, submissionId));
  const deleted = await db.delete(submissions).where(and(eq(submissions.id, submissionId), eq(submissions.status, "draft"))).returning({ id: submissions.id });
  if (!deleted.length) throw new AppError(409, "Only a draft can be deleted.");
  for (const f of files) await storage().remove(f.storageKey);
}

/** Delete the screenshot files of a decided submission. The decision and fingerprints stay. */
export async function deleteEvidenceFiles(user: { userId: string; address: string }, submissionId: string, now = new Date()): Promise<number> {
  const sub = await owned(user.userId, submissionId);
  if (sub.status !== "approved" && sub.status !== "rejected") {
    throw new AppError(409, "Files can be deleted once a submission is decided. Drafts can be deleted entirely.");
  }
  return purgeFiles([submissionId], user.address, "evidence.deleted_by_user", now);
}

async function purgeFiles(submissionIds: string[], actor: string, action: string, now: Date): Promise<number> {
  if (!submissionIds.length) return 0;
  const db = await getDb();
  const rows = await db.select().from(evidence).where(and(inArray(evidence.submissionId, submissionIds), isNull(evidence.fileDeletedAt)));
  for (const r of rows) {
    await storage().remove(r.storageKey);
    await db.update(evidence).set({ fileDeletedAt: now }).where(eq(evidence.id, r.id));
  }
  for (const id of new Set(rows.map((r) => r.submissionId))) {
    await audit(db, { actor, action, entityType: "submission", entityId: id, data: { files: rows.filter((r) => r.submissionId === id).length } });
  }
  return rows.length;
}

/** Retention: remove screenshot files of submissions decided more than `retentionDays` ago. */
export async function purgeExpiredEvidence(now = new Date()): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(now.getTime() - UPLOADS.retentionDays * 24 * 60 * 60 * 1000);
  const due = await db
    .selectDistinct({ id: submissions.id })
    .from(submissions)
    .innerJoin(evidence, eq(evidence.submissionId, submissions.id))
    .where(and(inArray(submissions.status, ["approved", "rejected"]), lt(submissions.decidedAt, cutoff), isNull(evidence.fileDeletedAt)));
  return purgeFiles(due.map((d) => d.id), "system", "evidence.retention_purge", now);
}

function view(e: typeof evidence.$inferSelect): EvidenceView {
  return { id: e.id, kind: e.kind as EvidenceView["kind"], mime: e.mime, bytes: e.bytes, width: e.width, height: e.height, createdAt: e.createdAt, fileDeleted: e.fileDeletedAt !== null };
}

export async function allocationViews(where: ReturnType<typeof eq>): Promise<AllocationView[]> {
  const db = await getDb();
  const rows = await db.select().from(rewardAllocations).where(where).orderBy(desc(rewardAllocations.createdAt));
  if (!rows.length) return [];
  const attempts = await db
    .select({ allocationId: payoutJobs.allocationId, hash: payoutAttempts.txHash, state: payoutAttempts.state, createdAt: payoutAttempts.createdAt })
    .from(payoutAttempts)
    .innerJoin(payoutJobs, eq(payoutJobs.id, payoutAttempts.jobId))
    .where(inArray(payoutJobs.allocationId, rows.map((r) => r.id)))
    .orderBy(asc(payoutAttempts.createdAt));
  const latest = new Map<string, (typeof attempts)[number]>();
  // Only transfers that actually reached the network are shown.
  for (const a of attempts) if (a.state !== "signed") latest.set(a.allocationId, a);
  return rows.map((r) => {
    const a = latest.get(r.id);
    return {
      id: r.id,
      ticker: r.ticker,
      amount: r.amount,
      decimals: r.decimals,
      eligibleMinutes: r.eligibleMinutes,
      state: r.state as AllocationState,
      holdReason: (r.holdReason as HoldReason | null) ?? null,
      weekStart: r.weekStart,
      submissionId: r.submissionId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      tx: a ? { hash: a.hash, state: a.state } : null,
    };
  });
}

/** Full detail. `viewer` is the owner, or an admin (ownerOnly = false). */
export async function submissionDetail(id: string, viewer: { userId: string; isAdmin: boolean }, asAdmin = false): Promise<SubmissionDetail> {
  const db = await getDb();
  const [row] = await db
    .select({ submission: submissions, owner: users.address })
    .from(submissions)
    .innerJoin(users, eq(users.id, submissions.userId))
    .where(eq(submissions.id, id))
    .limit(1);
  const allowed = row && (row.submission.userId === viewer.userId || (asAdmin && viewer.isAdmin));
  if (!row || !allowed) throw new AppError(404, "Submission not found.");
  const [files, usage, decisions, allocations] = await Promise.all([
    db.select().from(evidence).where(eq(evidence.submissionId, id)).orderBy(asc(evidence.createdAt)),
    db.select().from(verifiedUsage).where(eq(verifiedUsage.submissionId, id)),
    db.select().from(reviewDecisions).where(eq(reviewDecisions.submissionId, id)).orderBy(desc(reviewDecisions.createdAt)),
    allocationViews(eq(rewardAllocations.submissionId, id)),
  ]);
  return {
    submission: row.submission,
    owner: row.owner,
    evidence: files.map(view),
    usage: usage.map((u) => ({ app: u.app, minutes: u.minutes })),
    decisions: decisions.map((d) => ({ id: d.id, action: d.action, reason: d.reason, revision: d.revision, createdAt: d.createdAt, reviewer: d.reviewer })),
    allocations,
  };
}

/** For the file route: who owns the submission a screenshot belongs to. */
export async function evidenceForDownload(evidenceId: string) {
  const db = await getDb();
  const [row] = await db
    .select({ evidence, userId: submissions.userId })
    .from(evidence)
    .innerJoin(submissions, eq(submissions.id, evidence.submissionId))
    .where(eq(evidence.id, evidenceId))
    .limit(1);
  return row ?? null;
}
