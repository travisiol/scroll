import Link from "next/link";
import { HeroArt } from "@/components/home/HeroArt";
import { Logo } from "@/components/Logo";
import { SiteHeader, UploadCta } from "@/components/SiteHeader";
import { APPS, TICKERS, appsForTicker } from "@/config/apps";
import { BRAND } from "@/config/brand";
import { CHAIN, TOKENS } from "@/config/network";
import { ACCEPTED_MIME, UPLOADS, formatBytes } from "@/config/uploads";
import { formatDuration } from "@/core/duration";
import { formatUnits } from "@/core/units";
import { formatDateTime } from "@/lib/format";
import { publishedPolicy } from "@/server/policies";
import { SIGNED_URL_TTL_SECONDS } from "@/server/storage";
import { payoutStatus } from "@/server/status";

export const dynamic = "force-dynamic";

const STEPS = ["Use your favorite apps", "Upload your screen time", "Collect stock rewards"];

export default async function Home() {
  const [policy, payouts] = await Promise.all([publishedPolicy(), payoutStatus()]);
  const formats = Object.values(ACCEPTED_MIME).map((m) => m.label);
  const enabled = policy ? TICKERS.filter((t) => policy.config.tickers[t].enabled) : [];

  const faq: { q: string; a: React.ReactNode }[] = [
    {
      q: "What screenshots can I upload?",
      a: (
        <>
          A screenshot of your weekly report from iOS Screen Time or Android Digital Wellbeing, for one of the last {UPLOADS.weeksBack} completed weeks. It needs to show the app names, each app&rsquo;s time, and the week it covers. {formats.join(", ")} files up to {formatBytes(UPLOADS.maxBytes)}. If one screenshot can&rsquo;t show everything, add up to {UPLOADS.maxFilesPerSubmission - 1} more to the same submission. Crop out anything private that isn&rsquo;t needed.
        </>
      ),
    },
    {
      q: "Which apps are supported?",
      a: (
        <>
          {APPS.map((a) => a.name).join(", ")}. Each one maps to a stock token: {TICKERS.map((t) => `${appsForTicker(t).map((a) => a.name).join(" + ")} → ${t}`).join(", ")}. Instagram and Facebook time is added together into one META allocation. Time in other apps doesn&rsquo;t count.
        </>
      ),
    },
    {
      q: "How are rewards calculated?",
      a: policy ? (
        <>
          By the published reward policy (version {policy.version}, shown above). A reviewer verifies your minutes per app. Each app counts up to its weekly limit, the minutes are multiplied by that token&rsquo;s rate, and the result is capped per wallet per week. Each token also has a weekly pool limit, and an allocation can only be reserved if the pool holds enough. The policy in force when you submit is the one used for that week, even if it changes later.
        </>
      ) : (
        <>
          By a published reward policy: a rate per eligible minute for each token, a weekly limit per app, a cap per wallet, and a weekly pool limit. No policy is published yet, so nothing is allocated yet. We won&rsquo;t quote a rate until one is.
        </>
      ),
    },
    {
      q: "When do I receive rewards?",
      a: (
        <>
          After a person reviews and approves your submission. Uploading does not create a payout, and we don&rsquo;t promise a review time. Once approved, your allocation is reserved from the pool and sent to your wallet automatically; there is nothing to claim. A reward counts as paid only when its transfer is confirmed on {CHAIN.name}. Right now: {payouts.message}
        </>
      ),
    },
    {
      q: "Do I need to connect a wallet?",
      a: (
        <>
          Yes. Your wallet is your account and the address rewards are sent to. You sign in by signing a short message, which is free and can&rsquo;t move funds. SCROLL never asks for a token approval or spending permission to sign in or upload.
        </>
      ),
    },
    {
      q: "Are these companies affiliated with SCROLL?",
      a: <>No. {BRAND.funding} Their names are used only to say which app maps to which token.</>,
    },
    {
      q: "How is my screenshot stored and used?",
      a: (
        <>
          It is stored privately and used only to verify your usage. Only you and SCROLL reviewers can open it, through links that expire after {SIGNED_URL_TTL_SECONDS / 60} minutes. Files are deleted {UPLOADS.retentionDays} days after a decision, and you can delete them yourself as soon as a submission is decided. We keep the verified durations, the decision and a fingerprint of the file, so the same screenshot can&rsquo;t be reused.
        </>
      ),
    },
    {
      q: "What happens if a submission is rejected?",
      a: (
        <>
          You&rsquo;ll see the reviewer&rsquo;s reason on the submission. A rejection is final for that week and nothing is allocated. If the problem is fixable, such as a cropped date range, the reviewer asks for changes instead, and you can add or replace screenshots and resubmit the same submission.
        </>
      ),
    },
  ];

  return (
    <>
      <SiteHeader />
      <main id="main">
        {/* Hero */}
        <section className="shell grid items-center gap-x-10 gap-y-12 pb-16 pt-8 lg:grid-cols-[1.08fr_0.92fr] lg:pb-24 lg:pt-10">
          <div>
            <h1 className="rise text-[clamp(3.4rem,7.25vw,7rem)] leading-[0.95] tracking-[-0.045em]">
              <span className="block whitespace-nowrap">You scroll it.</span>
              <span className="block">Now own</span>
              <span className="block">a piece.</span>
            </h1>
            <p className="rise rise-2 mt-7 max-w-[38rem] text-[clamp(1.2rem,1.55vw,1.5rem)] leading-snug text-muted lg:mt-9">{BRAND.description}</p>
            <div className="rise rise-3 mt-9 flex flex-wrap items-center gap-x-8 gap-y-5 lg:mt-11">
              <UploadCta className="btn btn-primary btn-lg max-sm:w-full" />
              <Link href="#how-it-works" className="link text-[1.0625rem]">
                See how it works
              </Link>
            </div>
          </div>
          <div className="rise rise-4">
            <HeroArt />
          </div>
        </section>

        {/* Steps strip */}
        <section aria-label="Three steps" className="shell">
          <ol className="grid border-y border-line sm:grid-cols-3">
            {STEPS.map((label, i) => (
              <li key={label} className="flex items-baseline gap-4 border-line py-6 max-sm:border-b max-sm:last:border-b-0 sm:py-8 sm:pr-6 sm:[&:not(:first-child)]:border-l sm:[&:not(:first-child)]:pl-8">
                <span className="num text-base font-medium text-coral">0{i + 1}</span>
                <span className="text-[clamp(1.15rem,1.6vw,1.5rem)] font-semibold tracking-[-0.02em]">{label}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* Dark panel */}
        <section className="shell py-16 lg:py-24">
          <div className="grid gap-10 rounded-[2rem] bg-ink px-6 py-12 text-page sm:px-12 sm:py-16 lg:grid-cols-[1.1fr_0.9fr] lg:items-end lg:rounded-[3rem] lg:px-20 lg:py-24">
            <h2 className="text-[clamp(2.75rem,6vw,5.75rem)] leading-[0.95] tracking-[-0.045em]">
              Your time.
              <br />
              Your stake.
            </h2>
            <div>
              <p className="text-[clamp(1.1rem,1.4vw,1.375rem)] leading-relaxed text-[#D9C8DE]">
                {BRAND.tagline} You already spend the hours. SCROLL rewards the ones you can show, with tokens tied to the companies behind the apps. No extra scrolling required, and none encouraged.
              </p>
              <UploadCta className="btn btn-primary btn-lg mt-8 max-sm:w-full" />
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="shell pb-16 lg:pb-24">
          <p className="eyebrow">How it works</p>
          <h2 className="mt-3 max-w-[18ch] text-[clamp(2.25rem,4.2vw,4rem)]">Three steps. One of them is ours.</h2>
          <ol className="mt-10 grid gap-5 lg:grid-cols-3">
            {[
              ["Connect your wallet", "Your wallet is your account and where rewards arrive. Signing in is a free signature. No approvals, no spending permissions."],
              ["Upload a weekly screen-time screenshot", "Pick the week, then upload your iOS Screen Time or Android Digital Wellbeing report. Crop out anything private first."],
              ["Receive eligible rewards after review", "A person checks the week, the apps and the durations. If it's approved, your allocation is reserved and sent to your wallet automatically."],
            ].map(([title, body], i) => (
              <li key={title} className="card card-pad">
                <span className="num text-sm font-medium text-coral">0{i + 1}</span>
                <h3 className="mt-4 text-2xl tracking-[-0.025em]">{title}</h3>
                <p className="mt-3 leading-relaxed text-muted">{body}</p>
              </li>
            ))}
          </ol>
          <p className="notice mt-5 max-w-3xl">
            <strong className="font-semibold">Every submission is reviewed by a person.</strong> Uploading a screenshot doesn&rsquo;t create a payout, and approval isn&rsquo;t payment: a reward is paid when its transfer is confirmed on the network.
          </p>
        </section>

        {/* Rewards */}
        <section id="rewards" className="shell pb-16 lg:pb-24">
          <p className="eyebrow">Rewards</p>
          <h2 className="mt-3 max-w-[20ch] text-[clamp(2.25rem,4.2vw,4rem)]">The app you used decides the token.</h2>
          <div className="mt-10 grid gap-5 lg:grid-cols-[1fr_1fr]">
            <div className="card overflow-hidden">
              <table className="table">
                <caption className="sr-only">Supported apps and their reward tokens</caption>
                <thead>
                  <tr>
                    <th scope="col">App</th>
                    <th scope="col">Reward token</th>
                  </tr>
                </thead>
                <tbody className="text-lg">
                  {APPS.map((a) => (
                    <tr key={a.key}>
                      <td className="font-semibold">{a.name}</td>
                      <td>
                        <span className="num font-medium">{a.ticker}</span>
                        {a.ticker === "META" && <span className="ml-2 text-sm text-muted">combined</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card card-pad">
              <h3 className="text-2xl tracking-[-0.025em]">What decides the amount</h3>
              <ul className="mt-4 grid gap-3 leading-relaxed text-muted">
                <li>
                  <strong className="font-semibold text-ink">Verified eligible usage.</strong> The minutes a reviewer confirms for supported apps, up to each app&rsquo;s weekly limit.
                </li>
                <li>
                  <strong className="font-semibold text-ink">The published reward policy.</strong> A rate per minute for each token and a cap per wallet per week.
                </li>
                <li>
                  <strong className="font-semibold text-ink">Available pool funding.</strong> Rewards come from SCROLL&rsquo;s own pool. An allocation is only reserved when the pool can cover it in full.
                </li>
              </ul>
              <p className="mt-4 leading-relaxed text-muted">There is no fixed dollar rate and no guaranteed return. Amounts are in tokens, and token prices move.</p>
            </div>
          </div>

          <div className="card card-pad mt-5">
            {policy ? (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-2xl tracking-[-0.025em]">Current reward policy · version {policy.version}</h3>
                  <p className="hint">
                    {policy.config.label} · published {formatDateTime(policy.publishedAt)}
                  </p>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="table min-w-[38rem]">
                    <thead>
                      <tr>
                        <th scope="col">Token</th>
                        <th scope="col">Per eligible minute</th>
                        <th scope="col">Weekly limit per app</th>
                        <th scope="col">Cap per wallet per week</th>
                        <th scope="col">Minimum payout</th>
                      </tr>
                    </thead>
                    <tbody>
                      {enabled.map((t) => {
                        const rule = policy.config.tickers[t];
                        const d = TOKENS[t].decimals;
                        return (
                          <tr key={t}>
                            <th scope="row" className="num font-medium">
                              {t}
                            </th>
                            <td className="num">{formatUnits(rule.unitsPerMinute, d)}</td>
                            <td>{appsForTicker(t).map((a) => `${a.name} ${formatDuration(policy.config.apps[a.key as keyof typeof policy.config.apps].maxMinutesPerWeek)}`).join(" · ")}</td>
                            <td className="num">{formatUnits(rule.walletWeeklyCap, d)}</td>
                            <td className="num">{formatUnits(rule.minPayout, d)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-2xl tracking-[-0.025em]">No reward policy is published yet</h3>
                <p className="mt-3 max-w-3xl leading-relaxed text-muted">
                  Rates, caps and pool limits are set by a published, versioned policy. Until one is published, submissions can be reviewed but no rewards are allocated. When it is, it will appear here in full.
                </p>
              </>
            )}
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="shell pb-16 lg:pb-28">
          <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="eyebrow">FAQ</p>
              <h2 className="mt-3 text-[clamp(2.25rem,4.2vw,4rem)]">Fair questions.</h2>
            </div>
            <div className="grid gap-3">
              {faq.map((item) => (
                <details key={item.q} className="card group px-6 py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-xl font-semibold tracking-[-0.02em] [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full border border-line text-xl leading-none transition-transform group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="mt-3 max-w-[62ch] leading-relaxed text-muted">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="shell grid gap-10 py-12 lg:grid-cols-[1fr_auto_1.4fr]">
          <div>
            <Logo size={30} id="ftr" />
            <p className="mt-4 max-w-[24ch] text-muted">{BRAND.tagline}</p>
          </div>
          <nav aria-label="Footer" className="grid content-start gap-2.5 font-semibold">
            <Link href="/#how-it-works">How it works</Link>
            <Link href="/#rewards">Rewards</Link>
            <Link href="/#faq">FAQ</Link>
            <Link href="/app">Dashboard</Link>
            <Link href="/app/upload">Upload</Link>
          </nav>
          <div className="grid content-start gap-3 text-[0.95rem] leading-relaxed text-muted">
            <p className="font-semibold text-ink">{BRAND.funding}</p>
            <p>{BRAND.instruments} Nothing here is investment advice, and holding a reward token does not make you a shareholder of any company.</p>
            <p>
              Settlement network: {CHAIN.name} (chain ID {CHAIN.id}). App names are used only to describe which usage is eligible.
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
