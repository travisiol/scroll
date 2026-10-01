import Link from "next/link";
import { notFound } from "next/navigation";
import { ReviewPanel } from "@/components/admin/ReviewPanel";
import { Amount, PageTitle, PayoutPill, ReviewPill, TxLink } from "@/components/app/bits";
import { appByKey, PLATFORMS, type Platform } from "@/config/apps";
import { formatBytes } from "@/config/uploads";
import { formatDuration } from "@/core/duration";
import { HOLD_LABEL } from "@/core/status";
import { formatWeek } from "@/core/weeks";
import { formatDateTime } from "@/lib/format";
import { getPolicy } from "@/server/policies";
import { neighbouringSubmissions } from "@/server/review";
import { currentAdmin } from "@/server/session";
import { signedEvidenceUrl } from "@/server/storage";
import { submissionDetail } from "@/server/submissions";

export default async function AdminSubmission(props: PageProps<"/admin/submissions/[id]">) {
  const admin = await currentAdmin();
  if (!admin) return null;
  const { id } = await props.params;
  const detail = await submissionDetail(id, admin, true).catch(() => null);
  if (!detail) notFound();
  const { submission: s, owner, evidence, usage, decisions, allocations } = detail;
  const [policy, neighbours] = await Promise.all([s.policyVersionId ? getPolicy(s.policyVersionId) : null, neighbouringSubmissions(s.userId, s.id)]);
  const usageMap = Object.fromEntries(usage.map((u) => [u.app, u.minutes]));

  return (
    <>
      <p className="mb-3">
        <Link href="/admin" className="link text-[0.95rem]">
          ← Review queue
        </Link>
      </p>
      <PageTitle title={formatWeek(s.weekStart)} action={<ReviewPill status={s.status} />}>
        {PLATFORMS[s.platform as Platform]?.name ?? s.platform} · <span className="num">{owner}</span> · revision {s.revision} · submitted {formatDateTime(s.submittedAt)}
      </PageTitle>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <section aria-labelledby="shots" className="card card-pad self-start">
          <h2 id="shots" className="text-xl tracking-[-0.02em]">
            Screenshots
          </h2>
          <p className="hint mt-1">
            The user said this covers <strong className="font-semibold text-ink">{formatWeek(s.weekStart)}</strong>. Check the dates in the image.
          </p>
          <ul className="mt-4 grid gap-4 md:grid-cols-2">
            {evidence.map((e, i) => {
              const url = e.fileDeleted ? null : signedEvidenceUrl(e.id, admin.address);
              return (
                <li key={e.id} className="overflow-hidden rounded-2xl border border-line bg-white">
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer" aria-label={`Open screenshot ${i + 1} full size`}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- private, signed, short-lived URL */}
                      <img src={url} alt={`Screenshot ${i + 1}`} className="max-h-[36rem] w-full bg-blush object-contain" />
                    </a>
                  ) : (
                    <div className="grid h-56 place-items-center bg-blush text-sm text-muted">File deleted</div>
                  )}
                  <p className="px-3 py-2.5 text-sm">
                    <span className="font-semibold">{e.kind === "primary" ? "Main" : "Supplementary"}</span>
                    <span className="hint block">
                      {e.width}×{e.height} · {formatBytes(e.bytes)} · {formatDateTime(e.createdAt)}
                    </span>
                  </p>
                </li>
              );
            })}
          </ul>
          <p className="hint mt-4">Byte-identical files are refused at upload, across all wallets. A re-saved or re-cropped copy has a different fingerprint, so compare with this wallet&rsquo;s other weeks:</p>
          {neighbours.length ? (
            <ul className="mt-2 flex flex-wrap gap-2">
              {neighbours.map((n) => (
                <li key={n.id}>
                  <Link href={`/admin/submissions/${n.id}`} className="btn btn-quiet btn-sm">
                    {formatWeek(n.weekStart)} · {n.status.replace("_", " ")}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint mt-1">This wallet has no other submissions.</p>
          )}
        </section>

        <div className="grid gap-5 self-start">
          {s.status === "pending_review" ? (
            <ReviewPanel id={s.id} initialUsage={usageMap} policy={policy?.config ?? null} policyVersion={policy?.version ?? null} />
          ) : (
            <section className="card card-pad">
              <h2 className="text-xl tracking-[-0.02em]">Verified durations</h2>
              {usage.length ? (
                <ul className="mt-3 grid gap-2">
                  {usage.map((u) => (
                    <li key={u.app} className="flex justify-between gap-3">
                      <span className="font-semibold">{appByKey(u.app)?.name ?? u.app}</span>
                      <span className="text-muted">{formatDuration(u.minutes)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-muted">None recorded.</p>
              )}
              {s.reviewerNote && <p className="notice mt-4">Explanation shown to the user: {s.reviewerNote}</p>}
              <p className="hint mt-4">{s.status === "needs_changes" ? "Waiting for the user to resubmit." : "This submission is decided. Decisions can't be edited."}</p>
            </section>
          )}

          {allocations.length > 0 && (
            <section className="card card-pad">
              <h2 className="text-xl tracking-[-0.02em]">Allocations</h2>
              <ul className="mt-3 grid gap-3">
                {allocations.map((a) => (
                  <li key={a.id} className="rounded-xl border border-line bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Amount value={a.amount} decimals={a.decimals} ticker={a.ticker} />
                      <PayoutPill state={a.state} />
                    </div>
                    {a.holdReason && <p className="hint mt-1.5">{HOLD_LABEL[a.holdReason]}</p>}
                    {a.tx && (
                      <p className="mt-1.5 text-sm">
                        <TxLink tx={a.tx} />
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card card-pad">
            <h2 className="text-xl tracking-[-0.02em]">Decision history</h2>
            {decisions.length ? (
              <ul className="mt-3 grid gap-3 text-[0.95rem]">
                {decisions.map((d) => (
                  <li key={d.id}>
                    <span className="font-semibold">{d.action.replace("_", " ")}</span> <span className="text-muted">· rev {d.revision} · {formatDateTime(d.createdAt)}</span>
                    <span className="num hint block">{d.reviewer}</span>
                    {d.reason && <span className="block">{d.reason}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-muted">No decisions yet.</p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
