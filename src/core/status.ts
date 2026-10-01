/** Review status and payout state are two separate things. An approved screenshot is not a payment. */

export const REVIEW_STATUSES = ["draft", "pending_review", "needs_changes", "approved", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Per-allocation states. "not_allocated" is the submission-level absence of any allocation. */
export const ALLOCATION_STATES = ["allocated", "awaiting_funding", "queued", "submitted", "confirmed", "failed"] as const;
export type AllocationState = (typeof ALLOCATION_STATES)[number];
export type PayoutState = AllocationState | "not_allocated";

export type Tone = "neutral" | "wait" | "action" | "good" | "bad";

export const REVIEW_LABEL: Record<ReviewStatus, { label: string; tone: Tone; hint: string }> = {
  draft: { label: "Draft", tone: "neutral", hint: "Not submitted yet." },
  pending_review: { label: "Pending review", tone: "wait", hint: "A reviewer will check your screenshot." },
  needs_changes: { label: "Needs changes", tone: "action", hint: "The reviewer asked for an update." },
  approved: { label: "Approved", tone: "good", hint: "Your usage was verified. Approval is not a payment." },
  rejected: { label: "Rejected", tone: "bad", hint: "This submission was not accepted." },
};

export const PAYOUT_LABEL: Record<PayoutState, { label: string; tone: Tone; hint: string }> = {
  not_allocated: { label: "Not allocated", tone: "neutral", hint: "No reward has been allocated." },
  allocated: { label: "Allocated", tone: "wait", hint: "Reserved from the pool. Not sent yet." },
  awaiting_funding: { label: "Awaiting funding", tone: "action", hint: "The pool can't cover this allocation yet." },
  queued: { label: "Queued", tone: "wait", hint: "Waiting to be sent." },
  submitted: { label: "Submitted", tone: "wait", hint: "Transfer sent. Waiting for confirmation." },
  confirmed: { label: "Confirmed", tone: "good", hint: "Transfer confirmed on the network." },
  failed: { label: "Failed", tone: "bad", hint: "The transfer failed and is being looked at." },
};

export type HoldReason = "below_minimum" | "pool_inventory" | "weekly_pool_limit";

export const HOLD_LABEL: Record<HoldReason, string> = {
  below_minimum: "Held until your unpaid total for this token reaches the minimum payout.",
  pool_inventory: "The reward pool doesn't hold enough of this token yet. Your allocation is unchanged and waits for funding.",
  weekly_pool_limit: "This token's pool for that week is fully reserved. Your allocation is unchanged and waits for capacity.",
};
