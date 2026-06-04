/**
 * Regression guard for the GB1.1 calendar-derivation prod incident (2026-06-04).
 *
 * `createSchoolSchema` previously carried `calendarSystem: …default('gregorian')`.
 * Because the identity service runs the schema through a global ZodValidationPipe
 * BEFORE its archetype derivation, an omitted calendarSystem was filled with
 * 'gregorian' and the service's `createDto.calendarSystem || getGovernanceProfile(...)`
 * short-circuited — so a PABSON school created without an explicit calendar came
 * out 'gregorian' instead of 'bikram_sambat'. Unit tests that build the DTO as a
 * plain object missed it (they bypass the pipe).
 *
 * The field is now `.optional()` (no default). These tests lock that: an omitted
 * calendarSystem must survive parsing as `undefined` so the service owns the
 * derivation; an explicit value is preserved; unrelated defaults still apply.
 */

import { createSchoolSchema } from './school.schema';

const base = {
  schoolCode: 'SCH01',
  name: 'Test School',
  schoolType: 'k12' as const,
  gradeRange: { start: '1', end: '10' },
};

describe('createSchoolSchema — calendarSystem is not defaulted (GB1.1 derivation owns it)', () => {
  it('leaves calendarSystem undefined when omitted (so the service can derive it)', () => {
    const parsed = createSchoolSchema.parse({ ...base });
    expect(parsed.calendarSystem).toBeUndefined();
  });

  it('preserves an explicit calendarSystem', () => {
    expect(createSchoolSchema.parse({ ...base, calendarSystem: 'bikram_sambat' }).calendarSystem).toBe('bikram_sambat');
    expect(createSchoolSchema.parse({ ...base, calendarSystem: 'gregorian' }).calendarSystem).toBe('gregorian');
  });

  it('still applies the unrelated create defaults (only the calendar default was removed)', () => {
    const parsed = createSchoolSchema.parse({ ...base });
    expect(parsed.timezone).toBe('America/Chicago');
    expect(parsed.locale).toBe('en-US');
    expect(parsed.academicCalendarType).toBe('semester');
  });
});
