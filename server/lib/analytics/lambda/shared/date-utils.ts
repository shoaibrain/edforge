/**
 * Civil-date helpers — per-tenant timezone aware (A-WS3.T1).
 *
 * Originally hardcoded to Asia/Kathmandu (ACRIT.1). After A-WS3.T1, every
 * function accepts an optional `tz` parameter that defaults to
 * Asia/Kathmandu — preserving every existing test and the V1 Nepal-only
 * behavior — while letting per-tenant callers (the aggregator) pass the
 * tenant's `regional.defaultTimezone` from workspace settings.
 *
 * The bug class this module exists to prevent: any time you derive a day
 * boundary, you MUST do it in the tenant's civil time, NOT UTC. NPT is
 * UTC+5:45; an event at 23:45 UTC Saturday is 05:30 NPT Sunday and must
 * land on Sunday's aggregates. Other tenants have other offsets.
 *
 * The shared rule (CLAUDE.md): any new analytics date logic uses these
 * helpers. Do not call `getUTCDate()`/`toISOString().slice(0,10)` for a
 * bucket date — that's the bug class this module exists to prevent.
 */

/** yyyy-mm-dd — calendar day in the tenant's timezone. */
export type DateKey = string;
/** yyyy-Www — ISO-8601 week computed from the tenant's calendar date. */
export type WeekKey = string;
/** yyyy-mm — calendar month in the tenant's timezone. */
export type MonthKey = string;

/** Default timezone applied when no `tz` argument is passed. */
export const DEFAULT_TIMEZONE = 'Asia/Kathmandu';

/**
 * Memoized Intl.DateTimeFormat per timezone. Constructing one is ~50µs;
 * the aggregator processes ~10K events/day → ~500K/year — easily covered
 * by a 32-entry cache. Built lazily on first use of each tz.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();
const FORMATTER_CACHE_MAX = 32;

function getDayFormatter(tz: string): Intl.DateTimeFormat {
  const existing = formatterCache.get(tz);
  if (existing) return existing;
  // Eviction: drop oldest entry when full. 32 is generous for V1 (≤50 tenants
  // soft-launch + a few system timezones); revisit when fleet grows.
  if (formatterCache.size >= FORMATTER_CACHE_MAX) {
    const oldest = formatterCache.keys().next().value;
    if (oldest !== undefined) formatterCache.delete(oldest);
  }
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  formatterCache.set(tz, fmt);
  return fmt;
}

/**
 * Returns yyyy-mm-dd in the given timezone (default: Asia/Kathmandu).
 *
 * NPT examples (tz='Asia/Kathmandu', NPT=UTC+5:45):
 * - 23:59 UTC on day D → 05:44 NPT on day D+1 → returns D+1
 * - 18:14 UTC on day D → 23:59 NPT on day D → returns D
 * - 18:15 UTC on day D → 00:00 NPT on day D+1 → returns D+1
 *
 * EST examples (tz='America/New_York', EST=UTC-5):
 * - 23:45 UTC on day D → 18:45 EST on day D → returns D
 * - 04:45 UTC on day D → 23:45 EST on day D-1 → returns D-1
 */
export function toDateKey(d: Date, tz: string = DEFAULT_TIMEZONE): DateKey {
  return getDayFormatter(tz).format(d);
}

/**
 * Parses a yyyy-mm-dd DateKey as midnight in the given timezone.
 *
 * The returned Date represents the UTC instant of midnight in `tz`. For
 * non-Kathmandu timezones we synthesize the offset string by formatting a
 * UTC reference instant in the target tz, which works for any IANA zone
 * Intl recognizes.
 *
 * Use round-trips via toDateKey(); do NOT read .getUTCDate() on the result.
 */
export function parseDateKey(s: DateKey, tz: string = DEFAULT_TIMEZONE): Date {
  // Hot path for the V1 default — keep it cheap and explicit.
  if (tz === 'Asia/Kathmandu') {
    return new Date(`${s}T00:00:00+05:45`);
  }
  // Generic path: resolve the offset for this tz at the requested local
  // midnight. Iterate until we find a UTC instant that the formatter
  // reports as <DateKey> 00:00 in `tz`. Two passes is sufficient for any
  // fixed-offset zone; DST zones are handled too (offset stable across
  // a single midnight).
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  // Start from naive UTC midnight and adjust by the formatter-reported offset.
  let candidate = new Date(`${s}T00:00:00Z`);
  for (let i = 0; i < 3; i++) {
    const parts = fmt.formatToParts(candidate);
    const got: Record<string, string> = {};
    for (const p of parts) if (p.type !== 'literal') got[p.type] = p.value;
    const gotKey = `${got.year}-${got.month}-${got.day}`;
    // Intl in some implementations reports local midnight as hour "24"
    // with the same calendar day. Treat that as hour 0 of the same day —
    // semantically equivalent for our delta math.
    let hh = Number(got.hour);
    if (hh === 24) hh = 0;
    const mm = Number(got.minute);
    if (gotKey === s && hh === 0 && mm === 0) return candidate;
    // Adjust by the local-vs-UTC delta and retry.
    const targetMs = Date.parse(`${s}T00:00:00Z`);
    const reportedMs = Date.parse(
      `${gotKey}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`,
    );
    candidate = new Date(candidate.getTime() + (targetMs - reportedMs));
  }
  return candidate;
}

/**
 * yyyy-Www — ISO-8601 week computed from the tenant calendar date.
 *
 * The week-numbering algorithm is ISO-8601 (Mon-Sun, week 1 contains the
 * first Thursday); the *date* fed into it comes from the tenant's tz.
 *
 * Note (A-WS3.T2): the adoption-report endpoint switches to a tenant-
 * configurable week boundary (Sun-Fri vs Mon-Sun) consuming
 * `regional.defaultWeekStartsOn`. This helper continues to return ISO
 * week IDs because that's the storage shape; the application layer
 * interprets them per tenant.
 */
export function toWeekKey(d: Date, tz: string = DEFAULT_TIMEZONE): WeekKey {
  const localDateKey = toDateKey(d, tz);
  const [y, m, day] = localDateKey.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1, day));

  const dayNum = target.getUTCDay() === 0 ? 7 : target.getUTCDay();
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(
    ((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/** yyyy-mm — calendar month in the tenant's timezone. */
export function toMonthKey(d: Date, tz: string = DEFAULT_TIMEZONE): MonthKey {
  return toDateKey(d, tz).slice(0, 7);
}

/**
 * Shift a calendar date by `days` in the tenant's tz. Positive = future,
 * negative = past. Re-anchors at the tenant's midnight.
 */
export function shiftDays(
  d: Date,
  days: number,
  tz: string = DEFAULT_TIMEZONE,
): Date {
  const dateKey = toDateKey(d, tz);
  const anchor = parseDateKey(dateKey, tz);
  const shifted = new Date(anchor.getTime() + days * 86400_000);
  return parseDateKey(toDateKey(shifted, tz), tz);
}

export function secondsFromNow(days: number): number {
  return Math.floor(Date.now() / 1000) + days * 86400;
}

/**
 * Resolve the rollup's target date. Priority:
 *   1. DATE_OVERRIDE env var (yyyy-mm-dd, interpreted in `tz`) — tests + backfill
 *   2. event.date — allow scheduler/backfill invocation to specify
 *   3. yesterday in `tz` — production default
 *
 * Production scheduler runs daily at 01:00 Asia/Kathmandu (per
 * analytics-stack.ts), so "yesterday NPT" rolls up the just-completed
 * NPT calendar day. Per-tenant rollup (post-V1) would pass the tenant's tz.
 */
export function resolveTargetDate(
  event: unknown,
  tz: string = DEFAULT_TIMEZONE,
): Date {
  const env = process.env.DATE_OVERRIDE;
  if (env) return parseDateKey(env, tz);
  if (event && typeof event === 'object' && 'date' in event) {
    const v = (event as { date: unknown }).date;
    if (typeof v === 'string' && v.length > 0) return parseDateKey(v, tz);
  }
  return shiftDays(new Date(), -1, tz);
}
