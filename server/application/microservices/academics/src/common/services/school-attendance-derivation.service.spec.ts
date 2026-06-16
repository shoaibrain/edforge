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

function makeService() {
  const ddb = {
    getClient: jest.fn<any>().mockResolvedValue({}),
    queryGSI: jest.fn<any>(),
    getItem: jest.fn<any>(),
    updateItem: jest.fn<any>(),
    putItem: jest.fn<any>(),
    deleteItem: jest.fn<any>(),
  };
  const service = new SchoolAttendancDerivationService(ddb as any);
  return { service, ddb };
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
