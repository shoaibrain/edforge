/**
 * Calendar event descriptor — Sprint S1 cutover test.
 *
 * Locks in the 2026-05-14 hard cutover:
 *   REMOVED `testing_day`
 *   ADDED   `exam_window`, `school_program`, `monthly_test`
 *
 * Also asserts the new optional event-shape fields (`gradeLevelScope`,
 * `category`, `audience`, `sourceTermId`) round-trip through Zod parse.
 *
 * No exhaustive switch lockstep here — code consumers use object-keyed
 * lookups with fallbacks (see fullcalendar-utils.ts), not switches.
 * Adding new enum values doesn't break consumers; it just leaves them
 * unstyled until the visual layer (S1.4) ships an entry.
 */

import {
  calendarEventDescriptorSchema,
  calendarEventCategorySchema,
  calendarEventAudienceSchema,
  calendarEventSchema,
} from './calendar-date.schema';

describe('CalendarEventDescriptor — S1 cutover', () => {
  it('accepts the three new descriptors introduced by S1', () => {
    expect(calendarEventDescriptorSchema.parse('exam_window')).toBe('exam_window');
    expect(calendarEventDescriptorSchema.parse('school_program')).toBe('school_program');
    expect(calendarEventDescriptorSchema.parse('monthly_test')).toBe('monthly_test');
  });

  it('rejects the legacy `testing_day` value', () => {
    expect(() => calendarEventDescriptorSchema.parse('testing_day')).toThrow();
  });

  it('preserves every pre-S1 descriptor that survived the cutover', () => {
    const preserved = [
      'instructional_day',
      'non_instructional_day',
      'holiday',
      'teacher_only',
      'student_holiday',
      'weather_day',
      'early_release',
      'late_start',
      'conference_day',
      'graduation',
      'break',
      'in_service',
      'make_up_day',
      'other',
    ];
    for (const d of preserved) {
      expect(calendarEventDescriptorSchema.parse(d)).toBe(d);
    }
  });
});

describe('CalendarEventCategory', () => {
  it('accepts every defined category', () => {
    const all = [
      'cultural', 'religious', 'academic', 'assessment',
      'administrative', 'community', 'professional_development', 'other',
    ];
    for (const c of all) {
      expect(calendarEventCategorySchema.parse(c)).toBe(c);
    }
  });
});

describe('CalendarEventAudience', () => {
  it('accepts every defined audience', () => {
    const all = ['students', 'faculty', 'parents', 'community', 'all'];
    for (const a of all) {
      expect(calendarEventAudienceSchema.parse(a)).toBe(a);
    }
  });
});

describe('CalendarEvent shape — S1 extensions', () => {
  it('round-trips a school_program event with all S1 metadata', () => {
    const parsed = calendarEventSchema.parse({
      eventType: 'school_program',
      description: 'Saraswati Puja',
      isAllDay: true,
      gradeLevelScope: ['Class 9', 'Class 10'],
      category: 'religious',
      audience: 'all',
    });
    expect(parsed.eventType).toBe('school_program');
    expect(parsed.gradeLevelScope).toEqual(['Class 9', 'Class 10']);
    expect(parsed.category).toBe('religious');
    expect(parsed.audience).toBe('all');
  });

  it('round-trips an exam_window event with sourceTermId provenance', () => {
    const parsed = calendarEventSchema.parse({
      eventType: 'exam_window',
      isAllDay: true,
      sourceTermId: '00000000-0000-0000-0000-000000000001',
    });
    expect(parsed.eventType).toBe('exam_window');
    expect(parsed.sourceTermId).toBe('00000000-0000-0000-0000-000000000001');
  });

  it('accepts events without any S1 metadata (backward-compat)', () => {
    const parsed = calendarEventSchema.parse({
      eventType: 'holiday',
      description: 'Tihar',
      isAllDay: true,
    });
    expect(parsed.gradeLevelScope).toBeUndefined();
    expect(parsed.category).toBeUndefined();
    expect(parsed.audience).toBeUndefined();
    expect(parsed.sourceTermId).toBeUndefined();
  });

  it('rejects sourceTermId that is not a UUID', () => {
    expect(() =>
      calendarEventSchema.parse({
        eventType: 'exam_window',
        isAllDay: true,
        sourceTermId: 'not-a-uuid',
      }),
    ).toThrow();
  });
});
