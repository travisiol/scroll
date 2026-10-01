import { PageTitle } from "@/components/app/bits";
import { SessionControls } from "@/components/app/SessionControls";
import { CHAIN } from "@/config/network";
import { UPLOADS } from "@/config/uploads";
import { currentSession } from "@/server/session";
import { SIGNED_URL_TTL_SECONDS } from "@/server/storage";
import { payoutStatus } from "@/server/status";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await currentSession();
  if (!session) return null;
  const payouts = await payoutStatus();

  return (
    <>
      <PageTitle title="Settings" />
      <div className="grid max-w-3xl gap-5">
        <section aria-labelledby="wallet" className="card card-pad">
          <h2 id="wallet" className="text-xl tracking-[-0.02em]">
            Wallet
          </h2>
          <p className="num mt-3 break-all text-lg">{session.address}</p>
          <p className="hint mt-2">
            {"This wallet is your account and the address rewards are sent to. To use a different wallet, sign out and sign in with it: each wallet is a separate account."}
          </p>
          <SessionControls />
        </section>

        <section aria-labelledby="network" className="card card-pad">
          <h2 id="network" className="text-xl tracking-[-0.02em]">
            Network and payouts
          </h2>
          <dl className="mt-3 grid gap-2 text-[0.95rem]">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Settlement network</dt>
              <dd>
                {CHAIN.name} · chain ID <span className="num">{CHAIN.id}</span>
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Payout model</dt>
              <dd>Automatic after approval</dd>
            </div>
          </dl>
          <p className="notice mt-4">{payouts.message}</p>
          <p className="hint mt-3">You don&rsquo;t need to switch networks or hold anything to use SCROLL. Your account works whether or not the network is reachable.</p>
        </section>

        <section aria-labelledby="privacy" className="card card-pad">
          <h2 id="privacy" className="text-xl tracking-[-0.02em]">
            Your screenshots
          </h2>
          <ul className="mt-3 grid gap-2.5 leading-relaxed text-muted">
            <li>Stored privately. Only you and SCROLL reviewers can open them, through links that expire after {SIGNED_URL_TTL_SECONDS / 60} minutes.</li>
            <li>Used only to verify the week, the apps and the durations.</li>
            <li>Deleted automatically {UPLOADS.retentionDays} days after a decision. You can delete them sooner from any decided submission, and delete a draft entirely.</li>
            <li>The verified durations, the decision and a fingerprint of each file are kept, so the same screenshot can&rsquo;t be reused.</li>
          </ul>
        </section>

        <section aria-labelledby="signing" className="card card-pad">
          <h2 id="signing" className="text-xl tracking-[-0.02em]">
            What SCROLL asks your wallet for
          </h2>
          <ul className="mt-3 grid gap-2.5 leading-relaxed text-muted">
            <li>One signature when you sign in. It is free, names this site, and expires in minutes.</li>
            <li>Never a transaction, a token approval or a spending permission. If you see one of those on this site, decline it.</li>
          </ul>
        </section>
      </div>
    </>
  );
}
