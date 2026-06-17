/**
 * Attendance Domain epic (Sprint 4, §S4.T5) — the policy-weighted rate primitive.
 *
 * `attendanceRateWeight` is the single place the counting policy's rate
 * semantics are interpreted, so every rate computation (daily summary, ADA,
 * reports) stays consistent. These lock the researched Nepal/IEMIS + Ed-Fi
 * defaults.
 */
import {
  attendanceRateWeight,
  attendanceCountingPolicySchema,
  PLATFORM_ATTENDANCE_COUNTING_POLICY,
} from './common-policies';

describe('attendanceRateWeight (platform policy)', () => {
  it('counts present / late / tardy / remote as a full attending day', () => {
    for (const status of ['present', 'late', 'tardy', 'remote']) {
      expect(attendanceRateWeight(status, PLATFORM_ATTENDANCE_COUNTING_POLICY)).toBe(1);
    }
  });

  it('weights half_day as 0.5 (partial-day weight wins over category membership)', () => {
    expect(attendanceRateWeight('half_day', PLATFORM_ATTENDANCE_COUNTING_POLICY)).toBe(0.5);
  });

  it('counts absent as 0', () => {
    expect(attendanceRateWeight('absent', PLATFORM_ATTENDANCE_COUNTING_POLICY)).toBe(0);
  });

  it('reduces the rate for excused (Nepal/IEMIS absent_for_rate default → 0)', () => {
    expect(attendanceRateWeight('excused', PLATFORM_ATTENDANCE_COUNTING_POLICY)).toBe(0);
  });

  it('treats an unknown status as non-attending (0)', () => {
    expect(attendanceRateWeight('early_departure', PLATFORM_ATTENDANCE_COUNTING_POLICY)).toBe(0);
  });

  it('defaults to the platform policy when none is passed', () => {
    expect(attendanceRateWeight('present')).toBe(1);
    expect(attendanceRateWeight('half_day')).toBe(0.5);
  });
});

describe('attendanceRateWeight (excusedTreatment override)', () => {
  const presentForRate = attendanceCountingPolicySchema.parse({ excusedTreatment: 'present_for_rate' });

  it('counts excused as a full day when excusedTreatment=present_for_rate', () => {
    expect(attendanceRateWeight('excused', presentForRate)).toBe(1);
  });
});
