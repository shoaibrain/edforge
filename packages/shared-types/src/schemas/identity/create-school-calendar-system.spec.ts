/**
 * Regression guard for the GB1.1 calendar-derivation prod incident (2026-06-04)
 * and the wider regional-default-masking cluster it exposed.
 *
 * The identity service runs the create body through a global ZodValidationPipe
 * BEFORE deriving regional config (`createDto.X || getDefaultConfigForCountry(...)`
 * / `getGovernanceProfile(...)`). Any `.default()` on these fields is therefore
 * applied first and silently wins over the derivation. That shipped one bug
 * (`calendarSystem.default('gregorian')` → PABSON schools came out gregorian) and
 * three latent ones (`timezone`/`locale`/`academicCalendarType` defaults → an NPL
 * school would persist `America/Chicago`/`en-US`/`semester` instead of the country
 * values). Unit tests that build the DTO as a plain object missed all of them —
 * they bypass the pipe.
 *
 * All four are now `.optional()` (no default). These tests lock that: an omitted
 * regional field survives parsing as `undefined` so the service owns the
 * derivation; explicit client values are preserved.
 */

import { createSchoolSchema } from './school.schema';

const base = {
  schoolCode: 'SCH01',
  name: 'Test School',
  schoolType: 'k12' as const,
  gradeRange: { start: '1', end: '10' },
};

describe('createSchoolSchema — regional fields are not defaulted (service derivation owns them)', () => {
  it('leaves every regional field undefined when omitted (so the service derives them)', () => {
    const parsed = createSchoolSchema.parse({ ...base });
    expect(parsed.calendarSystem).toBeUndefined();
    expect(parsed.timezone).toBeUndefined();
    expect(parsed.locale).toBeUndefined();
    expect(parsed.academicCalendarType).toBeUndefined();
  });

  it('preserves explicit regional values', () => {
    const parsed = createSchoolSchema.parse({
      ...base,
      calendarSystem: 'bikram_sambat',
      timezone: 'Asia/Kathmandu',
      locale: 'ne-NP',
      academicCalendarType: 'annual',
    });
    expect(parsed.calendarSystem).toBe('bikram_sambat');
    expect(parsed.timezone).toBe('Asia/Kathmandu');
    expect(parsed.locale).toBe('ne-NP');
    expect(parsed.academicCalendarType).toBe('annual');
  });
});
