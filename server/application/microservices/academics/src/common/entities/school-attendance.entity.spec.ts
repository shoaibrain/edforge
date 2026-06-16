/**
 * createSchoolAttendanceEntity — provenance default spec (Sprint 1 / S1.T1).
 *
 * Direct school-day writes (recordAttendance / bulk) build the entity without an
 * explicit `derivedFrom`, so the factory must default it to 'direct'. The
 * derivation service passes derivedFrom='section_attendance' explicitly (spread
 * last), which must win.
 */

import { describe, expect, it } from '@jest/globals';
import { createSchoolAttendanceEntity } from './school-attendance.entity';

const base = {
  status: 'present' as const,
  academicYearId: 'ay-1',
  recordedBy: 'user-1',
  createdAt: '2026-06-16T00:00:00.000Z',
  createdBy: 'user-1',
  updatedAt: '2026-06-16T00:00:00.000Z',
  updatedBy: 'user-1',
  version: 1,
};

describe('createSchoolAttendanceEntity provenance default', () => {
  it("defaults derivedFrom to 'direct' when not provided (direct write path)", () => {
    const entity = createSchoolAttendanceEntity('ten-1', 'sa-1', 'stu-1', 'sch-1', '2026-06-16', { ...base });
    expect(entity.derivedFrom).toBe('direct');
    expect(entity.entityKey).toBe('SCH_ATTEND#2026-06-16#stu-1');
  });

  it("lets an explicit derivedFrom='section_attendance' win (derivation path)", () => {
    const entity = createSchoolAttendanceEntity('ten-1', 'sa-1', 'stu-1', 'sch-1', '2026-06-16', {
      ...base,
      derivedFrom: 'section_attendance',
      derivedAt: '2026-06-16T00:00:00.000Z',
    });
    expect(entity.derivedFrom).toBe('section_attendance');
  });
});
