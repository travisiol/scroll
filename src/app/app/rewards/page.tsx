import Link from "next/link";
import { Amount, Empty, PageTitle, PayoutPill, TxLink } from "@/components/app/bits";
import { appsForTicker } from "@/config/apps";
import { CHAIN, TOKENS, explorerAddress } from "@/config/network";
import { BRAND } from "@/config/brand";
import { HOLD_LABEL } from "@/core/status";
import { formatWeek } from "@/core/weeks";
import { rewardTotals } from "@/server/dashboard";
import { currentSession } from "@/server/session";
import { payoutStatus } from "@/server/status";

export const metadata = { title: "Rewards" };

export default async function RewardsPage() {
  const session = await currentSession();
  if (!session) return null;
  const [totals, payouts] = await Promise.all([rewardTotals(session.userId), payoutStatus()]);
  const any = totals.some((t) => t.history.length > 0);

  return (
    <>
      <PageTitle title="Rewards">Each token is its own balance. Rewards are sent to your wallet automatically after approval; there is nothing to claim.</PageTitle>

      <p className="notice mb-6">
        <strong className="font-semibold">Payout availability.</strong> {payouts.message}
      </p>

      {!any && (
        <Empty title="No rewards yet">
          Rewards appear here once a submission is approved and allocated.
          <br />
          <Link href="/app/upload" className="link mt-3 inline-block">
            Upload your screen time
          </Link>
        </Empty>
      )}

      <div className="grid gap-5">
        {totals
          .filter((t) => t.history.length > 0)
          .map((t) => (
            <section key={t.ticker} aria-labelledby={`t-${t.ticker}`} className="card card-pad">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 id={`t-${t.ticker}`} className="num text-3xl font-medium tracking-[-0.02em]">
                    {t.ticker}
                  </h2>
                  <p className="hint mt-1">
                    {appsForTicker(t.ticker).map((a) => a.name).join(" + ")} ·{" "}
                    <a className="link" href={explorerAddress(TOKENS[t.ticker].address)} target="_blank" rel="noreferrer">
                        {TOKENS[t.ticker].name}
                      </a>
                  </p>
                </div>
                <dl className="flex gap-8 text-right">
                  <div>
                    <dt className="eyebrow">Allocated</dt>
                    <dd className="mt-1 text-xl">
                      <Amount value={t.allocated} decimals={t.decimals} ticker={t.ticker} />
                    </dd>
                  </div>
                  <div>
                    <dt className="eyebrow">Paid</dt>
                    <dd className="mt-1 text-xl">
                      <Amount value={t.paid} decimals={t.decimals} ticker={t.ticker} />
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="mt-5 overflow-x-auto">
                <table className="table min-w-[38rem] table-fixed [&_th:nth-child(4)]:w-[40%]">
                  <caption className="sr-only">{t.ticker} reward history</caption>
                  <thead>
                    <tr>
                      <th scope="col">Reporting week</th>
                      <th scope="col">Amount</th>
                      <th scope="col">Payout</th>
                      <th scope="col">Transaction</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.history.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <Link className="link" href={`/app/submissions/${a.submissionId}`}>
                            {formatWeek(a.weekStart)}
                          </Link>
                        </td>
                        <td>
                          <Amount value={a.amount} decimals={a.decimals} ticker={a.ticker} />
                        </td>
                        <td>
                          <PayoutPill state={a.state} />
                          {a.holdReason && <span className="hint mt-1.5 block max-w-xs">{HOLD_LABEL[a.holdReason]}</span>}
                        </td>
                        <td>
                          <TxLink tx={a.tx} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
      </div>

      <p className="hint mt-8 max-w-3xl">
        Amounts are token quantities on {CHAIN.name}. No fiat value is shown because SCROLL has no price source configured. {BRAND.funding} {BRAND.instruments}
      </p>
    </>
  );
}
