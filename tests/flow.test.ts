import { ADMIN, fakePng } from "./setup";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { closeDb, getDb } from "@/db/client";
import { auditEvents, payoutAttempts, payoutJobs, rewardAllocations, rewardPools } from "@/db/schema";
import { AppError } from "@/core/errors";
import { completedWeeks } from "@/core/weeks";
import { fundPool, listPools, retryAwaitingFunding } from "@/server/allocations";
import { createNonce, createSession, revokeSession, sessionFromToken, verifySignIn } from "@/server/auth";
import { isAdminAddress } from "@/server/env";
import { retryFailedJob, tick } from "@/server/payouts/worker";
import { ChainDouble } from "./support/chain-double";
import { blankPolicy, createPolicyDraft, publishPolicy, updatePolicyDraft } from "@/server/policies";
import { decide, setVerifiedUsage } from "@/server/review";
import { signedEvidenceUrl, verifyEvidenceSignature } from "@/server/storage";
import { addEvidence, createDraft, deleteEvidenceFiles, submissionDetail, submitForReview } from "@/server/submissions";

after(() => closeDb());

const HOST = "scroll.test";
const ORIGIN = "https://scroll.test";
const NOW = new Date("2026-10-01T12:00:00Z");
const WEEKS = completedWeeks(NOW, 4);
let seed = 1;

const status = (s: number) => (e: unknown) => e instanceof AppError && e.status === s;

async function signIn(overrides: { domain?: string; uri?: string; origin?: string; host?: string; issuedAt?: Date } = {}) {
  const account = privateKeyToAccount(generatePrivateKey());
  const { nonce } = await createNonce(NOW);
  const message = createSiweMessage({
    address: account.address,
    chainId: 4663,
    domain: overrides.domain ?? HOST,
    uri: overrides.uri ?? ORIGIN,
    nonce,
    version: "1",
    issuedAt: overrides.issuedAt ?? NOW,
    expirationTime: new Date((overrides.issuedAt ?? NOW).getTime() + 5 * 60 * 1000),
    statement: "Sign in to SCROLL.",
  });
  const signature = await account.signMessage({ message });
  return { account, message, signature, input: { message, signature, host: overrides.host ?? HOST, origin: overrides.origin ?? ORIGIN, now: NOW } };
}

async function newUser() {
  const { account, input } = await signIn();
  const { token } = await verifySignIn(input);
  const session = (await sessionFromToken(token, NOW))!;
  return { ...session, token, account };
}

async function pendingSubmission(user: { userId: string; address: string }, week = WEEKS[0]) {
  const sub = await createDraft(user, { platform: "ios", weekStart: week }, NOW);
  await addEvidence(user, sub.id, fakePng(1170, 2532, seed++), NOW);
  return submitForReview(user, sub.id, { confirmed: true }, NOW);
}

async function publishTestPolicy(overrides: Partial<Record<string, Partial<{ unitsPerMinute: string; walletWeeklyCap: string; weeklyPoolLimit: string; minPayout: string }>>> = {}) {
  const config = blankPolicy();
  config.label = "test policy";
  for (const t of Object.keys(config.tickers) as (keyof typeof config.tickers)[]) {
    config.tickers[t] = { enabled: true, unitsPerMinute: "1000", walletWeeklyCap: "100000000", weeklyPoolLimit: "100000000", minPayout: "0", ...overrides[t] };
  }
  for (const a of Object.keys(config.apps) as (keyof typeof config.apps)[]) config.apps[a] = { maxMinutesPerWeek: 3000 };
  const draft = await createPolicyDraft(ADMIN, config);
  return publishPolicy(ADMIN, draft.id, NOW);
}

// ───────────────────────── wallet authentication ─────────────────────────

test("auth: a valid signed message creates a session", async () => {
  const { account, input } = await signIn();
  const { token, address } = await verifySignIn(input);
  assert.equal(address, account.address.toLowerCase());
  const session = await sessionFromToken(token, NOW);
  assert.equal(session?.address, address);
  assert.equal(session?.isAdmin, false);
});

test("auth: replaying the same message and signature is refused", async () => {
  const { input } = await signIn();
  await verifySignIn(input);
  await assert.rejects(verifySignIn(input), status(401));
});

test("auth: two concurrent uses of one nonce produce one session", async () => {
  const { input } = await signIn();
  const results = await Promise.allSettled([verifySignIn(input), verifySignIn(input), verifySignIn(input)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});

test("auth: a message for another domain or origin is refused", async () => {
  await assert.rejects(verifySignIn((await signIn({ domain: "evil.test", uri: "https://evil.test" })).input), status(401));
  await assert.rejects(verifySignIn((await signIn({ origin: "https://evil.test" })).input), status(401));
  await assert.rejects(verifySignIn((await signIn({ host: "evil.test", origin: "https://evil.test" })).input), status(401));
  await assert.rejects(verifySignIn({ ...(await signIn()).input, origin: null }), status(401));
});

test("auth: wrong signer, unknown nonce and expired messages are refused", async () => {
  const a = await signIn();
  const b = await signIn();
  await assert.rejects(verifySignIn({ ...a.input, signature: b.signature }), status(401));
  // The failed attempt burned a's nonce: the right signature no longer works either.
  await assert.rejects(verifySignIn(a.input), status(401));

  const stale = await signIn({ issuedAt: new Date(NOW.getTime() - 60 * 60 * 1000) });
  await assert.rejects(verifySignIn(stale.input), status(401));

  const account = privateKeyToAccount(generatePrivateKey());
  const message = createSiweMessage({ address: account.address, chainId: 4663, domain: HOST, uri: ORIGIN, nonce: "neverissued1234567", version: "1", issuedAt: NOW, expirationTime: new Date(NOW.getTime() + 60000) });
  await assert.rejects(verifySignIn({ message, signature: await account.signMessage({ message }), host: HOST, origin: ORIGIN, now: NOW }), status(401));
});

test("auth: sessions expire and can be revoked", async () => {
  const user = await newUser();
  assert.ok(await sessionFromToken(user.token, NOW));
  assert.equal(await sessionFromToken(user.token, new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000)), null);
  await revokeSession(user.token, NOW);
  assert.equal(await sessionFromToken(user.token, NOW), null);
  assert.equal(await sessionFromToken("not-a-token", NOW), null);
});

// ───────────────────────── access boundaries ─────────────────────────

test("access: the admin role comes from the server allowlist only", async () => {
  assert.equal(isAdminAddress(ADMIN), true);
  assert.equal(isAdminAddress(ADMIN.toUpperCase().replace("0X", "0x")), true);
  const user = await newUser();
  assert.equal(user.isAdmin, false);
  const { token } = await createSession(ADMIN, NOW);
  assert.equal((await sessionFromToken(token, NOW))?.isAdmin, true);
});

test("access: another wallet's submission does not exist for you", async () => {
  const alice = await newUser();
  const bob = await newUser();
  const sub = await pendingSubmission(alice);
  assert.equal((await submissionDetail(sub.id, alice)).submission.id, sub.id);
  await assert.rejects(submissionDetail(sub.id, bob), status(404));
  await assert.rejects(addEvidence(bob, sub.id, fakePng(1170, 2532, seed++), NOW), status(404));
  await assert.rejects(submitForReview(bob, sub.id, { confirmed: true }, NOW), status(404));
  // A non-admin asking for the admin view gets nothing either.
  await assert.rejects(submissionDetail(sub.id, bob, true), status(404));
  assert.equal((await submissionDetail(sub.id, { userId: "x", isAdmin: true }, true)).submission.id, sub.id);
});

test("access: screenshot URLs are bound to one viewer and expire", async () => {
  const url = new URL(signedEvidenceUrl("ev_abc", "0xAAA", 1_000_000), "http://x");
  const e = url.searchParams.get("e");
  const s = url.searchParams.get("s");
  assert.equal(verifyEvidenceSignature("ev_abc", "0xaaa", e, s, 1_000_000), true);
  assert.equal(verifyEvidenceSignature("ev_abc", "0xbbb", e, s, 1_000_000), false, "another viewer");
  assert.equal(verifyEvidenceSignature("ev_other", "0xaaa", e, s, 1_000_000), false, "another file");
  assert.equal(verifyEvidenceSignature("ev_abc", "0xaaa", e, s, 1_000_000 + 6 * 60 * 1000), false, "expired");
  assert.equal(verifyEvidenceSignature("ev_abc", "0xaaa", String(Number(e) + 999), s, 1_000_000), false, "extended expiry");
  assert.equal(verifyEvidenceSignature("ev_abc", "0xaaa", e, null, 1_000_000), false);
});

// ───────────────────────── uploads and duplicates ─────────────────────────

test("uploads: content is validated, not the file name", async () => {
  const user = await newUser();
  const sub = await createDraft(user, { platform: "android", weekStart: WEEKS[0] }, NOW);
  await assert.rejects(addEvidence(user, sub.id, new TextEncoder().encode("not an image at all, just renamed".padEnd(80)), NOW), status(415));
  await assert.rejects(addEvidence(user, sub.id, fakePng(100, 100, seed++), NOW), status(422));
  await assert.rejects(addEvidence(user, sub.id, new Uint8Array(0), NOW), status(400));
  await assert.rejects(submitForReview(user, sub.id, { confirmed: true }, NOW), status(400));
  await addEvidence(user, sub.id, fakePng(1080, 2400, seed++), NOW);
  await assert.rejects(submitForReview(user, sub.id, { confirmed: false }, NOW), status(400));
  assert.equal((await submitForReview(user, sub.id, { confirmed: true }, NOW)).status, "pending_review");
  await assert.rejects(addEvidence(user, sub.id, fakePng(1080, 2400, seed++), NOW), status(409));
});

test("duplicates: the same file can't be used twice, by anyone", async () => {
  const alice = await newUser();
  const bob = await newUser();
  const file = fakePng(1170, 2532, seed++);
  const a = await createDraft(alice, { platform: "ios", weekStart: WEEKS[0] }, NOW);
  const first = await addEvidence(alice, a.id, file, NOW);
  assert.equal(first.duplicate, false);
  // Re-sending to the same submission is idempotent.
  const again = await addEvidence(alice, a.id, file, NOW);
  assert.equal(again.duplicate, true);
  assert.equal(again.evidence.id, first.evidence.id);
  // Another week, or another wallet: refused.
  const a2 = await createDraft(alice, { platform: "ios", weekStart: WEEKS[1] }, NOW);
  await assert.rejects(addEvidence(alice, a2.id, file, NOW), status(409));
  const b = await createDraft(bob, { platform: "ios", weekStart: WEEKS[0] }, NOW);
  await assert.rejects(addEvidence(bob, b.id, file, NOW), status(409));
});

test("duplicates: one submission per wallet per week, revised in place", async () => {
  const user = await newUser();
  const sub = await pendingSubmission(user);
  await assert.rejects(createDraft(user, { platform: "ios", weekStart: WEEKS[0] }, NOW), status(409));
  await assert.rejects(createDraft(user, { platform: "ios", weekStart: "2026-09-27" }, NOW), status(400));
  await assert.rejects(createDraft(user, { platform: "windows", weekStart: WEEKS[1] }, NOW), status(400));

  // Controlled revision: the reviewer asks, the same row goes round again.
  await assert.rejects(decide(ADMIN, sub.id, { action: "request_changes", reason: "" }, NOW), status(400));
  await decide(ADMIN, sub.id, { action: "request_changes", reason: "The reporting week isn't visible." }, NOW);
  let detail = await submissionDetail(sub.id, user);
  assert.equal(detail.submission.status, "needs_changes");
  assert.equal(detail.submission.reviewerNote, "The reporting week isn't visible.");
  await addEvidence(user, sub.id, fakePng(1170, 2532, seed++), NOW);
  const resubmitted = await submitForReview(user, sub.id, { confirmed: true }, NOW);
  assert.equal(resubmitted.revision, 2);
  detail = await submissionDetail(sub.id, user);
  assert.equal(detail.evidence.length, 2);
  assert.deepEqual(detail.evidence.map((e) => e.kind), ["primary", "supplementary"]);

  await decide(ADMIN, sub.id, { action: "reject", reason: "Edited screenshot." }, NOW);
  await assert.rejects(decide(ADMIN, sub.id, { action: "approve", reason: "" }, NOW), status(409));
  await assert.rejects(createDraft(user, { platform: "ios", weekStart: WEEKS[0] }, NOW), status(409));
});

// ───────────────────────── policy, allocation, pools ─────────────────────────

test("policy: nothing is allocated without a published policy", async () => {
  const user = await newUser();
  const sub = await pendingSubmission(user);
  assert.equal(sub.policyVersionId, null);
  await setVerifiedUsage(ADMIN, sub.id, { instagram: 100 }, NOW);
  const { allocations } = await decide(ADMIN, sub.id, { action: "approve", reason: "" }, NOW);
  assert.equal(allocations.length, 0);
  const detail = await submissionDetail(sub.id, user);
  assert.equal(detail.submission.status, "approved");
  assert.equal(detail.allocations.length, 0);
});

test("policy: a submission keeps the policy it was submitted under", async () => {
  const v1 = await publishTestPolicy({ META: { unitsPerMinute: "1000" } });
  const user = await newUser();
  const sub = await pendingSubmission(user);
  assert.equal(sub.policyVersionId, v1.id);
  await assert.rejects(updatePolicyDraft(ADMIN, v1.id, v1.config), status(409));
  // A new, far more generous policy is published before review.
  const v2 = await publishTestPolicy({ META: { unitsPerMinute: "999999" } });
  assert.notEqual(v2.id, v1.id);
  await fundPool(ADMIN, { ticker: "META", amount: "50000000", note: "test funding" }, NOW);
  await setVerifiedUsage(ADMIN, sub.id, { instagram: 300, facebook: 120 }, NOW);
  const { allocations } = await decide(ADMIN, sub.id, { action: "approve", reason: "" }, NOW);
  assert.equal(allocations.length, 1, "Instagram + Facebook are one META allocation");
  assert.equal(allocations[0].amount, "420000");
  assert.equal(allocations[0].policyVersionId, v1.id);
  assert.equal(allocations[0].state, "queued");
});

test("pools: an approval the pool can't cover waits at its full amount", async () => {
  await publishTestPolicy();
  const user = await newUser();
  const sub = await pendingSubmission(user);
  await setVerifiedUsage(ADMIN, sub.id, { roblox: 500 }, NOW);
  const { allocations } = await decide(ADMIN, sub.id, { action: "approve", reason: "" }, NOW);
  assert.equal(allocations[0].state, "awaiting_funding");
  assert.equal(allocations[0].holdReason, "pool_inventory");
  assert.equal(allocations[0].amount, "500000", "not reduced to fit");
  let rblx = (await listPools()).find((p) => p.ticker === "RBLX")!;
  assert.equal(rblx.reserved, "0");
  assert.equal(rblx.awaitingFunding, "500000");

  await fundPool(ADMIN, { ticker: "RBLX", amount: "400000", note: "partial" }, NOW);
  assert.equal((await submissionDetail(sub.id, user)).allocations[0].state, "awaiting_funding", "still not enough");
  await fundPool(ADMIN, { ticker: "RBLX", amount: "100000", note: "rest" }, NOW);
  const after = (await submissionDetail(sub.id, user)).allocations[0];
  assert.equal(after.state, "queued");
  assert.equal(after.amount, "500000");
  rblx = (await listPools()).find((p) => p.ticker === "RBLX")!;
  assert.equal(rblx.reserved, "500000");
  assert.equal(rblx.available, "0");
});

test("pools: concurrent approvals can't overspend the pool", async () => {
  await publishTestPolicy();
  const before = (await listPools()).find((p) => p.ticker === "SNAP")!;
  assert.equal(before.available, "0");
  const users = await Promise.all(Array.from({ length: 6 }, () => newUser()));
  const subs: { id: string }[] = [];
  for (const u of users) {
    const s = await pendingSubmission(u);
    await setVerifiedUsage(ADMIN, s.id, { snapchat: 100 }, NOW);
    subs.push(s);
  }
  // Enough for exactly 2 of the 6 (100 min × 1000 units each).
  await fundPool(ADMIN, { ticker: "SNAP", amount: "250000", note: "test" }, NOW);
  await Promise.all(subs.map((s) => decide(ADMIN, s.id, { action: "approve", reason: "" }, NOW)));
  const db = await getDb();
  const rows = (await db.select().from(rewardAllocations).where(eq(rewardAllocations.ticker, "SNAP"))).filter((r) => subs.some((s) => s.id === r.submissionId));
  assert.equal(rows.length, 6);
  assert.equal(rows.filter((r) => r.reserved).length, 2);
  assert.equal(rows.filter((r) => r.state === "awaiting_funding").length, 4);
  const pool = (await listPools()).find((p) => p.ticker === "SNAP")!;
  assert.equal(pool.reserved, "200000");
  assert.equal(pool.available, "50000");
  assert.ok(BigInt(pool.available) >= BigInt(0));
  // Racing retries don't overspend either.
  await Promise.all([retryAwaitingFunding(ADMIN, "SNAP", NOW), retryAwaitingFunding(ADMIN, "SNAP", NOW)]);
  assert.equal((await listPools()).find((p) => p.ticker === "SNAP")!.reserved, "200000");
});

test("pools: a second decision on the same submission loses", async () => {
  await publishTestPolicy();
  const user = await newUser();
  const sub = await pendingSubmission(user, WEEKS[2]);
  await setVerifiedUsage(ADMIN, sub.id, { reddit: 60 }, NOW);
  await fundPool(ADMIN, { ticker: "RDDT", amount: "60000", note: "test" }, NOW);
  const results = await Promise.allSettled([
    decide(ADMIN, sub.id, { action: "approve", reason: "" }, NOW),
    decide(ADMIN, sub.id, { action: "approve", reason: "" }, NOW),
    decide(ADMIN, sub.id, { action: "reject", reason: "duplicate" }, NOW),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const db = await getDb();
  assert.ok((await db.select().from(rewardAllocations).where(eq(rewardAllocations.submissionId, sub.id))).length <= 1);
});

test("pools: weekly limit and minimum payout hold allocations", async () => {
  await publishTestPolicy({ NFLX: { weeklyPoolLimit: "150000", minPayout: "250000" } });
  await fundPool(ADMIN, { ticker: "NFLX", amount: "10000000", note: "test" }, NOW);
  const week = WEEKS[3];
  const a = await newUser();
  const b = await newUser();
  const sa = await pendingSubmission(a, week);
  const sb = await pendingSubmission(b, week);
  await setVerifiedUsage(ADMIN, sa.id, { netflix: 100 }, NOW);
  await setVerifiedUsage(ADMIN, sb.id, { netflix: 100 }, NOW);
  const ra = await decide(ADMIN, sa.id, { action: "approve", reason: "" }, NOW);
  const rb = await decide(ADMIN, sb.id, { action: "approve", reason: "" }, NOW);
  // 100,000 fits the week's 150,000; the second 100,000 does not.
  assert.equal(ra.allocations[0].state, "allocated");
  assert.equal(ra.allocations[0].holdReason, "below_minimum");
  assert.equal(rb.allocations[0].state, "awaiting_funding");
  assert.equal(rb.allocations[0].holdReason, "weekly_pool_limit");
  // A second week for wallet A brings its unpaid total to 200,000, still under 250,000 …
  const sa2 = await pendingSubmission(a, WEEKS[1]);
  await setVerifiedUsage(ADMIN, sa2.id, { netflix: 100 }, NOW);
  assert.equal((await decide(ADMIN, sa2.id, { action: "approve", reason: "" }, NOW)).allocations[0].state, "allocated");
  // … and a third reaches 300,000: all three are queued together.
  const sa3 = await pendingSubmission(a, WEEKS[0]);
  await setVerifiedUsage(ADMIN, sa3.id, { netflix: 100 }, NOW);
  await decide(ADMIN, sa3.id, { action: "approve", reason: "" }, NOW);
  const db = await getDb();
  const mine = (await db.select().from(rewardAllocations).where(eq(rewardAllocations.userId, a.userId))).filter((r) => r.ticker === "NFLX");
  assert.deepEqual(mine.map((m) => m.state), ["queued", "queued", "queued"]);
});

// ───────────────────────── payouts ─────────────────────────

async function drain(adapter: ChainDouble) {
  // Finish anything left queued by earlier tests so each payout test starts clean.
  for (let i = 0; i < 6; i++) await tick({ adapter, ignoreSwitch: true, now: new Date(NOW.getTime() + (i + 1) * 60_000) });
}

async function approvedAllocation(minutes: number) {
  await publishTestPolicy();
  await fundPool(ADMIN, { ticker: "RDDT", amount: String(minutes * 1000), note: "test" }, NOW);
  const user = await newUser();
  const sub = await pendingSubmission(user);
  await setVerifiedUsage(ADMIN, sub.id, { reddit: minutes }, NOW);
  const { allocations } = await decide(ADMIN, sub.id, { action: "approve", reason: "" }, NOW);
  assert.equal(allocations[0].state, "queued");
  return { user, sub, allocation: allocations[0] };
}

const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

test("payouts: upload → review → allocation → confirmed payment", async () => {
  const adapter = new ChainDouble();
  await drain(adapter);
  const paidBefore = adapter.paid().length;
  const { user, sub, allocation } = await approvedAllocation(250);

  // Approved and reserved, but nothing is paid yet.
  let detail = await submissionDetail(sub.id, user);
  assert.equal(detail.submission.status, "approved");
  assert.equal(detail.allocations[0].state, "queued");
  assert.equal(detail.allocations[0].tx, null);

  const first = await tick({ adapter, ignoreSwitch: true, now: later(10) });
  assert.equal(first.submitted, 1);
  detail = await submissionDetail(sub.id, user);
  assert.equal(detail.allocations[0].state, "submitted", "sent is not paid");
  assert.ok(detail.allocations[0].tx?.hash);

  const second = await tick({ adapter, ignoreSwitch: true, now: later(11) });
  assert.equal(second.confirmed, 1);
  detail = await submissionDetail(sub.id, user);
  assert.equal(detail.allocations[0].state, "confirmed");

  const transfers = adapter.paid().slice(paidBefore);
  assert.equal(transfers.length, 1);
  assert.equal(transfers[0].to, user.address);
  assert.equal(transfers[0].amount, BigInt(250_000));
  assert.equal(transfers[0].amount.toString(), allocation.amount);

  const db = await getDb();
  const [pool] = await db.select().from(rewardPools).where(eq(rewardPools.ticker, "RDDT"));
  assert.equal(BigInt(pool.funded) - BigInt(pool.reserved) - BigInt(pool.paid) >= BigInt(0), true);
  const events = await db.select().from(auditEvents).where(eq(auditEvents.entityId, allocation.id));
  assert.deepEqual(events.map((e) => e.action).sort(), ["allocation.created", "payout.confirmed", "payout.submitted"]);

  // Further ticks do nothing.
  await tick({ adapter, ignoreSwitch: true, now: later(12) });
  assert.equal(adapter.paid().slice(paidBefore).length, 1);
});

test("payouts: a crash right after broadcast never pays twice", async () => {
  const adapter = new ChainDouble();
  await drain(adapter);
  const paidBefore = adapter.paid().length;
  const { allocation } = await approvedAllocation(40);
  adapter.crashAfterBroadcast = true;
  const crashed = await tick({ adapter, ignoreSwitch: true, now: later(10) });
  assert.equal(crashed.waiting, 1, "the worker saw an error");
  const db = await getDb();
  const [job] = await db.select().from(payoutJobs).where(eq(payoutJobs.allocationId, allocation.id));
  let attempts = await db.select().from(payoutAttempts).where(eq(payoutAttempts.jobId, job.id));
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].state, "signed", "the hash was stored before the broadcast");

  // Retry storm.
  for (let i = 0; i < 5; i++) await tick({ adapter, ignoreSwitch: true, now: later(20 + i) });
  attempts = await db.select().from(payoutAttempts).where(eq(payoutAttempts.jobId, job.id));
  assert.equal(attempts.length, 1, "no second transfer was ever signed");
  assert.equal(attempts[0].state, "confirmed");
  assert.equal(adapter.paid().slice(paidBefore).length, 1);
  const [a] = await db.select().from(rewardAllocations).where(eq(rewardAllocations.id, allocation.id));
  assert.equal(a.state, "confirmed");
});

test("payouts: a failed broadcast resends the same signed bytes", async () => {
  const adapter = new ChainDouble();
  await drain(adapter);
  const paidBefore = adapter.paid().length;
  const { allocation } = await approvedAllocation(30);
  adapter.failNextBroadcast = true;
  await tick({ adapter, ignoreSwitch: true, now: later(10) });
  const db = await getDb();
  const [job] = await db.select().from(payoutJobs).where(eq(payoutJobs.allocationId, allocation.id));
  const [before] = await db.select().from(payoutAttempts).where(eq(payoutAttempts.jobId, job.id));
  for (let i = 0; i < 4; i++) await tick({ adapter, ignoreSwitch: true, now: later(20 + i) });
  const attempts = await db.select().from(payoutAttempts).where(eq(payoutAttempts.jobId, job.id));
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].txHash, before.txHash);
  assert.equal(attempts[0].state, "confirmed");
  assert.equal(adapter.paid().slice(paidBefore).length, 1);
});

test("payouts: two workers ticking at once send one transfer", async () => {
  const adapter = new ChainDouble();
  await drain(adapter);
  const paidBefore = adapter.paid().length;
  const { allocation } = await approvedAllocation(20);
  await Promise.all([tick({ adapter, ignoreSwitch: true, now: later(10) }), tick({ adapter, ignoreSwitch: true, now: later(10) }), tick({ adapter, ignoreSwitch: true, now: later(10) })]);
  for (let i = 0; i < 3; i++) await Promise.all([tick({ adapter, ignoreSwitch: true, now: later(20 + i) }), tick({ adapter, ignoreSwitch: true, now: later(20 + i) })]);
  const db = await getDb();
  const [job] = await db.select().from(payoutJobs).where(eq(payoutJobs.allocationId, allocation.id));
  assert.equal((await db.select().from(payoutAttempts).where(eq(payoutAttempts.jobId, job.id))).length, 1);
  assert.equal(adapter.paid().slice(paidBefore).length, 1);
  assert.equal(job.state, "confirmed");
});

test("payouts: a reverted transfer is failed, kept reserved, and retried only by an admin", async () => {
  const adapter = new ChainDouble();
  await drain(adapter);
  const paidBefore = adapter.paid().length;
  const { allocation, user, sub } = await approvedAllocation(10);
  adapter.revertNext = true;
  await tick({ adapter, ignoreSwitch: true, now: later(10) });
  await tick({ adapter, ignoreSwitch: true, now: later(11) });
  const db = await getDb();
  let [job] = await db.select().from(payoutJobs).where(eq(payoutJobs.allocationId, allocation.id));
  assert.equal(job.state, "failed");
  assert.equal((await submissionDetail(sub.id, user)).allocations[0].state, "failed");
  assert.equal(adapter.paid().slice(paidBefore).length, 0);
  // Failed jobs are not picked up again on their own.
  await tick({ adapter, ignoreSwitch: true, now: later(30) });
  assert.equal((await db.select().from(payoutAttempts).where(eq(payoutAttempts.jobId, job.id))).length, 1);

  await retryFailedJob(ADMIN, job.id, later(31));
  await assert.rejects(retryFailedJob(ADMIN, job.id, later(31)), status(409));
  await tick({ adapter, ignoreSwitch: true, now: later(32) });
  await tick({ adapter, ignoreSwitch: true, now: later(33) });
  [job] = await db.select().from(payoutJobs).where(eq(payoutJobs.allocationId, allocation.id));
  assert.equal(job.state, "confirmed");
  assert.equal(adapter.paid().slice(paidBefore).length, 1);
  // A confirmed job can't be retried into a second payment.
  await assert.rejects(retryFailedJob(ADMIN, job.id, later(40)), status(409));
});

test("payouts: nothing is sent when the treasury can't cover it, and nothing is faked", async () => {
  const adapter = new ChainDouble();
  await drain(adapter);
  adapter.enforceBalances = true;
  const { allocation } = await approvedAllocation(15);
  const r = await tick({ adapter, ignoreSwitch: true, now: later(10) });
  assert.equal(r.waiting, 1);
  const db = await getDb();
  const [job] = await db.select().from(payoutJobs).where(eq(payoutJobs.allocationId, allocation.id));
  assert.equal(job.state, "queued");
  assert.match(job.lastError ?? "", /Treasury holds less RDDT/);
  assert.equal((await db.select().from(payoutAttempts).where(eq(payoutAttempts.jobId, job.id))).length, 0);

  // Live mode without a treasury key: the worker reports the setup gap instead of running.
  const live = await tick({ ignoreSwitch: true, now: later(11) });
  assert.equal(live.ran, false);
  assert.match(live.reason ?? "", /TREASURY_PRIVATE_KEY/);
  const off = await tick({ adapter, now: later(12) });
  assert.equal(off.ran, false, "the admin switch is off by default");
});

test("privacy: deleting files keeps the decision and the fingerprint", async () => {
  const user = await newUser();
  const sub = await pendingSubmission(user, WEEKS[1]);
  await assert.rejects(deleteEvidenceFiles(user, sub.id, NOW), status(409));
  await decide(ADMIN, sub.id, { action: "reject", reason: "Unreadable." }, NOW);
  assert.equal(await deleteEvidenceFiles(user, sub.id, NOW), 1);
  const detail = await submissionDetail(sub.id, user);
  assert.equal(detail.evidence[0].fileDeleted, true);
  assert.equal(detail.submission.status, "rejected");
});
