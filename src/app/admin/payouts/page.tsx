import Link from "next/link";
import { ActionButton } from "@/components/admin/ActionButton";
import { Amount, Empty, PageTitle, TxLink } from "@/components/app/bits";
import { formatDateTime, shortAddress } from "@/lib/format";
import { listPayoutJobs } from "@/server/payouts/worker";
import { currentAdmin } from "@/server/session";
import { payoutStatus } from "@/server/status";

const JOB_TONE: Record<string, string> = { queued: "pill-wait", submitted: "pill-wait", confirmed: "pill-good", failed: "pill-bad" };

export default async function PayoutsPage() {
  if (!(await currentAdmin())) return null;
  const [jobs, status] = await Promise.all([listPayoutJobs(), payoutStatus()]);
  const failed = jobs.filter((j) => j.job.state === "failed");
  const open = jobs.filter((j) => j.job.state === "queued" || j.job.state === "submitted");
  const done = jobs.filter((j) => j.job.state === "confirmed");
  const canRun = status.state === "ready";

  return (
    <>
      <PageTitle
        title="Payouts"
        action={
          <ActionButton path="/api/admin/payouts/run" className="btn btn-dark" describe="payouts">
            Run payouts now
          </ActionButton>
        }
      >
        One job per allocation. A transfer is signed and recorded before it is sent, reconciled by hash after any interruption, and counted as paid only when confirmed.
      </PageTitle>

      <div className={`notice mb-6 ${canRun ? "" : "notice-bad"}`}>
        <strong className="font-semibold">{canRun ? "Live transfers are on." : "Live transfers are not running."}</strong> {status.message}
        {status.setup.length > 0 && (
          <ul className="mt-2 list-disc pl-5">
            {status.setup.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        )}
      </div>

      <Section title={`Failed · ${failed.length}`} empty="No failed payouts." rows={failed} retry />
      <Section title={`In progress · ${open.length}`} empty="Nothing queued or awaiting confirmation." rows={open} />
      <Section title={`Confirmed · ${done.length}`} empty="No confirmed payouts yet." rows={done} />
    </>
  );
}

type Row = Awaited<ReturnType<typeof listPayoutJobs>>[number];

function Section({ title, empty, rows, retry = false }: { title: string; empty: string; rows: Row[]; retry?: boolean }) {
  return (
    <section className="mb-8">
      <h2 className="text-xl tracking-[-0.02em]">{title}</h2>
      <div className="mt-3">
        {rows.length === 0 ? (
          <Empty title={empty} />
        ) : (
          <div className="card overflow-x-auto">
            <table className="table min-w-[56rem]">
              <thead>
                <tr>
                  <th scope="col">Allocation</th>
                  <th scope="col">To</th>
                  <th scope="col">Job</th>
                  <th scope="col">Transfers</th>
                  <th scope="col">Last error</th>
                  <th scope="col">Updated</th>
                  {retry && (
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ job, allocation: a, attempts }) => (
                  <tr key={job.id}>
                    <td>
                      <Amount value={a.amount} decimals={a.decimals} ticker={a.ticker} />
                      <Link href={`/admin/submissions/${a.submissionId}`} className="link block text-sm">
                        Submission
                      </Link>
                    </td>
                    <td className="num">{shortAddress(a.recipient)}</td>
                    <td>
                      <span className={`pill ${JOB_TONE[job.state] ?? ""}`}>{job.state}</span>
                      <span className="hint block">runs {job.runs}</span>
                    </td>
                    <td>
                      {attempts.length === 0 ? (
                        <span className="text-muted">None signed</span>
                      ) : (
                        <ul className="grid gap-1.5">
                          {attempts.map((t) => (
                            <li key={t.id} className="text-sm">
                              <span className="font-semibold">{t.state}</span> · nonce <span className="num">{t.nonce}</span>
                              <br />
                              <TxLink tx={{ hash: t.txHash }} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="max-w-xs text-sm text-muted">{job.lastError ?? "—"}</td>
                    <td className="whitespace-nowrap text-muted">{formatDateTime(job.updatedAt)}</td>
                    {retry && (
                      <td>
                        <ActionButton path={`/api/admin/payouts/${job.id}/retry`} confirm="Queue a new transfer for this allocation? Only do this after checking the previous transfer did not arrive.">
                          Retry
                        </ActionButton>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
