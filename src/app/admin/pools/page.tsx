import { ActionButton } from "@/components/admin/ActionButton";
import { FundForm } from "@/components/admin/FundForm";
import { Amount, PageTitle } from "@/components/app/bits";
import { TICKERS, type Ticker } from "@/config/apps";
import { TOKENS } from "@/config/network";
import { formatDateTime, shortAddress } from "@/lib/format";
import { listPools, poolMovementsFor } from "@/server/allocations";
import { chainCheck } from "@/server/chaincheck";
import { currentAdmin } from "@/server/session";

export default async function PoolsPage() {
  if (!(await currentAdmin())) return null;
  const [pools, movements, chain] = await Promise.all([listPools(), poolMovementsFor(60), chainCheck()]);
  const decimals = Object.fromEntries(TICKERS.map((t) => [t, TOKENS[t].decimals])) as Record<Ticker, number>;
  const waiting = pools.reduce((n, p) => n + p.awaitingCount, 0);

  return (
    <>
      <PageTitle title="Reward pools">The ledger of what SCROLL has set aside per token. Available = funded − reserved − paid. Approvals reserve from it atomically and never overdraw it.</PageTitle>

      <div className="card overflow-x-auto">
        <table className="table min-w-[52rem]">
          <thead>
            <tr>
              <th scope="col">Token</th>
              <th scope="col">Funded</th>
              <th scope="col">Reserved</th>
              <th scope="col">Paid</th>
              <th scope="col">Available</th>
              <th scope="col">Awaiting funding</th>
              <th scope="col">Treasury on-chain</th>
            </tr>
          </thead>
          <tbody>
            {pools.map((p) => {
              const d = decimals[p.ticker];
              const onchain = chain.tokens.find((t) => t.ticker === p.ticker);
              const owed = BigInt(p.reserved);
              const short = onchain?.treasuryBalance != null && BigInt(onchain?.treasuryBalance) < owed;
              return (
                <tr key={p.ticker}>
                  <th scope="row" className="num font-medium">
                    {p.ticker}
                  </th>
                  <td>
                    <Amount value={p.funded} decimals={d} ticker="" />
                  </td>
                  <td>
                    <Amount value={p.reserved} decimals={d} ticker="" />
                  </td>
                  <td>
                    <Amount value={p.paid} decimals={d} ticker="" />
                  </td>
                  <td className="font-semibold">
                    <Amount value={p.available} decimals={d} ticker="" />
                  </td>
                  <td>
                    {p.awaitingCount ? (
                      <span className="pill pill-action">
                        <Amount value={p.awaitingFunding} decimals={d} ticker="" /> · {p.awaitingCount}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                                      <td>
                      {onchain?.treasuryBalance != null ? (
                        <span className={short ? "text-bad" : ""}>
                          <Amount value={onchain?.treasuryBalance} decimals={d} ticker="" />
                          {short && <span className="hint block !text-bad">Less than reserved</span>}
                        </span>
                      ) : (
                        <span className="hint">{chain.treasury ? (onchain?.problem ?? "Unavailable") : "No treasury key"}</span>
                      )}
                    </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="card card-pad mt-5">
        <h2 className="text-xl tracking-[-0.02em]">Record funding</h2>
        <p className="hint mt-1 max-w-3xl">
          This records that the treasury wallet holds tokens for rewards. It does not move tokens. {"Send the tokens to the treasury wallet first, then record the same amount here; the worker also checks the real balance before every transfer."}
        </p>
        <div className="mt-4">
          <FundForm decimals={decimals} />
        </div>
        {waiting > 0 && (
          <div className="mt-5 border-t border-line pt-4">
            <ActionButton path="/api/admin/pools/retry" describe="reservations">
              Re-check {waiting} waiting allocation{waiting === 1 ? "" : "s"}
            </ActionButton>
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-xl tracking-[-0.02em]">Movements</h2>
        {movements.length === 0 ? (
          <p className="mt-2 text-muted">No funding or reservations yet.</p>
        ) : (
          <div className="card mt-3 overflow-x-auto">
            <table className="table min-w-[44rem]">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Token</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Amount</th>
                  <th scope="col">By</th>
                  <th scope="col">Note</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap text-muted">{formatDateTime(m.createdAt)}</td>
                    <td className="num">{m.ticker}</td>
                    <td>{m.kind}</td>
                    <td>
                      <Amount value={m.amount} decimals={decimals[m.ticker as Ticker] ?? 18} ticker="" />
                    </td>
                    <td className="num">{m.actor.startsWith("0x") ? shortAddress(m.actor) : m.actor}</td>
                    <td className="max-w-xs break-words text-muted">{m.note ? (m.note.length > 48 ? `${m.note.slice(0, 20)}…${m.note.slice(-8)}` : m.note) : (m.allocationId ?? "")}</td>
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
