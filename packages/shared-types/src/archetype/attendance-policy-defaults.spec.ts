/**
 * Attendance Domain epic (Sprint 2, §2.3 / D5) — archetype attendance defaults
 * + the graceful-fallback resolver.
 */
import { activeArchetypeSchema } from '../schemas/identity/tenant.schema';
import {
  ARCHETYPE_ATTENDANCE_POLICY_DEFAULTS,
  ARCHETYPE_ATTENDANCE_COUNTING_DEFAULTS,
  getArchetypeAttendanceDefaults,
} from './attendance-policy-defaults';
import {
  attendanceCountingPolicySchema,
  PLATFORM_ATTENDANCE_COUNTING_POLICY,
} from '../schemas/common-policies';

const ARCHETYPES = activeArchetypeSchema.options;

describe('archetype attendance defaults', () => {
  it('PABSON defaults to daily; GENERIC keeps period (today behavior)', () => {
    expect(ARCHETYPE_ATTENDANCE_POLICY_DEFAULTS.PABSON).toBe('daily');
    expect(ARCHETYPE_ATTENDANCE_POLICY_DEFAULTS.GENERIC).toBe('period');
  });

  it.each(ARCHETYPES)('%s has a counting policy that parses cleanly', (archetype) => {
    expect(() =>
      attendanceCountingPolicySchema.parse(ARCHETYPE_ATTENDANCE_COUNTING_DEFAULTS[archetype]),
    ).not.toThrow();
  });

  it('platform counting policy encodes the researched Nepal/IEMIS + Ed-Fi defaults', () => {
    expect(PLATFORM_ATTENDANCE_COUNTING_POLICY).toEqual({
      attendingCategories: ['present', 'late', 'tardy', 'remote'],
      partialDayWeights: { half_day: 0.5 },
      excusedTreatment: 'absent_for_rate',
      chronicCountsExcused: true,
      chronicThresholdPct: 10,
      atRiskThresholdPct: 90,
    });
  });
});

describe('getArchetypeAttendanceDefaults (graceful fallback)', () => {
  it('resolves PABSON to daily mode (case-insensitive)', () => {
    expect(getArchetypeAttendanceDefaults('PABSON').mode).toBe('daily');
    expect(getArchetypeAttendanceDefaults('pabson').mode).toBe('daily');
  });

  it('resolves GENERIC to period mode', () => {
    expect(getArchetypeAttendanceDefaults('GENERIC').mode).toBe('period');
  });

  it('falls back to platform default (period + platform counting) for unknown/absent archetype', () => {
    expect(getArchetypeAttendanceDefaults(undefined).mode).toBe('period');
    expect(getArchetypeAttendanceDefaults('NAIS_US').mode).toBe('period'); // reserved, not yet runtime-valid
    expect(getArchetypeAttendanceDefaults('garbage').mode).toBe('period');
    expect(getArchetypeAttendanceDefaults(undefined).countingPolicy).toEqual(
      PLATFORM_ATTENDANCE_COUNTING_POLICY,
    );
  });
});
