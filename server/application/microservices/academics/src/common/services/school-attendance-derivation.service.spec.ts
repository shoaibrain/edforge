/**
 * SchoolAttendancDerivationService — provenance precedence spec (Sprint 1 / S1.T2).
 *
 * Locks the invariant that section-derived attendance never overwrites a
 * directly-recorded (authoritative) school-day record:
 *   - existing derivedFrom='direct'      → returned untouched (no update/delete);
 *   - existing derivedFrom absent (legacy direct) → returned untouched;
 *   - existing derivedFrom='section_attendance' → re-derived when status changes;
 *   - no section records → only a derived row is removed, a direct row survives.
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { SchoolAttendancDerivationService } from './school-attendance-derivation.service';

type AnyFn = jest.Mock<any>;

function makeService(mode: string = 'period') {
  const ddb = {
    getClient: jest.fn<any>().mockResolvedValue({}),
    queryGSI: jest.fn<any>(),
    getItem: jest.fn<any>(),
    updateItem: jest.fn<any>(),
    putItem: jest.fn<any>(),
    deleteItem: jest.fn<any>(),
  };
  // S4.T4: derivation now resolves the school's effective mode. Default 'period'
  // keeps every existing precedence test deriving (byte-unchanged); 'daily'
  // suppresses derivation.
  const policyResolver = { resolveEffectivePolicy: jest.fn<any>().mockResolvedValue({ effectiveMode: mode }) };
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

describe('SchoolAttendancDerivationService — provenance precedence', () => {
  let service: SchoolAttendancDerivationService;
  let ddb: Record<string, AnyFn>;

  beforeEach(() => {
    ({ service, ddb } = makeService());
  });

  it('does NOT overwrite a directly-recorded row (derivedFrom=direct)', async () => {
    ddb.queryGSI.mockResolvedValue(sectionRecords('absent')); // derived would be 'absent'
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

  it('re-derives a section_attendance row when the worst status changes', async () => {
    ddb.queryGSI.mockResolvedValue(sectionRecords('absent', 'present'));
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
    ddb.queryGSI.mockResolvedValue(sectionRecords('late'));
    ddb.getItem.mockResolvedValue(null);

    const result = await service.deriveSchoolAttendance(...args);

    expect(ddb.putItem).toHaveBeenCalledTimes(1);
    const created = ddb.putItem.mock.calls[0][1] as any;
    expect(created.derivedFrom).toBe('section_attendance');
    expect(created.status).toBe('late');
    expect((result as any).status).toBe('late');
  });

  it('on a CAS-failure retry, does NOT retag a direct row that won the race', async () => {
    ddb.queryGSI.mockResolvedValue(sectionRecords('absent')); // derived → 'absent'
    ddb.getItem
      // initial read: a section-derived row with a different status → enters update path
      .mockResolvedValueOnce(schoolRow({ status: 'present', derivedFrom: 'section_attendance' }))
      // retry re-read: a direct write won the race in the meantime
      .mockResolvedValueOnce(schoolRow({ status: 'present', derivedFrom: 'direct', version: 1 }));
    const casError = Object.assign(new Error('CAS'), { name: 'ConditionalCheckFailedException' });
    ddb.updateItem.mockRejectedValueOnce(casError);

    const result = await service.deriveSchoolAttendance(...args);

    expect(ddb.updateItem).toHaveBeenCalledTimes(1); // first attempt only — no retag retry
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

describe('SchoolAttendancDerivationService — S4.T4 policy honoring (write)', () => {
  it('suppresses derivation entirely in a daily school (homeroom roll-call is authoritative)', async () => {
    const { service, ddb } = makeService('daily');

    const result = await service.deriveSchoolAttendance('ten-1', 'stu-1', 'sch-1', '2026-06-16', 'jwt', 'user-1');

    expect(result).toBeNull();
    // Fully short-circuited: no section query, no read, no write.
    expect(ddb.queryGSI).not.toHaveBeenCalled();
    expect(ddb.getItem).not.toHaveBeenCalled();
    expect(ddb.putItem).not.toHaveBeenCalled();
    expect(ddb.updateItem).not.toHaveBeenCalled();
    expect(ddb.deleteItem).not.toHaveBeenCalled();
  });

  it('still derives in a period school (regression: period byte-unchanged)', async () => {
    const { service, ddb } = makeService('period');
    ddb.queryGSI.mockResolvedValue(sectionRecords('absent'));
    ddb.getItem.mockResolvedValue(null);

    await service.deriveSchoolAttendance('ten-1', 'stu-1', 'sch-1', '2026-06-16', 'jwt', 'user-1');

    expect(ddb.putItem).toHaveBeenCalledTimes(1); // derivation ran
  });
});

describe('SchoolAttendancDerivationService — S4.T4 mode cache is per-tenant', () => {
  it("does not serve one tenant's mode to another tenant sharing a schoolId", async () => {
    const ddb = {
      getClient: jest.fn<any>().mockResolvedValue({}),
      queryGSI: jest.fn<any>().mockResolvedValue(sectionRecords('absent')),
      getItem: jest.fn<any>().mockResolvedValue(null),
      updateItem: jest.fn<any>(),
      putItem: jest.fn<any>(),
      deleteItem: jest.fn<any>(),
    };
    const resolveEffectivePolicy = jest.fn<any>().mockImplementation((_s: string, ctx: any) =>
      Promise.resolve({ effectiveMode: ctx.tenantId === 'ten-daily' ? 'daily' : 'period' }));
    const service = new SchoolAttendancDerivationService(ddb as any, { resolveEffectivePolicy } as any);

    // Tenant A is daily over schoolId 'sch-shared' → derivation suppressed.
    const a = await service.deriveSchoolAttendance('ten-daily', 'stu-1', 'sch-shared', '2026-06-16', 'jwt', 'user-1');
    expect(a).toBeNull();
    expect(ddb.queryGSI).not.toHaveBeenCalled();

    // Tenant B shares the schoolId but is period — must NOT hit A's cached
    // 'daily' (would happen if the cache were keyed by schoolId alone); derives.
    await service.deriveSchoolAttendance('ten-period', 'stu-1', 'sch-shared', '2026-06-16', 'jwt', 'user-1');
    expect(ddb.queryGSI).toHaveBeenCalledTimes(1);
    expect(resolveEffectivePolicy).toHaveBeenCalledTimes(2);
  });
});
