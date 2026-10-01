import { ActionButton } from "@/components/admin/ActionButton";
import { Amount, PageTitle } from "@/components/app/bits";
import { TICKERS } from "@/config/apps";
import { CHAIN, PAYOUT_CONFIRMATIONS, TOKENS, VERIFIED_AT_BLOCK, explorerAddress } from "@/config/network";
import { UPLOADS } from "@/config/uploads";
import { formatDateTime } from "@/lib/format";
import { dbInfo } from "@/db/client";
import { chainCheck } from "@/server/chaincheck";
import { adminAddresses, cronSecret } from "@/server/env";
import { currentAdmin } from "@/server/session";
import { getSettings } from "@/server/settings";
import { payoutStatus } from "@/server/status";

export default async function NetworkPage() {
  if (!(await currentAdmin())) return null;
  const [chain, settings, status, db] = await Promise.all([chainCheck(), getSettings(), payoutStatus(), dbInfo()]);

  const setup: { label: string; ok: boolean; detail: string }[] = [
    { label: "Database", ok: db.driver === "postgres", detail: db.driver === "postgres" ? `PostgreSQL at ${db.location}` : `Embedded Postgres (PGlite) on local disk. Fine on one machine; set DATABASE_URL to a PostgreSQL server for production.` },
    { label: "Screenshot storage", ok: false, detail: "Private local disk (data/local/evidence), served only through signed, authenticated URLs. For production, implement the StorageDriver in src/server/storage.ts against a private bucket." },
    { label: "APP_SECRET", ok: Boolean(process.env.APP_SECRET && process.env.APP_SECRET.length >= 32), detail: "Signs screenshot URLs. Required in production (32+ characters)." },
    { label: "APP_ORIGINS", ok: Boolean(process.env.APP_ORIGINS), detail: process.env.APP_ORIGINS ? `Sign-in accepted from: ${process.env.APP_ORIGINS}` : "Not set: sign-in accepts the host each request arrives on. Set it to your public origin in production." },
    { label: "Reviewer allowlist", ok: adminAddresses().length > 0, detail: `${adminAddresses().length} wallet(s) in ADMIN_WALLETS.` },
    { label: "RPC endpoint", ok: Boolean(process.env.RPC_URL), detail: process.env.RPC_URL ? `RPC_URL → ${chain.rpc}` : `Using the public endpoint (${chain.rpc}), which the docs call rate-limited and not for production. Set RPC_URL.` },
    { label: "Treasury wallet", ok: Boolean(chain.treasury), detail: chain.treasury ? chain.treasury : "TREASURY_PRIVATE_KEY is not set. Without it no transfer can be signed." },
    { label: "Scheduled worker", ok: Boolean(cronSecret()), detail: cronSecret() ? "CRON_SECRET is set: run `npm run worker` or call POST /api/cron/payouts on a schedule." : "CRON_SECRET is not set: payouts and retention only run when an admin presses the button." },
  ];

  return (
    <>
      <PageTitle title="Network and tokens">The verified settlement configuration, read back from the chain, and the switch for sending transfers.</PageTitle>

      <section className="card card-pad">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl tracking-[-0.02em]">Payout switch</h2>
            <p className="mt-2 max-w-2xl leading-relaxed text-muted">{status.message}</p>
            {status.setup.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-[0.95rem]">
                {status.setup.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            )}
          </div>
          <ActionButton
            path="/api/admin/settings"
            body={{ payoutsEnabled: !settings.payoutsEnabled }}
            className={settings.payoutsEnabled ? "btn btn-danger" : "btn btn-dark"}
            confirm={settings.payoutsEnabled ? "Pause payouts? Queued transfers will wait." : "Turn on payouts? Queued allocations will be sent from the treasury wallet as real token transfers."}
          >
            {settings.payoutsEnabled ? "Pause payouts" : "Turn payouts on"}
          </ActionButton>
        </div>
      </section>

      <section className="card card-pad mt-5">
        <h2 className="text-xl tracking-[-0.02em]">{CHAIN.name}</h2>
        <dl className="mt-3 grid gap-2 text-[0.95rem] sm:grid-cols-2">
          <div>
            <dt className="text-muted">Chain ID</dt>
            <dd className="num">{CHAIN.id}</dd>
          </div>
          <div>
            <dt className="text-muted">Live check ({formatDateTime(chain.at)})</dt>
            <dd className={chain.chainOk ? "text-good" : "text-bad"}>{chain.chainDetail}</dd>
          </div>
          <div>
            <dt className="text-muted">Explorer</dt>
            <dd>{CHAIN.explorerUrl}</dd>
          </div>
          <div>
            <dt className="text-muted">Confirmations before “paid”</dt>
            <dd className="num">{PAYOUT_CONFIRMATIONS}</dd>
          </div>
          {chain.treasury && (
            <div>
              <dt className="text-muted">Treasury gas balance</dt>
              <dd>{chain.treasuryEth !== null ? <Amount value={chain.treasuryEth} decimals={18} ticker="ETH" /> : "Unavailable"}</dd>
            </div>
          )}
        </dl>
        <div className="mt-5 overflow-x-auto">
          <table className="table min-w-[48rem]">
            <caption className="sr-only">Reward tokens</caption>
            <thead>
              <tr>
                <th scope="col">Token</th>
                <th scope="col">Contract</th>
                <th scope="col">Configured</th>
                <th scope="col">On-chain now</th>
              </tr>
            </thead>
            <tbody>
              {TICKERS.map((t) => {
                const live = chain.tokens.find((x) => x.ticker === t);
                return (
                  <tr key={t}>
                    <th scope="row" className="num font-medium">
                      {t}
                      <span className="hint block font-sans font-normal">{TOKENS[t].name}</span>
                    </th>
                    <td>
                      <a className="link num text-[0.85rem] break-all" href={explorerAddress(TOKENS[t].address)} target="_blank" rel="noreferrer">
                        {TOKENS[t].address}
                      </a>
                    </td>
                    <td className="num">{TOKENS[t].decimals} decimals</td>
                    <td>
                      {live?.ok ? (
                        <span className="pill pill-good">
                          {live.symbol} · {live.decimals} decimals
                        </span>
                      ) : (
                        <span className="pill pill-bad">{live?.problem ?? "Not checked"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="hint mt-3 max-w-3xl">
          Addresses come from Robinhood&rsquo;s official asset list and were first read on chain at block {VERIFIED_AT_BLOCK.toLocaleString("en-US")}. They are fixed in <span className="num">src/config/network.ts</span> and can&rsquo;t be edited here, so a typo can&rsquo;t redirect payouts. Whether the issuer lets a given wallet hold or receive a token is not something this check can see: the worker simulates each transfer before signing, and a refusal shows up as a setup error on the payout, with nothing sent.
        </p>
      </section>

      <section className="card card-pad mt-5">
        <h2 className="text-xl tracking-[-0.02em]">Setup</h2>
        <ul className="mt-3 grid gap-3">
          {setup.map((s) => (
            <li key={s.label} className="flex gap-3">
              <span className={`pill mt-0.5 shrink-0 ${s.ok ? "pill-good" : "pill-action"}`}>{s.ok ? "OK" : "To do"}</span>
              <span>
                <span className="font-semibold">{s.label}.</span> <span className="break-words text-muted">{s.detail}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-5 border-t border-line pt-4">
          <ActionButton path="/api/admin/retention/run" confirm={`Delete screenshot files of submissions decided more than ${UPLOADS.retentionDays} days ago?`} describe="retention">
            Run retention now
          </ActionButton>
        </div>
      </section>
    </>
  );
}
