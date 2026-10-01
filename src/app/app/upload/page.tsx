import { redirect } from "next/navigation";
import { PageTitle } from "@/components/app/bits";
import { UploadFlow, type UploadInitial } from "@/components/app/UploadFlow";
import { UPLOADS } from "@/config/uploads";
import { completedWeeks, formatWeek } from "@/core/weeks";
import { publishedPolicy } from "@/server/policies";
import { currentSession } from "@/server/session";
import { signedEvidenceUrl } from "@/server/storage";
import { listSubmissions, submissionDetail } from "@/server/submissions";

export const metadata = { title: "Upload" };

export default async function UploadPage(props: PageProps<"/app/upload">) {
  const session = await currentSession();
  if (!session) return null;
  const query = await props.searchParams;
  const id = typeof query.id === "string" ? query.id : null;

  const [subs, policy] = await Promise.all([listSubmissions(session.userId), publishedPolicy()]);
  const weeks = completedWeeks(new Date(), UPLOADS.weeksBack).map((weekStart) => {
    const existing = subs.find((s) => s.weekStart === weekStart);
    return { weekStart, label: formatWeek(weekStart), existing: existing ? { id: existing.id, status: existing.status } : null };
  });

  let initial: UploadInitial | null = null;
  if (id) {
    const detail = await submissionDetail(id, session).catch(() => null);
    if (!detail) redirect("/app/upload");
    if (detail.submission.status !== "draft" && detail.submission.status !== "needs_changes") redirect(`/app/submissions/${id}`);
    initial = {
      id,
      platform: detail.submission.platform as UploadInitial["platform"],
      weekStart: detail.submission.weekStart,
      weekLabel: formatWeek(detail.submission.weekStart),
      status: detail.submission.status,
      reviewerNote: detail.submission.reviewerNote,
      evidence: detail.evidence.filter((e) => !e.fileDeleted).map((e) => ({ id: e.id, kind: e.kind, bytes: e.bytes, width: e.width, height: e.height, url: signedEvidenceUrl(e.id, session.address) })),
    };
  }

  return (
    <>
      <PageTitle title={initial?.status === "needs_changes" ? "Update your submission" : "Upload your screen time"}>
        One submission per week. A person reviews it before any reward is allocated.
      </PageTitle>
      <UploadFlow key={initial?.id ?? "new"} weeks={weeks} initial={initial} policyPublished={Boolean(policy)} />
    </>
  );
}
