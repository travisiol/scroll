/**
 * The hero artwork: one floating screen-time card and three reward
 * notifications. Plain HTML sized in container units, so the text stays
 * crisp and selectable at every width. The numbers are artwork: nothing in the app reads them.
 */

const BARS = [46, 72, 58, 88, 64, 100, 78];

const ROWS = [
  ["Instagram", "9h 42m"],
  ["Reddit", "4h 10m"],
  ["Netflix", "6h 05m"],
];

function Reward({ amount, className, drift }: { amount: string; className: string; drift: string }) {
  return (
    <div className={`absolute ${className}`}>
      <div className={`drift ${drift} rounded-[3.4cqw] border border-line bg-card px-[3.6cqw] py-[2.6cqw] shadow-lift`}>
        <p className="text-[2.5cqw] font-semibold leading-none text-muted">Stock reward</p>
        <p className="mt-[1.3cqw] whitespace-nowrap text-[4.5cqw] font-extrabold leading-none tracking-[-0.03em]">{amount}</p>
      </div>
    </div>
  );
}

export function HeroArt() {
  return (
    <figure className="mx-auto w-full max-w-[42rem]">
      <div className="relative aspect-[1/1.02] [container-type:inline-size]">
        {/* The card, with a second sheet behind it for depth. */}
        <div className="absolute left-[18cqw] top-[5cqw] w-[62cqw] rotate-[-6deg]">
          <div aria-hidden className="absolute inset-0 translate-x-[1.6cqw] translate-y-[2cqw] rounded-[6cqw] bg-[#F6DFE8]" />
          <div className="relative rounded-[6cqw] border border-line bg-card px-[6cqw] pb-[5.5cqw] pt-[6cqw] shadow-lift">
            <p className="text-[3cqw] font-semibold leading-none text-muted">Weekly screen time</p>
            <p className="mt-[2.4cqw] text-[11.5cqw] font-extrabold leading-[0.9] tracking-[-0.05em]">19h 57m</p>

            <div aria-hidden className="mt-[5cqw] flex h-[17cqw] items-end gap-[2.2cqw]">
              {BARS.map((h, i) => (
                <span key={i} className="flex-1 rounded-full bg-coral-soft" style={{ height: `${h}%` }} />
              ))}
            </div>

            <dl className="mt-[5cqw]">
              {ROWS.map(([app, time]) => (
                <div key={app} className="flex items-baseline justify-between border-t border-line py-[2.5cqw] text-[3.5cqw] leading-none last:pb-0">
                  <dt className="font-semibold">{app}</dt>
                  <dd className="text-muted">{time}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <Reward amount="+0.004 META" className="right-[-1cqw] top-[12cqw] rotate-[4deg]" drift="" />
        <Reward amount="+0.012 RDDT" className="left-[-1cqw] top-[30cqw] rotate-[-3deg]" drift="drift-b" />
        <Reward amount="+0.002 NFLX" className="right-[2cqw] top-[79cqw] rotate-[2deg]" drift="drift-c" />
      </div>
    </figure>
  );
}
