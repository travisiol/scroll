import Link from "next/link";
import { Amount, Empty, PageTitle, PayoutPill, ReviewPill } from "@/components/app/bits";
import { appByKey, PLATFORMS, type Platform } from "@/config/apps";
import { UPLOADS } from "@/config/uploads";
import { formatDuration } from "@/core/duration";
import { REVIEW_LABEL, type ReviewStatus } from "@/core/status";
import { completedWeeks, formatWeek } from "@/core/weeks";
import { formatDateTime } from "@/lib/format";
import { approvedUsage, rewardTotals } from "@/server/dashboard";
import { publishedPolicy } from "@/server/policies";
import { currentSession } from "@/server/session";
import { payoutStatus } from "@/server/status";
import { listSubmissions } from "@/server/submissions";

export default async function Dashboard() {
  const session = await currentSession();
  if (!session) return null;
  const [subs, totals, usage, payouts, policy] = await Promise.all([listSubmissions(session.userId), rewardTotals(session.userId), approvedUsage(session.userId), payoutStatus(), publishedPolicy()]);

  const [latestWeek] = completedWeeks(new Date(), UPLOADS.weeksBack);
  const current = subs.find((s) => s.weekStart === latestWeek);
  const needsChanges = subs.find((s) => s.status === "needs_changes");
  const draft = subs.find((s) => s.status === "draft");
  const withRewards = totals.filter((t) => t.allocated > BigInt(0));

  let next: { title: string; body: string; href: string; cta: string };
  if (needsChanges) {
    next = { title: "A reviewer asked for changes", body: `Your submission for ${formatWeek(needsChanges.weekStart)} needs an update before it can be approved.`, href: `/app/upload?id=${needsChanges.id}`, cta: "Update submission" };
  } else if (draft) {
    next = { title: "Finish your draft", body: `Your draft for ${formatWeek(draft.weekStart)} hasn't been sent for review yet.`, href: `/app/upload?id=${draft.id}`, cta: "Continue draft" };
  } else if (!current) {
    next = { title: "Upload last week's screen time", body: `${formatWeek(latestWeek)} is ready to report.`, href: "/app/upload", cta: "Upload your screen time" };
  } else if (current.status === "pending_review") {
    next = { title: "Nothing to do right now", body: "Your latest submission is waiting for a reviewer. We don't promise a review time, and you'll see the result here.", href: `/app/submissions/${current.id}`, cta: "View submission" };
  } else {
    next = { title: "You're up to date", body: "Last week is decided. Come back after this week ends to report it.", href: `/app/submissions/${current.id}`, cta: "View submission" };
  }

  return (
    <>
      <PageTitle title="Dashboard" />

      <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <section aria-labelledby="next" className="rounded-[1.5rem] bg-ink p-6 text-page sm:p-8">
          <p className="eyebrow !text-[#C9B6CF]">Next step</p>
          <h2 id="next" className="mt-3 text-3xl">
            {next.title}
          </h2>
          <p className="mt-3 max-w-lg leading-relaxed text-[#D9C8DE]">{next.body}</p>
          <Link href={next.href} className="btn btn-primary mt-6">
            {next.cta}
          </Link>
        </section>

        <section aria-labelledby="week" className="card card-pad">
          <p className="eyebrow">Latest reporting week</p>
          <h2 id="week" className="mt-3 text-2xl tracking-[-0.025em]">
            {formatWeek(latestWeek)}
          </h2>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {current ? <ReviewPill status={current.status} /> : <span className="pill">Not submitted</span>}
          </div>
          <p className="hint mt-3">{current ? REVIEW_LABEL[current.status as ReviewStatus].hint : "You haven't reported this week."}</p>
          <dl className="mt-5 border-t border-line pt-4 text-[0.95rem]">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Connected wallet</dt>
              <dd className="num break-all text-right">{session.address}</dd>
            </div>
          </dl>
        </section>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <section aria-labelledby="usage" className="card card-pad">
          <h2 id="usage" className="text-xl tracking-[-0.02em]">
            Eligible reviewed usage
          </h2>
          <p className="hint mt-1">Verified by a reviewer, across approved submissions.</p>
          {usage.length ? (
            <ul className="mt-4 grid gap-2.5">
              {usage.map((u) => (
                <li key={u.app} className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold">{appByKey(u.app)?.name ?? u.app}</span>
                  <span className="text-muted">{formatDuration(u.minutes)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-muted">No verified usage yet.</p>
          )}
        </section>

        <section aria-labelledby="allocated" className="card card-pad">
          <h2 id="allocated" className="text-xl tracking-[-0.02em]">
            Rewards allocated
          </h2>
          <p className="hint mt-1">Everything allocated to this wallet, paid or not yet.</p>
          {withRewards.length ? (
            <ul className="mt-4 grid gap-2.5">
              {withRewards.map((t) => (
                <li key={t.ticker}>
                  <Amount value={t.allocated} decimals={t.decimals} ticker={t.ticker} className="text-lg" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-muted">Nothing allocated yet.</p>
          )}
        </section>

        <section aria-labelledby="paid" className="card card-pad">
          <h2 id="paid" className="text-xl tracking-[-0.02em]">
            Rewards paid
          </h2>
          <p className="hint mt-1">Transfers confirmed on the network.</p>
          {withRewards.some((t) => t.paid > BigInt(0)) ? (
            <ul className="mt-4 grid gap-2.5">
              {withRewards
                .filter((t) => t.paid > BigInt(0))
                .map((t) => (
                  <li key={t.ticker}>
                    <Amount value={t.paid} decimals={t.decimals} ticker={t.ticker} className="text-lg" />
                  </li>
                ))}
            </ul>
          ) : (
            <p className="mt-4 text-muted">Nothing paid yet.</p>
          )}
          <p className="mt-4">
            <Link href="/app/rewards" className="link text-[0.95rem]">
              See transactions
            </Link>
          </p>
        </section>
      </div>

      <p className="notice mt-5">
        <strong className="font-semibold">Payout availability.</strong> {payouts.message}
        {!policy && " No reward policy is published yet, so approved submissions aren't allocated rewards for now."}
      </p>

      <section aria-labelledby="history" className="mt-10">
        <h2 id="history" className="text-2xl tracking-[-0.025em]">
          Submission history
        </h2>
        <div className="mt-4">
          {subs.length === 0 ? (
            <Empty title="No submissions yet">
              Your weekly reports will appear here with their review status.
              <br />
              <Link href="/app/upload" className="link mt-3 inline-block">
                Upload your first one
              </Link>
            </Empty>
          ) : (
            <div className="card overflow-x-auto">
              <table className="table min-w-[40rem]">
                <thead>
                  <tr>
                    <th scope="col">Reporting week</th>
                    <th scope="col">Source</th>
                    <th scope="col">Review</th>
                    <th scope="col">Payout</th>
                    <th scope="col">Submitted</th>
                    <th scope="col">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {subs.map((s) => {
                    const mine = totals.flatMap((t) => t.history).filter((a) => a.submissionId === s.id);
                    return (
                      <tr key={s.id}>
                        <td className="font-semibold">{formatWeek(s.weekStart)}</td>
                        <td>{PLATFORMS[s.platform as Platform]?.name ?? s.platform}</td>
                        <td>
                          <ReviewPill status={s.status} />
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1.5">{mine.length ? mine.map((a) => <PayoutPill key={a.id} state={a.state} ticker={a.ticker} />) : <PayoutPill state="not_allocated" />}</div>
                        </td>
                        <td className="text-muted">{formatDateTime(s.submittedAt)}</td>
                        <td className="text-right">
                          <Link className="link" href={EDITABLE.includes(s.status) ? `/app/upload?id=${s.id}` : `/app/submissions/${s.id}`}>
                            {EDITABLE.includes(s.status) ? "Continue" : "Open"}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

const EDITABLE = ["draft", "needs_changes"];
