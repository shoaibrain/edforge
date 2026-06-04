/**
 * Canonical archetype operating week — the source `GovernanceProfile.schoolConfigDefaults`
 * projects (GB1.2). Keyed by archetype rather than living on `RegionalSettings`
 * because the school *week* is a governance-body fact: PABSON and GENERIC both
 * start the week on Sunday yet operate different days, so `defaultWeekStartsOn`
 * can't derive it. Day indices mirror `country-config.ts:defaultSchoolDays` (0 = Sun).
 */

import type { ActiveArchetype } from '../schemas/identity/tenant.schema';

const WEEKDAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

/** Keyed by `ActiveArchetype` so a new governance body without an entry fails at compile time. */
export const ARCHETYPE_SCHOOL_DAYS: Record<ActiveArchetype, readonly number[]> = {
  PABSON: [0, 1, 2, 3, 4, 5],
  GENERIC: [1, 2, 3, 4, 5],
};

/** Project day indices to lowercase day names; throws on an out-of-range index. */
export function schoolDayNumbersToNames(days: readonly number[]): readonly string[] {
  return days.map((d) => {
    const name = WEEKDAY_NAMES[d];
    if (name === undefined) {
      throw new RangeError(`Invalid weekday index ${d}; expected 0–6`);
    }
    return name;
  });
}
