/**
 * GB1.2a / GB1.2b — the canonical archetype operating week and its projection
 * through the GovernanceProfile `schoolConfigDefaults` slot (closing the GB0.3
 * stub). Proves the slot is sourced from `ARCHETYPE_SCHOOL_DAYS`, not inlined.
 */

import { activeArchetypeSchema } from '../schemas/identity/tenant.schema';
import { ARCHETYPE_SCHOOL_DAYS, schoolDayNumbersToNames } from './school-config-defaults';
import { getGovernanceProfile } from './governance-profile';

const ARCHETYPES = activeArchetypeSchema.options;

describe('GB1.2a ARCHETYPE_SCHOOL_DAYS — canonical operating week', () => {
  it('PABSON runs Sun–Fri, GENERIC runs Mon–Fri', () => {
    expect(ARCHETYPE_SCHOOL_DAYS.PABSON).toEqual([0, 1, 2, 3, 4, 5]);
    expect(ARCHETYPE_SCHOOL_DAYS.GENERIC).toEqual([1, 2, 3, 4, 5]);
  });

  it.each(ARCHETYPES)('%s has a non-empty operating week', (archetype) => {
    expect(ARCHETYPE_SCHOOL_DAYS[archetype].length).toBeGreaterThan(0);
  });

  it('schoolDayNumbersToNames maps indices to lowercase day names', () => {
    expect(schoolDayNumbersToNames([0, 1, 2, 3, 4, 5])).toEqual([
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
    ]);
    expect(schoolDayNumbersToNames([1, 2, 3, 4, 5])).toEqual([
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
    ]);
  });

  it('schoolDayNumbersToNames throws on an out-of-range index (signature stays honest)', () => {
    expect(() => schoolDayNumbersToNames([7])).toThrow(RangeError);
    expect(() => schoolDayNumbersToNames([-1])).toThrow(RangeError);
  });
});

describe('GB1.2b schoolConfigDefaults slot is sourced from ARCHETYPE_SCHOOL_DAYS', () => {
  it.each(ARCHETYPES)('%s slot equals the projected source (no stub)', (archetype) => {
    expect(getGovernanceProfile(archetype).schoolConfigDefaults.schoolDays).toEqual(
      schoolDayNumbersToNames(ARCHETYPE_SCHOOL_DAYS[archetype]),
    );
  });

  it('PABSON resolves to the Sun–Fri day names', () => {
    expect(getGovernanceProfile('PABSON').schoolConfigDefaults.schoolDays).toEqual([
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
    ]);
  });

  it('GENERIC resolves to the Mon–Fri day names', () => {
    expect(getGovernanceProfile('GENERIC').schoolConfigDefaults.schoolDays).toEqual([
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
    ]);
  });
});
