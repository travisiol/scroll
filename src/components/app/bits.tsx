import { explorerTx } from "@/config/network";
import { PAYOUT_LABEL, REVIEW_LABEL, type PayoutState, type ReviewStatus, type Tone } from "@/core/status";
import { formatUnits } from "@/core/units";

const TONE: Record<Tone, string> = { neutral: "", wait: "pill-wait", action: "pill-action", good: "pill-good", bad: "pill-bad" };

export function ReviewPill({ status }: { status: string }) {
  const meta = REVIEW_LABEL[status as ReviewStatus] ?? { label: status, tone: "neutral" as Tone };
  return <span className={`pill ${TONE[meta.tone]}`}>{meta.label}</span>;
}

export function PayoutPill({ state, ticker }: { state: string; ticker?: string }) {
  const meta = PAYOUT_LABEL[state as PayoutState] ?? { label: state, tone: "neutral" as Tone };
  return (
    <span className={`pill ${TONE[meta.tone]}`}>
      {ticker && <span className="num font-medium">{ticker}</span>}
      {meta.label}
    </span>
  );
}

/** An exact token amount with its ticker. Never a fiat value: there is no price source. */
export function Amount({ value, decimals, ticker, className = "" }: { value: string | bigint; decimals: number; ticker: string; className?: string }) {
  return (
    <span className={`num whitespace-nowrap ${className}`}>
      {formatUnits(value, decimals)} <span className="font-medium">{ticker}</span>
    </span>
  );
}

export function TxLink({ tx }: { tx: { hash: string } | null }) {
  if (!tx) return <span className="text-muted">—</span>;
  const short = `${tx.hash.slice(0, 10)}…${tx.hash.slice(-6)}`;
  return (
    <a className="link num text-[0.9rem]" href={explorerTx(tx.hash)} target="_blank" rel="noreferrer">
      {short}
    </a>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#e2c9d3] px-6 py-10 text-center">
      <p className="text-lg font-semibold">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

export function PageTitle({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[clamp(2rem,3.4vw,3rem)]">{title}</h1>
        {children && <p className="mt-2 max-w-2xl leading-relaxed text-muted">{children}</p>}
      </div>
      {action}
    </div>
  );
}
