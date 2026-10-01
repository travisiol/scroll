import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
/** Token base units. NUMERIC(78,0) holds any uint256 exactly. */
const units = (name: string) => numeric(name, { precision: 78, scale: 0 });

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  /** Lowercase 0x address. A wallet is an account, not proof of a unique person. */
  address: text("address").notNull().unique(),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastLoginAt: ts("last_login_at"),
});

export const authNonces = pgTable("auth_nonces", {
  nonce: text("nonce").primaryKey(),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
});

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the cookie token; the token itself is never stored. */
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    address: text("address").notNull(),
    kind: text("kind").notNull().default("wallet"),
    createdAt: ts("created_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const policyVersions = pgTable("policy_versions", {
  id: text("id").primaryKey(),
  version: integer("version").notNull().unique(),
  /** draft → published → retired. Published versions are immutable. */
  status: text("status").notNull(),
  config: jsonb("config").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  publishedAt: ts("published_at"),
  retiredAt: ts("retired_at"),
});

export const submissions = pgTable(
  "submissions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    platform: text("platform").notNull(),
    /** First day of the reporting week, YYYY-MM-DD. */
    weekStart: text("week_start").notNull(),
    status: text("status").notNull(),
    revision: integer("revision").notNull().default(0),
    /** The policy in force when the user submitted; later edits can't change it. */
    policyVersionId: text("policy_version_id").references(() => policyVersions.id),
    userConfirmed: boolean("user_confirmed").notNull().default(false),
    /** The reviewer's explanation shown to the user. */
    reviewerNote: text("reviewer_note"),
    submittedAt: ts("submitted_at"),
    decidedAt: ts("decided_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // One submission per wallet per reporting week. Revisions reuse the row.
    uniqueIndex("submissions_user_week_uq").on(t.userId, t.weekStart),
    index("submissions_status_idx").on(t.status, t.submittedAt),
  ],
);

export const evidence = pgTable(
  "evidence",
  {
    id: text("id").primaryKey(),
    submissionId: text("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    storageKey: text("storage_key").notNull(),
    /** File fingerprint. Unique across every wallet, and kept after the file is deleted. */
    sha256: text("sha256").notNull().unique(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    fileDeletedAt: ts("file_deleted_at"),
  },
  (t) => [index("evidence_submission_idx").on(t.submissionId)],
);

/** One row per app per submission, however many screenshots were uploaded: overlaps can't double-count. */
export const verifiedUsage = pgTable(
  "verified_usage",
  {
    submissionId: text("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
    app: text("app").notNull(),
    minutes: integer("minutes").notNull(),
    updatedBy: text("updated_by").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.submissionId, t.app] })],
);

export const reviewDecisions = pgTable(
  "review_decisions",
  {
    id: text("id").primaryKey(),
    submissionId: text("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
    reviewer: text("reviewer").notNull(),
    action: text("action").notNull(),
    reason: text("reason"),
    revision: integer("revision").notNull(),
    /** The verified durations at the moment of the decision. */
    usage: jsonb("usage").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("review_decisions_submission_idx").on(t.submissionId)],
);

export const rewardAllocations = pgTable(
  "reward_allocations",
  {
    id: text("id").primaryKey(),
    submissionId: text("submission_id").notNull().references(() => submissions.id),
    userId: text("user_id").notNull().references(() => users.id),
    recipient: text("recipient").notNull(),
    ticker: text("ticker").notNull(),
    tokenAddress: text("token_address").notNull(),
    chainId: integer("chain_id").notNull(),
    decimals: integer("decimals").notNull(),
    weekStart: text("week_start").notNull(),
    eligibleMinutes: integer("eligible_minutes").notNull(),
    amount: units("amount").notNull(),
    policyVersionId: text("policy_version_id").notNull().references(() => policyVersions.id),
    state: text("state").notNull(),
    holdReason: text("hold_reason"),
    /** True once inventory is reserved for this allocation. */
    reserved: boolean("reserved").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("allocations_submission_ticker_uq").on(t.submissionId, t.ticker),
    index("allocations_user_idx").on(t.userId),
    index("allocations_state_idx").on(t.state, t.createdAt),
  ],
);

/** The reward ledger's inventory per token. available = funded − reserved − paid. */
export const rewardPools = pgTable("reward_pools", {
  ticker: text("ticker").primaryKey(),
  funded: units("funded").notNull().default("0"),
  reserved: units("reserved").notNull().default("0"),
  paid: units("paid").notNull().default("0"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const poolWeekUsage = pgTable(
  "pool_week_usage",
  {
    ticker: text("ticker").notNull(),
    weekStart: text("week_start").notNull(),
    reserved: units("reserved").notNull().default("0"),
  },
  (t) => [primaryKey({ columns: [t.ticker, t.weekStart] })],
);

export const poolMovements = pgTable(
  "pool_movements",
  {
    id: text("id").primaryKey(),
    ticker: text("ticker").notNull(),
    /** fund | reserve | pay */
    kind: text("kind").notNull(),
    amount: units("amount").notNull(),
    allocationId: text("allocation_id"),
    note: text("note"),
    actor: text("actor").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("pool_movements_ticker_idx").on(t.ticker, t.createdAt)],
);

export const payoutJobs = pgTable(
  "payout_jobs",
  {
    id: text("id").primaryKey(),
    /** One job per allocation, ever. */
    allocationId: text("allocation_id").notNull().unique().references(() => rewardAllocations.id),
    /** queued | submitted | confirmed | failed */
    state: text("state").notNull(),
    runs: integer("runs").notNull().default(0),
    lockedUntil: ts("locked_until"),
    nextRunAt: ts("next_run_at").notNull().defaultNow(),
    lastError: text("last_error"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("payout_jobs_state_idx").on(t.state, t.nextRunAt)],
);

export const payoutAttempts = pgTable(
  "payout_attempts",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull().references(() => payoutJobs.id),
    adapter: text("adapter").notNull(),
    sender: text("sender").notNull(),
    nonce: integer("nonce").notNull(),
    /** Known before broadcast, so an interrupted job can always be reconciled. */
    txHash: text("tx_hash").notNull().unique(),
    rawTx: text("raw_tx").notNull(),
    /** signed | broadcast | confirmed | reverted | dropped */
    state: text("state").notNull(),
    error: text("error"),
    blockNumber: integer("block_number"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("payout_attempts_job_idx").on(t.jobId),
    // At most one unresolved transfer per job: the database refuses a second one.
    uniqueIndex("payout_attempts_open_uq").on(t.jobId).where(sql`state in ('signed','broadcast')`),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    data: jsonb("data"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_created_idx").on(t.createdAt)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
