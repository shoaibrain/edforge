/**
 * Layer 6.3 — date helpers for the rollup Lambda.
 *
 * All functions take and return strings in canonical formats. Tests can
 * inject a reference date so we don't depend on `new Date()` at runtime.
 */

/** yyyy-mm-dd (ISO date). */
export type DateKey = string;
/** yyyy-Www (ISO week, Monday-start to match week arithmetic). */
export type WeekKey = string;
/** yyyy-mm. */
export type MonthKey = string;

export function toDateKey(d: Date): DateKey {
  return d.toISOString().slice(0, 10);
}

export function parseDateKey(s: DateKey): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/** yyyy-Www using ISO-8601 week calendar. */
export function toWeekKey(d: Date): WeekKey {
  // Clone to avoid mutation.
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // ISO day: 1..7, Mon..Sun.
  const dayNum = target.getUTCDay() === 0 ? 7 : target.getUTCDay();
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(
    ((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

export function toMonthKey(d: Date): MonthKey {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Shift a date by `days`. Positive = future, negative = past. */
export function shiftDays(d: Date, days: number): Date {
  const n = new Date(d);
  n.setUTCDate(n.getUTCDate() + days);
  return n;
}

export function secondsFromNow(days: number): number {
  return Math.floor(Date.now() / 1000) + days * 86400;
}

/**
 * Resolve the rollup's target date. Priority:
 *   1. DATE_OVERRIDE env var (yyyy-mm-dd) — tests and backfill use this
 *   2. event.date — allow the scheduler/backfill invocation to specify
 *   3. yesterday (UTC) — the production default
 */
export function resolveTargetDate(event: unknown): Date {
  const env = process.env.DATE_OVERRIDE;
  if (env) return parseDateKey(env);
  if (event && typeof event === 'object' && 'date' in event) {
    const v = (event as { date: unknown }).date;
    if (typeof v === 'string' && v.length > 0) return parseDateKey(v);
  }
  return shiftDays(new Date(), -1);
}
