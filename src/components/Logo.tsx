/** The SCROLL symbol: two offset rounded rectangles, violet behind, coral-to-pink in front. */
export function Symbol({ size = 32, id = "sym" }: { size?: number; id?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF8055" />
          <stop offset="1" stopColor="#FF2E86" />
        </linearGradient>
      </defs>
      <rect x="11" y="3" width="17" height="21" rx="5.5" fill="#B83AF3" />
      <rect x="4" y="8" width="17" height="21" rx="5.5" fill={`url(#${id}-g)`} />
    </svg>
  );
}

export function Logo({ size = 32, id }: { size?: number; id?: string }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Symbol size={size} id={id} />
      <span className="font-extrabold tracking-[-0.055em] leading-none" style={{ fontSize: size * 0.95 }}>
        scroll
      </span>
    </span>
  );
}
