/**
 * Spec for the dayType gating added to `validateBellSchedule` in 0.48.0.
 *
 * Before: every period had to match (or double) `schoolConfig.periodDuration`,
 * regardless of dayType — actively wrong for testing days whose whole point
 * is non-uniform blocks (e.g., 180-min morning exam + 120-min afternoon).
 *
 * After: the duration-uniformity check is gated on `dayType === 'regular'`.
 * Testing / half-day / etc. variants skip it. Start- and end-of-day bounds
 * checks remain in effect for every dayType.
 *
 * The `dayType` parameter defaults to `'regular'` so callers that pre-date
 * this signature change see the original strict behavior — backwards
 * compatible.
 */

import { validateBellSchedule } from '../school-hours';
import type { SchoolHoursConfig, Period } from '../school-hours';

const SCHOOL_CONFIG: SchoolHoursConfig = {
  startTime: '08:00',
  endTime: '16:00',
  schoolDays: [1, 2, 3, 4, 5],
  periodDuration: 45,
};

const uniformPeriods: Period[] = [
  { number: 1, startTime: '08:00', endTime: '08:45', type: 'class', label: 'P1' },
  { number: 2, startTime: '08:45', endTime: '09:30', type: 'class', label: 'P2' },
];

// Exam-day shape: 3h block + lunch break + 2h block. Mirrors PABSON exam preset.
const examDayPeriods: Period[] = [
  { number: 1, startTime: '10:00', endTime: '13:00', type: 'class', label: 'Morning Exam' },
  { number: 2, startTime: '13:00', endTime: '14:00', type: 'break', label: 'Lunch' },
  { number: 3, startTime: '14:00', endTime: '16:00', type: 'class', label: 'Afternoon Exam' },
];

describe('validateBellSchedule — dayType gating (C3.5 hotfix)', () => {
  it("emits duration-mismatch errors for non-uniform periods when dayType defaults to 'regular'", () => {
    const errors = validateBellSchedule(examDayPeriods, SCHOOL_CONFIG);
    expect(errors.some((e) => e.includes("doesn't match configured period duration"))).toBe(true);
  });

  it("emits duration-mismatch errors when dayType is explicit 'regular'", () => {
    const errors = validateBellSchedule(examDayPeriods, SCHOOL_CONFIG, 'regular');
    expect(errors.some((e) => e.includes("doesn't match configured period duration"))).toBe(true);
  });

  it("skips the duration check when dayType is 'testing' (the C3.5 fix)", () => {
    const errors = validateBellSchedule(examDayPeriods, SCHOOL_CONFIG, 'testing');
    expect(errors.filter((e) => e.includes("doesn't match configured period duration"))).toHaveLength(0);
  });

  it.each(['half_day', 'early_release', 'late_start', 'assembly', 'special'] as const)(
    "also skips the duration check for dayType=%s",
    (dt) => {
      const errors = validateBellSchedule(examDayPeriods, SCHOOL_CONFIG, dt);
      expect(errors.filter((e) => e.includes("doesn't match configured period duration"))).toHaveLength(0);
    },
  );

  it('still enforces start-of-day bounds for testing days', () => {
    // First period starts at 07:00 — before school start (08:00)
    const earlyExam: Period[] = [
      { number: 1, startTime: '07:00', endTime: '10:00', type: 'class', label: 'Morning Exam' },
    ];
    const errors = validateBellSchedule(earlyExam, SCHOOL_CONFIG, 'testing');
    expect(errors.some((e) => e.includes('before school start time'))).toBe(true);
  });

  it('still enforces end-of-day bounds for testing days', () => {
    const lateExam: Period[] = [
      { number: 1, startTime: '14:00', endTime: '18:00', type: 'class', label: 'Late Exam' },
    ];
    const errors = validateBellSchedule(lateExam, SCHOOL_CONFIG, 'testing');
    expect(errors.some((e) => e.includes('after school end time'))).toBe(true);
  });

  it('still emits "at least one class period" error regardless of dayType', () => {
    const onlyBreaks: Period[] = [
      { number: 1, startTime: '08:00', endTime: '09:00', type: 'break', label: 'Lunch' },
    ];
    expect(validateBellSchedule(onlyBreaks, SCHOOL_CONFIG, 'regular')).toContain(
      'Bell schedule must have at least one class period',
    );
    expect(validateBellSchedule(onlyBreaks, SCHOOL_CONFIG, 'testing')).toContain(
      'Bell schedule must have at least one class period',
    );
  });

  it('continues to accept uniform periods for regular days', () => {
    const errors = validateBellSchedule(uniformPeriods, SCHOOL_CONFIG, 'regular');
    expect(errors).toEqual([]);
  });
});
