/**
 * Archetype school-week defaults (Sprint GB1.2a) — the canonical, archetype-keyed
 * operating week, the source the `GovernanceProfile.schoolConfigDefaults` slot
 * projects (GB1.2b) and the identity service cross-checks.
 *
 * Operating days are stored as day-of-week indices (`0 = Sunday … 6 = Saturday`),
 * matching the existing `country-config.ts:defaultSchoolDays` convention so the
 * two representations stay comparable. The school *week* is a governance-body
 * fact, not a regional-formatting one (PABSON and GENERIC both start the week on
 * Sunday yet operate different days), so it lives here keyed by archetype rather
 * than on `RegionalSettings`.
 */

import type { ActiveArchetype } from '../schemas/identity/tenant.schema';

/** Day index → lowercase English day name (`0 = sunday`). */
const WEEKDAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

/**
 * Operating school-week per governance body, as day indices (`0 = Sun`).
 * `Record<ActiveArchetype, …>` so adding a governance body to the enum without
 * an entry fails at compile time — the framework's "data-only, zero call-site"
 * gate. PABSON runs Sun–Fri (Saturday is the Nepal weekend); GENERIC runs Mon–Fri.
 */
export const ARCHETYPE_SCHOOL_DAYS: Record<ActiveArchetype, readonly number[]> = {
  PABSON: [0, 1, 2, 3, 4, 5],
  GENERIC: [1, 2, 3, 4, 5],
};

/** Project day indices to lowercase day names (the aggregator slot's shape). */
export function schoolDayNumbersToNames(days: readonly number[]): readonly string[] {
  return days.map((d) => WEEKDAY_NAMES[d]);
}
