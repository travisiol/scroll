import { ActionButton } from "@/components/admin/ActionButton";
import { PolicyEditor } from "@/components/admin/PolicyEditor";
import { PageTitle } from "@/components/app/bits";
import { APPS, TICKERS } from "@/config/apps";
import { formatDuration } from "@/core/duration";
import { formatUnits } from "@/core/units";
import { formatDateTime, shortAddress } from "@/lib/format";
import { blankPolicy, listPolicies } from "@/server/policies";
import { currentAdmin } from "@/server/session";

export default async function PolicyPage() {
  if (!(await currentAdmin())) return null;
  const versions = await listPolicies();
  const published = versions.find((v) => v.status === "published") ?? null;
  const draft = versions.find((v) => v.status === "draft") ?? null;
  // A new draft starts from the published policy, or from an empty one. Never from invented numbers.
  const starting = draft?.config ?? (published ? { ...published.config, label: "" } : blankPolicy());

  return (
    <>
      <PageTitle title="Reward policy">Versioned. A published version can&rsquo;t be edited; each submission keeps the version in force when it was submitted.</PageTitle>

      {!published && (
        <p className="notice mb-5">
          <strong className="font-semibold">No policy is published.</strong> Submissions can be reviewed, but approvals allocate nothing until a policy is published. Publishing is an explicit step, and submissions made before it stay unallocated.
        </p>
      )}

      {published && (
        <section className="card card-pad mb-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl tracking-[-0.02em]">
              Published · version {published.version} <span className="font-normal text-muted">· {published.config.label}</span>
            </h2>
            <p className="hint">
              {formatDateTime(published.publishedAt)} · by <span className="num">{shortAddress(published.createdBy)}</span>
            </p>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="table min-w-[46rem]">
              <thead>
                <tr>
                  <th scope="col">Token</th>
                  <th scope="col">Per minute</th>
                  <th scope="col">Wallet cap / week</th>
                  <th scope="col">Pool limit / week</th>
                  <th scope="col">Min payout</th>
                  <th scope="col">App limits</th>
                </tr>
              </thead>
              <tbody>
                {TICKERS.map((t) => {
                  const r = published.config.tickers[t];
                  const d = published.config.network.tokens[t].decimals;
                  return (
                    <tr key={t} className={r.enabled ? "" : "opacity-50"}>
                      <th scope="row" className="num font-medium">
                        {t}
                        {!r.enabled && <span className="hint ml-2">off</span>}
                      </th>
                      <td className="num">{formatUnits(r.unitsPerMinute, d)}</td>
                      <td className="num">{formatUnits(r.walletWeeklyCap, d)}</td>
                      <td className="num">{formatUnits(r.weeklyPoolLimit, d)}</td>
                      <td className="num">{formatUnits(r.minPayout, d)}</td>
                      <td>
                        {APPS.filter((a) => a.ticker === t)
                          .map((a) => `${a.name} ${formatDuration(published.config.apps[a.key].maxMinutesPerWeek)}`)
                          .join(" · ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card card-pad">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl tracking-[-0.02em]">{draft ? `Draft · version ${draft.version}` : "New draft"}</h2>
          {draft && (
            <ActionButton
              path={`/api/admin/policy/${draft.id}/publish`}
              className="btn btn-primary btn-sm"
              confirm={`Publish version ${draft.version}? It becomes the policy for every submission made from now on${published ? ` and retires version ${published.version}` : ""}. It can't be edited afterwards.`}
            >
              Publish version {draft.version}
            </ActionButton>
          )}
        </div>
        <div className="mt-5">
          <PolicyEditor key={draft?.id ?? "new"} draftId={draft?.id ?? null} initial={starting} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xl tracking-[-0.02em]">All versions</h2>
        {versions.length === 0 ? (
          <p className="mt-2 text-muted">None yet.</p>
        ) : (
          <div className="card mt-3 overflow-x-auto">
            <table className="table min-w-[36rem]">
              <thead>
                <tr>
                  <th scope="col">Version</th>
                  <th scope="col">Label</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created</th>
                  <th scope="col">Published</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id}>
                    <td className="num">{v.version}</td>
                    <td>{v.config.label}</td>
                    <td>
                      <span className={`pill ${v.status === "published" ? "pill-good" : v.status === "draft" ? "pill-wait" : ""}`}>{v.status}</span>
                    </td>
                    <td className="text-muted">{formatDateTime(v.createdAt)}</td>
                    <td className="text-muted">{formatDateTime(v.publishedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
