import Link from "next/link";
import { notFound } from "next/navigation";
import { Amount, PageTitle, PayoutPill, ReviewPill, TxLink } from "@/components/app/bits";
import { SubmissionActions } from "@/components/app/SubmissionActions";
import { appByKey, PLATFORMS, type Platform } from "@/config/apps";
import { UPLOADS, formatBytes } from "@/config/uploads";
import { formatDuration } from "@/core/duration";
import { HOLD_LABEL, PAYOUT_LABEL, REVIEW_LABEL, type ReviewStatus } from "@/core/status";
import { formatWeek } from "@/core/weeks";
import { formatDateTime } from "@/lib/format";
import { currentSession } from "@/server/session";
import { signedEvidenceUrl } from "@/server/storage";
import { submissionDetail } from "@/server/submissions";

export const metadata = { title: "Submission" };

export default async function SubmissionPage(props: PageProps<"/app/submissions/[id]">) {
  const session = await currentSession();
  if (!session) return null;
  const { id } = await props.params;
  const query = await props.searchParams;
  const detail = await submissionDetail(id, session).catch(() => null);
  if (!detail) notFound();
  const { submission: s, evidence, usage, allocations, decisions } = detail;
  const status = s.status as ReviewStatus;
  const editable = status === "draft" || status === "needs_changes";
  const liveFiles = evidence.filter((e) => !e.fileDeleted);

  return (
    <>
      <p className="mb-3">
        <Link href="/app" className="link text-[0.95rem]">
          ← Dashboard
        </Link>
      </p>
      <PageTitle title={formatWeek(s.weekStart)}>{PLATFORMS[s.platform as Platform]?.name ?? s.platform}</PageTitle>

      {query.submitted === "1" && status === "pending_review" && (
        <div role="status" className="notice notice-good mb-5">
          <strong className="font-semibold">Saved and sent for review.</strong> A person will check it. You don&rsquo;t need to do anything else, and you can leave this page.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <section aria-labelledby="review" className="card card-pad">
          <h2 id="review" className="eyebrow">
            Review
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <ReviewPill status={status} />
            <span className="hint">{REVIEW_LABEL[status].hint}</span>
          </div>
          {s.reviewerNote && (
            <div className={`notice mt-4 ${status === "rejected" ? "notice-bad" : ""}`}>
              <strong className="font-semibold">From the reviewer:</strong> {s.reviewerNote}
            </div>
          )}
          {editable && (
            <Link href={`/app/upload?id=${s.id}`} className="btn btn-primary mt-5">
              {status === "draft" ? "Continue draft" : "Update and resubmit"}
            </Link>
          )}
          <dl className="mt-5 grid gap-2.5 border-t border-line pt-4 text-[0.95rem]">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Reporting period</dt>
              <dd className="text-right font-semibold">{formatWeek(s.weekStart)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Submitted</dt>
              <dd className="text-right">{formatDateTime(s.submittedAt)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Decided</dt>
              <dd className="text-right">{formatDateTime(s.decidedAt)}</dd>
            </div>
            {s.revision > 1 && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Revision</dt>
                <dd className="text-right">{s.revision}</dd>
              </div>
            )}
          </dl>

          <h3 className="mt-6 text-lg tracking-[-0.02em]">Verified app durations</h3>
          {usage.length ? (
            <ul className="mt-3 grid gap-2">
              {usage.map((u) => (
                <li key={u.app} className="flex justify-between gap-3">
                  <span className="font-semibold">{appByKey(u.app)?.name ?? u.app}</span>
                  <span className="text-muted">
                    {formatDuration(u.minutes)} → <span className="num">{appByKey(u.app)?.ticker}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-muted">{status === "approved" || status === "rejected" ? "No durations were verified." : "A reviewer hasn't verified durations yet."}</p>
          )}

          {decisions.length > 1 && (
            <>
              <h3 className="mt-6 text-lg tracking-[-0.02em]">Review history</h3>
              <ul className="mt-3 grid gap-2 text-[0.95rem]">
                {decisions.map((d) => (
                  <li key={d.id} className="flex justify-between gap-3">
                    <span>
                      <span className="font-semibold">{d.action === "request_changes" ? "Changes requested" : d.action === "approve" ? "Approved" : "Rejected"}</span>
                      {d.reason && <span className="text-muted"> · {d.reason}</span>}
                    </span>
                    <span className="hint whitespace-nowrap">{formatDateTime(d.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section aria-labelledby="rewards" className="card card-pad">
          <h2 id="rewards" className="eyebrow">
            Reward and payout
          </h2>
          {allocations.length === 0 ? (
            <div className="mt-3">
              <PayoutPill state="not_allocated" />
              <p className="mt-3 leading-relaxed text-muted">
                {status === "approved"
                  ? s.policyVersionId
                    ? "This submission was approved, but the verified usage didn't produce a reward under the policy it was submitted under."
                    : "This submission was approved, but no reward policy was published when it was submitted, so nothing was allocated."
                  : status === "rejected"
                    ? "Rejected submissions aren't allocated rewards."
                    : "Rewards are allocated only after a reviewer approves the submission."}
              </p>
            </div>
          ) : (
            <ul className="mt-3 grid gap-4">
              {allocations.map((a) => (
                <li key={a.id} className="rounded-2xl border border-line bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Amount value={a.amount} decimals={a.decimals} ticker={a.ticker} className="text-xl" />
                    <PayoutPill state={a.state} />
                  </div>
                  <p className="hint mt-2">
                    {formatDuration(a.eligibleMinutes)} eligible · {a.holdReason ? HOLD_LABEL[a.holdReason] : PAYOUT_LABEL[a.state].hint}
                  </p>
                  {a.tx && (
                    <p className="mt-2 text-[0.95rem]">
                      Transaction: <TxLink tx={a.tx} />
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="hint mt-4">An approved screenshot is not a payment. A reward is paid only when its transfer shows as Confirmed.</p>
        </section>
      </div>

      <section aria-labelledby="evidence" className="card card-pad mt-5">
        <h2 id="evidence" className="eyebrow">
          Uploaded evidence
        </h2>
        {evidence.length === 0 ? (
          <p className="mt-3 text-muted">No screenshots yet.</p>
        ) : (
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {evidence.map((e, i) => (
              <li key={e.id} className="overflow-hidden rounded-2xl border border-line bg-white">
                {e.fileDeleted ? (
                  <div className="grid h-56 place-items-center bg-blush px-4 text-center text-sm text-muted">File deleted</div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- private, signed, short-lived URL
                  <img src={signedEvidenceUrl(e.id, session.address)} alt={`Screenshot ${i + 1}`} className="h-56 w-full bg-blush object-contain" />
                )}
                <p className="px-3 py-2.5 text-sm">
                  <span className="font-semibold">{e.kind === "primary" ? "Main screenshot" : "Supplementary"}</span>
                  <span className="hint block">
                    {e.width}×{e.height} · {formatBytes(e.bytes)} · {formatDateTime(e.createdAt)}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="hint mt-4">
          Only you and SCROLL reviewers can open these. Files are deleted {UPLOADS.retentionDays} days after a decision; the verified durations and a fingerprint of each file are kept.
        </p>
        <SubmissionActions id={s.id} status={status} hasFiles={liveFiles.length > 0} />
      </section>
    </>
  );
}
