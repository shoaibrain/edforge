/**
 * Archetype-aware holiday seed registry — Sprint C3.2.
 *
 * Seeds are AD-dated holiday lists curated per (archetype, region,
 * bsYear). The first instance — PABSON / NPL / BS 2083 — is generated
 * from the canonical PABSON Saraswati pilot fixture
 * (`packages/pilot-fixtures/pilots/pabson-saraswati-bs-2083/holidays-consolidated.json`)
 * via `bsToGregorian`. Operators apply a seed via the new
 * `GET /holiday-seeds?archetype=&year=` endpoint (C3.3) and pipe the
 * result into `generate-calendar` (C3.6 / C3.8).
 *
 * Adding a new seed = add a JSON file next to this one + register it
 * in `HOLIDAY_SEEDS`. No service-layer branching.
 *
 * Fallback semantics in `resolveHolidaySeed`:
 *   1. exact (archetype, region, year) match → that seed
 *   2. else (region, year) generic-country match → that seed
 *   3. else null (caller decides — typically empty response)
 *
 * The endpoint returns the seed plus an `appliedFallback` field so
 * the operator UI can show "Using country defaults" vs "Using PABSON
 * curated list".
 */

import pabsonNpl2083 from './pabson-npl-2083.json';

// ----------------------------------------------------------------------------
// Types (string-literal unions — no Zod runtime cost at the locale layer)
// ----------------------------------------------------------------------------

export type HolidaySeedCategory = 'religious' | 'national' | 'school_specific';
export type HolidaySeedSource = string; // free-form provenance string

export interface HolidaySeedSingleDay {
  /** AD date, YYYY-MM-DD */
  date: string;
  name: string;
  category: HolidaySeedCategory;
  source: HolidaySeedSource;
  /** Always `'holiday'` for single-day entries. */
  eventType: 'holiday';
}

export interface HolidaySeedBlock {
  /** AD date, YYYY-MM-DD */
  startDate: string;
  /** AD date, YYYY-MM-DD (inclusive) */
  endDate: string;
  name: string;
  category: HolidaySeedCategory;
  source: HolidaySeedSource;
  /** Always `'break'` for multi-day entries. */
  eventType: 'break';
}

export interface HolidaySeed {
  archetype: string;
  region: string;
  academicYearLabel: string;
  bsYear: number;
  generatedFrom: string;
  notes: string;
  totals: {
    blocks: number;
    singleDay: number;
    blockDays: number;
  };
  blocks: HolidaySeedBlock[];
  singleDay: HolidaySeedSingleDay[];
}

// ----------------------------------------------------------------------------
// Registry — keyed by `${archetype}:${region}:${bsYear}` lowercased
// ----------------------------------------------------------------------------

const seedKey = (archetype: string, region: string, bsYear: number): string =>
  `${archetype.toUpperCase()}:${region.toUpperCase()}:${bsYear}`;

export const HOLIDAY_SEEDS: Record<string, HolidaySeed> = {
  [seedKey('PABSON', 'NPL', 2083)]: pabsonNpl2083 as HolidaySeed,
};

// ----------------------------------------------------------------------------
// Resolution
// ----------------------------------------------------------------------------

export interface ResolvedHolidaySeed {
  /** The seed used to satisfy the request. Null when no fallback exists. */
  seed: HolidaySeed | null;
  /**
   * Resolution path the loader took:
   *   - 'exact'  — exact (archetype, region, year) match
   *   - 'country' — fell back to country-generic seed for the same year
   *   - 'none'   — no match; seed is null
   */
  appliedFallback: 'exact' | 'country' | 'none';
}

/**
 * Resolve a holiday seed honoring archetype precedence, with a
 * country-generic fallback if no archetype-specific seed exists.
 *
 * Pure — no I/O. Safe to call at CDK synth time or in the request
 * path. Region is normalized to upper-case ISO-3 (e.g., 'NPL', 'IND',
 * 'USA') so callers can pass mixed-case without surprises.
 */
export function resolveHolidaySeed(
  archetype: string | null | undefined,
  region: string | null | undefined,
  bsYear: number,
): ResolvedHolidaySeed {
  if (region && archetype) {
    const exact = HOLIDAY_SEEDS[seedKey(archetype, region, bsYear)];
    if (exact) return { seed: exact, appliedFallback: 'exact' };
  }
  if (region) {
    // Generic country fallback — keyed by archetype='GENERIC' so adopters
    // can ship `GENERIC:NPL:2083` to cover any tenant in Nepal without
    // a PABSON-specific seed.
    const country = HOLIDAY_SEEDS[seedKey('GENERIC', region, bsYear)];
    if (country) return { seed: country, appliedFallback: 'country' };
  }
  return { seed: null, appliedFallback: 'none' };
}

/**
 * List the (archetype, region, bsYear) keys this build ships seeds
 * for. Used by `GET /holiday-seeds` when called with no query params,
 * and by AdminWeb to render a picker.
 */
export function listHolidaySeedKeys(): Array<{
  archetype: string;
  region: string;
  bsYear: number;
}> {
  return Object.values(HOLIDAY_SEEDS).map((s) => ({
    archetype: s.archetype,
    region: s.region,
    bsYear: s.bsYear,
  }));
}
