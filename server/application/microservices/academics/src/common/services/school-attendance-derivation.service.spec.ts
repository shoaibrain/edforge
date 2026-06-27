/**
 * SchoolAttendancDerivationService — Layer-2 daily aggregation.
 *
 * Covers (a) the policy-aware status rules (daily_presence vs per_section_granular)
 * and (b) the provenance-precedence invariant that section-derived attendance never
 * overwrites a directly-recorded (authoritative) school-day record.
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { PLATFORM_ATTENDANCE_COUNTING_POLICY, type AttendancePolicy } from '@aibrains/shared-types';
import { SchoolAttendancDerivationService } from './school-attendance-derivation.service';

type AnyFn = jest.Mock<any>;

function makeService(opts: { policy?: AttendancePolicy; threshold?: number } = {}) {
  const ddb = {
    getClient: jest.fn<any>().mockResolvedValue({}),
    queryGSI: jest.fn<any>(),
    getItem: jest.fn<any>(),
    updateItem: jest.fn<any>(),
    putItem: jest.fn<any>(),
    deleteItem: jest.fn<any>(),
  };
  const counting = {
    ...PLATFORM_ATTENDANCE_COUNTING_POLICY,
    granularPresenceThresholdPct: opts.threshold ?? PLATFORM_ATTENDANCE_COUNTING_POLICY.granularPresenceThresholdPct,
  };
  const policyResolver = {
    resolveEffectivePolicy: jest.fn<any>().mockResolvedValue({
      schoolId: 'sch-1',
      effectiveMode: opts.policy ?? 'per_section_granular',
      modeSource: 'platform',
      countingPolicy: counting,
      countingSource: 'platform',
    }),
  };
  const service = new SchoolAttendancDerivationService(ddb as any, policyResolver as any);
  return { service, ddb, policyResolver };
}

const sectionRecords = (...statuses: string[]) => ({
  items: statuses.map((status, i) => ({
    studentId: 'stu-1',
    status,
    academicYearId: 'ay-1',
    studentName: 'Aashik Gupta',
    sectionId: `sec-${i}`,
  })),
});

const schoolRow = (overrides: Record<string, any>) => ({
  entityType: 'SCHOOL_ATTENDANCE',
  schoolAttendanceId: 'sa-1',
  studentId: 'stu-1',
  schoolId: 'sch-1',
  date: '2026-06-16',
  status: 'present',
  version: 3,
  ...overrides,
});

const args = ['ten-1', 'stu-1', 'sch-1', '2026-06-16', 'jwt', 'user-1'] as const;

// Helper: run derivation against a fresh (no existing row) student/date and
// return the status written to the created SCH_ATTEND row.
async function derivedStatusFor(opts: { policy?: AttendancePolicy; threshold?: number }, ...statuses: string[]) {
  const { service, ddb } = makeService(opts);
  ddb.queryGSI.mockResolvedValue(sectionRecords(...statuses));
  ddb.getItem.mockResolvedValue(null);
  await service.deriveSchoolAttendance(...args);
  return (ddb.putItem.mock.calls[0][1] as any).status;
}

describe('SchoolAttendancDerivationService — policy-aware daily status', () => {
  describe('daily_presence (present if attended ANY section)', () => {
    it('present when at least one section is attended, even amid absences', async () => {
      expect(await derivedStatusFor({ policy: 'daily_presence' }, 'absent', 'absent', 'present')).toBe('present');
    });
    it('present when the only attendance is late / half_day (still physically there)', async () => {
      expect(await derivedStatusFor({ policy: 'daily_presence' }, 'late')).toBe('present');
      expect(await derivedStatusFor({ policy: 'daily_presence' }, 'half_day')).toBe('present');
    });
    it('absent when every section is absent', async () => {
      expect(await derivedStatusFor({ policy: 'daily_presence' }, 'absent', 'absent')).toBe('absent');
    });
    it('excused only when all non-attended records are excused (no plain absence)', async () => {
      expect(await derivedStatusFor({ policy: 'daily_presence' }, 'excused', 'excused')).toBe('excused');
      expect(await derivedStatusFor({ policy: 'daily_presence' }, 'excused', 'absent')).toBe('absent');
    });
  });

  describe('per_section_granular (present if attended >= thresholdPct of sections)', () => {
    it('present at exactly the threshold (50% default)', async () => {
      expect(await derivedStatusFor({ policy: 'per_section_granular' }, 'present', 'absent')).toBe('present');
    });
    it('absent below the threshold', async () => {
      expect(await derivedStatusFor({ policy: 'per_section_granular' }, 'present', 'absent', 'absent')).toBe('absent');
    });
    it('respects a higher configured threshold', async () => {
      // 1/2 = 50% < 60% → not present
      expect(await derivedStatusFor({ policy: 'per_section_granular', threshold: 60 }, 'present', 'absent')).toBe('absent');
    });
    it('excused when below threshold and the shortfall is all excused', async () => {
      expect(await derivedStatusFor({ policy: 'per_section_granular' }, 'excused', 'excused')).toBe('excused');
    });
    it('excused sections count in the denominator — a single-present student can collapse to excused', async () => {
      // 1 present / 3 total = 33% < 50%; shortfall (2 excused) has no plain absence → excused.
      expect(await derivedStatusFor({ policy: 'per_section_granular' }, 'present', 'excused', 'excused')).toBe('excused');
    });
    it('absent wins over excused when below threshold and any plain absence is present', async () => {
      // 1 present / 4 total = 25% < 50%; shortfall mixes absent + excused → absent dominates.
      expect(await derivedStatusFor({ policy: 'per_section_granular' }, 'present', 'absent', 'absent', 'excused')).toBe('absent');
    });
  });
});

describe('SchoolAttendancDerivationService — provenance precedence', () => {
  let service: SchoolAttendancDerivationService;
  let ddb: Record<string, AnyFn>;

  beforeEach(() => {
    ({ service, ddb } = makeService());
  });

  it('does NOT overwrite a directly-recorded row (derivedFrom=direct)', async () => {
    ddb.queryGSI.mockResolvedValue(sectionRecords('absent'));
    const direct = schoolRow({ status: 'present', derivedFrom: 'direct' });
    ddb.getItem.mockResolvedValue(direct);

    const result = await service.deriveSchoolAttendance(...args);

    expect(result).toBe(direct);
    expect(ddb.updateItem).not.toHaveBeenCalled();
    expect(ddb.putItem).not.toHaveBeenCalled();
  });

  it('does NOT overwrite a legacy direct row with no provenance tag (derivedFrom absent)', async () => {
    ddb.queryGSI.mockResolvedValue(sectionRecords('absent'));
    const legacy = schoolRow({ status: 'present', derivedFrom: undefined });
    ddb.getItem.mockResolvedValue(legacy);

    const result = await service.deriveSchoolAttendance(...args);

    expect(result).toBe(legacy);
    expect(ddb.updateItem).not.toHaveBeenCalled();
  });

  it('re-derives a section_attendance row when the status changes', async () => {
    // present (existing) -> all-absent sections -> 'absent'
    ddb.queryGSI.mockResolvedValue(sectionRecords('absent', 'absent'));
    ddb.getItem.mockResolvedValue(schoolRow({ status: 'present', derivedFrom: 'section_attendance' }));
    ddb.updateItem.mockResolvedValue(schoolRow({ status: 'absent', derivedFrom: 'section_attendance' }));

    const result = await service.deriveSchoolAttendance(...args);

    expect(ddb.updateItem).toHaveBeenCalledTimes(1);
    const updateValues = ddb.updateItem.mock.calls[0][4] as Record<string, any>;
    expect(updateValues[':status']).toBe('absent');
    expect(updateValues[':derivedFrom']).toBe('section_attendance');
    expect((result as any).status).toBe('absent');
  });

  it('no-ops a section_attendance row whose derived status is unchanged', async () => {
    ddb.queryGSI.mockResolvedValue(sectionRecords('present'));
    const existing = schoolRow({ status: 'present', derivedFrom: 'section_attendance' });
    ddb.getItem.mockResolvedValue(existing);

    const result = await service.deriveSchoolAttendance(...args);

    expect(result).toBe(existing);
    expect(ddb.updateItem).not.toHaveBeenCalled();
  });

  it('creates a derived row when none exists', async () => {
    ddb.queryGSI.mockResolvedValue(sectionRecords('absent'));
    ddb.getItem.mockResolvedValue(null);

    const result = await service.deriveSchoolAttendance(...args);

    expect(ddb.putItem).toHaveBeenCalledTimes(1);
    const created = ddb.putItem.mock.calls[0][1] as any;
    expect(created.derivedFrom).toBe('section_attendance');
    expect(created.status).toBe('absent');
    expect((result as any).status).toBe('absent');
  });

  it('on a CAS-failure retry, does NOT retag a direct row that won the race', async () => {
    ddb.queryGSI.mockResolvedValue(sectionRecords('absent'));
    ddb.getItem
      .mockResolvedValueOnce(schoolRow({ status: 'present', derivedFrom: 'section_attendance' }))
      .mockResolvedValueOnce(schoolRow({ status: 'present', derivedFrom: 'direct', version: 1 }));
    const casError = Object.assign(new Error('CAS'), { name: 'ConditionalCheckFailedException' });
    ddb.updateItem.mockRejectedValueOnce(casError);

    const result = await service.deriveSchoolAttendance(...args);

    expect(ddb.updateItem).toHaveBeenCalledTimes(1);
    expect((result as any).derivedFrom).toBe('direct');
  });

  describe('removeIfDerived (no section records remain)', () => {
    it('deletes a section-derived row', async () => {
      ddb.queryGSI.mockResolvedValue({ items: [] });
      ddb.getItem.mockResolvedValue(schoolRow({ derivedFrom: 'section_attendance' }));

      const result = await service.deriveSchoolAttendance(...args);

      expect(ddb.deleteItem).toHaveBeenCalledTimes(1);
      expect(result).toBeNull();
    });

    it('does NOT delete a directly-recorded row', async () => {
      ddb.queryGSI.mockResolvedValue({ items: [] });
      ddb.getItem.mockResolvedValue(schoolRow({ derivedFrom: 'direct' }));

      const result = await service.deriveSchoolAttendance(...args);

      expect(ddb.deleteItem).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });
});
