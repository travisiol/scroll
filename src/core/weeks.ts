/**
 * Reporting weeks. A week is identified by its first day as "YYYY-MM-DD".
 * Weeks start on Sunday by default (the iOS Screen Time weekly report);
 * set NEXT_PUBLIC_WEEK_STARTS_ON=1 for Monday.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const configured = Number(process.env.NEXT_PUBLIC_WEEK_STARTS_ON);
export const WEEK_STARTS_ON = configured === 1 ? 1 : 0;

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function fromIso(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || toIso(date) !== iso ? null : date;
}

/** First day of the week that contains `now` (UTC). */
export function weekStartOf(now: Date, startsOn: number = WEEK_STARTS_ON): string {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const offset = (new Date(midnight).getUTCDay() - startsOn + 7) % 7;
  return toIso(new Date(midnight - offset * DAY_MS));
}

/** The last `count` fully completed weeks, most recent first. */
export function completedWeeks(now: Date, count: number, startsOn: number = WEEK_STARTS_ON): string[] {
  const current = fromIso(weekStartOf(now, startsOn))!;
  return Array.from({ length: count }, (_, i) => toIso(new Date(current.getTime() - (i + 1) * 7 * DAY_MS)));
}

export function isSelectableWeek(weekStart: string, now: Date, count: number, startsOn: number = WEEK_STARTS_ON): boolean {
  return completedWeeks(now, count, startsOn).includes(weekStart);
}

export function weekEnd(weekStart: string): string {
  const start = fromIso(weekStart);
  if (!start) throw new Error("Invalid week");
  return toIso(new Date(start.getTime() + 6 * DAY_MS));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sep 21 – Sep 27, 2026" */
export function formatWeek(weekStart: string): string {
  const start = fromIso(weekStart);
  if (!start) return weekStart;
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const label = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return `${label(start)} – ${label(end)}, ${end.getUTCFullYear()}`;
}
