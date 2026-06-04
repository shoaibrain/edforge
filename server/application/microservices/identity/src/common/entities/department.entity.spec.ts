/**
 * GB1.2a — `getDefaultConfigForArchetype`: archetype-over-country precedence for
 * default school configuration, the school-config sibling of
 * `resolveArchetypeDefaults`. The country map remains the fallback layer.
 */

import {
  getDefaultConfigForArchetype,
  getDefaultConfigForCountry,
  DEFAULT_SCHOOL_CONFIG,
} from './department.entity';
import { ARCHETYPE_SCHOOL_DAYS } from '@aibrains/shared-types';

describe('getDefaultConfigForArchetype (GB1.2a)', () => {
  it('PABSON → Sun–Fri week, 24h clock, CEHRD percentage grading (regardless of country)', () => {
    const config = getDefaultConfigForArchetype('PABSON', 'USA');
    expect(config.schoolDays).toEqual([0, 1, 2, 3, 4, 5]);
    expect(config.timeFormat).toBe('24h');
    expect(config.gradingScale.type).toBe('percentage');
    expect(config.gradingScale.passingGrade).toBe(32);
  });

  it('is case-insensitive on the archetype key', () => {
    expect(getDefaultConfigForArchetype('pabson', 'USA').schoolDays).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('GENERIC + NPL → falls back to the NPL country config', () => {
    expect(getDefaultConfigForArchetype('GENERIC', 'NPL')).toEqual(getDefaultConfigForCountry('NPL'));
  });

  it('GENERIC + US → US defaults', () => {
    expect(getDefaultConfigForArchetype('GENERIC', 'USA')).toEqual(DEFAULT_SCHOOL_CONFIG);
  });

  it('unknown / missing archetype → country fallback', () => {
    expect(getDefaultConfigForArchetype(undefined, 'NPL')).toEqual(getDefaultConfigForCountry('NPL'));
    expect(getDefaultConfigForArchetype('NOT_REAL', 'USA')).toEqual(DEFAULT_SCHOOL_CONFIG);
  });

  it('PABSON operating week matches the shared-types canonical source (no drift)', () => {
    expect(getDefaultConfigForArchetype('PABSON', 'NPL').schoolDays).toEqual([
      ...ARCHETYPE_SCHOOL_DAYS.PABSON,
    ]);
  });
});
