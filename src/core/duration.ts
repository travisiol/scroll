/** Screen-time durations, always held as whole minutes. */

export const MAX_WEEK_MINUTES = 7 * 24 * 60;

/**
 * Parse what a reviewer reads off a screenshot: "9h 42m", "9 h 42 min",
 * "9:42", "42m", "3h", "582" (minutes). Returns null when it isn't a
 * duration, or when it is longer than a week.
 */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return null;

  let minutes: number | null = null;

  const colon = /^(\d{1,3}):([0-5]\d)$/.exec(text);
  const hm = /^(?:(\d{1,3}) ?(?:h|hr|hrs|hour|hours))? ?(?:(\d{1,4}) ?(?:m|min|mins|minute|minutes))?$/.exec(text);
  if (colon) {
    minutes = Number(colon[1]) * 60 + Number(colon[2]);
  } else if (/^\d{1,5}$/.test(text)) {
    minutes = Number(text);
  } else if (hm && (hm[1] !== undefined || hm[2] !== undefined)) {
    const h = hm[1] !== undefined ? Number(hm[1]) : 0;
    const m = hm[2] !== undefined ? Number(hm[2]) : 0;
    // "1h 75m" is a typo, not a duration.
    if (hm[1] !== undefined && m > 59) return null;
    minutes = h * 60 + m;
  }

  if (minutes === null || !Number.isInteger(minutes)) return null;
  if (minutes < 0 || minutes > MAX_WEEK_MINUTES) return null;
  return minutes;
}

/** 582 → "9h 42m", 45 → "45m", 180 → "3h 00m". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
