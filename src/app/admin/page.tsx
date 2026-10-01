import Link from "next/link";
import { Empty, PageTitle, ReviewPill } from "@/components/app/bits";
import { PLATFORMS, type Platform } from "@/config/apps";
import { REVIEW_LABEL, REVIEW_STATUSES, type ReviewStatus } from "@/core/status";
import { formatWeek } from "@/core/weeks";
import { formatDateTime, shortAddress } from "@/lib/format";
import { queueCounts, reviewQueue } from "@/server/review";
import { currentAdmin } from "@/server/session";

const TABS: (ReviewStatus | "all")[] = ["pending_review", "needs_changes", "approved", "rejected", "all"];

export default async function ReviewQueue(props: PageProps<"/admin">) {
  if (!(await currentAdmin())) return null;
  const query = await props.searchParams;
  const requested = typeof query.status === "string" ? query.status : "pending_review";
  const status = (requested === "all" || (REVIEW_STATUSES as readonly string[]).includes(requested) ? requested : "pending_review") as ReviewStatus | "all";
  const [rows, counts] = await Promise.all([reviewQueue(status), queueCounts()]);

  return (
    <>
      <PageTitle title="Review queue">Oldest first. Check the week, the supported apps and the durations, then decide.</PageTitle>
      <nav aria-label="Filter by status" className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link key={t} href={`/admin?status=${t}`} aria-current={t === status ? "page" : undefined} className={`btn btn-sm ${t === status ? "btn-dark" : "btn-quiet"}`}>
            {t === "all" ? "All submitted" : REVIEW_LABEL[t].label}
            {t !== "all" && <span className="num opacity-70">{counts[t]}</span>}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <Empty title={status === "pending_review" ? "Nothing waiting for review" : "No submissions here"}>New submissions appear as soon as users send them.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table min-w-[46rem]">
            <thead>
              <tr>
                <th scope="col">Wallet</th>
                <th scope="col">Reporting week</th>
                <th scope="col">Source</th>
                <th scope="col">Files</th>
                <th scope="col">Status</th>
                <th scope="col">Submitted</th>
                <th scope="col">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ submission: s, owner, files }) => (
                <tr key={s.id}>
                  <td className="num">{shortAddress(owner)}</td>
                  <td className="font-semibold">{formatWeek(s.weekStart)}</td>
                  <td>{PLATFORMS[s.platform as Platform]?.name ?? s.platform}</td>
                  <td className="num">{files}</td>
                  <td>
                    <ReviewPill status={s.status} />
                    {s.revision > 1 && <span className="hint ml-2">rev {s.revision}</span>}
                  </td>
                  <td className="text-muted">{formatDateTime(s.submittedAt)}</td>
                  <td className="text-right">
                    <Link className="link" href={`/admin/submissions/${s.id}`}>
                      {s.status === "pending_review" ? "Review" : "Open"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
