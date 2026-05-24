/**
 * StudentTimelineService Spec — Sprint D.2.11
 *
 * Coverage:
 *   - GSI2 student-centric query returns all AYs
 *   - Sort ascending by academicYearId
 *   - fromAyId / toAyId range filter
 *   - limit + over-fetch trimming
 *   - Best-effort AY metadata fallback (getAcademicYears failure does NOT 5xx)
 *   - Invariant 3: every row carries its own enrollmentId
 */

import { describe, expect, it, jest } from '@jest/globals';
import { StudentTimelineService } from './student-timeline.service';
import type { Enrollment } from '../common/entities/enrollment.entity';

type AnyArgs = unknown[];

const TENANT = 'tttttttt-tttt-tttt-tttt-tttttttttttt';
const STUDENT = 'student-uuid';
const SCHOOL = 'school-uuid';
const CTX = {
  userId: 'user-1',
  tenantId: TENANT,
  email: 'op@example.com',
  role: 'TenantAdmin',
  jwtToken: 'jwt',
};

function makeEnrollment(ay: string, enrollmentId: string, gradeLevel = '7'): Enrollment {
  return {
    tenantId: TENANT,
    entityKey: `ENROLLMENT#${SCHOOL}#${ay}#${STUDENT}`,
    entityType: 'ENROLLMENT',
    enrollmentId,
    studentId: STUDENT,
    schoolId: SCHOOL,
    academicYearId: ay,
    gradeLevel,
    status: 'enrolled',
    entryDate: `${ay}-04-15`,
    enrollmentDate: `${ay}-04-15`,
    startDate: `${ay}-04-15`,
    enrollmentType: 'returning',
    createdAt: `${ay}-04-15T00:00:00Z`,
    updatedAt: `${ay}-04-15T00:00:00Z`,
    createdBy: 'user-1',
    updatedBy: 'user-1',
    version: 1,
    gsi1pk: `TENANT#${TENANT}#SCHOOL#${SCHOOL}`,
    gsi1sk: `ENROLLMENT#${ay}#${gradeLevel}`,
    gsi2pk: STUDENT,
    gsi2sk: `ENROLLMENT#${ay}`,
  };
}

function makeService(opts: { years: Enrollment[]; identityYears?: Array<{ yearId: string; name: string; startDate: string; endDate: string }>; identityFail?: boolean } = { years: [] }) {
  const ddb = {
    getClient: jest.fn<(...args: AnyArgs) => Promise<unknown>>().mockResolvedValue({}),
    queryGSI: jest
      .fn<(...args: AnyArgs) => Promise<{ items: Enrollment[]; hasMore: boolean }>>()
      .mockResolvedValue({ items: opts.years, hasMore: false }),
  };
  const identity = {
    getAcademicYears: jest
      .fn<(...args: AnyArgs) => Promise<Array<{ yearId: string; name: string; startDate: string; endDate: string; schoolId: string; status: string; isCurrent: boolean }>>>()
      .mockImplementation(async () => {
        if (opts.identityFail) throw new Error('identity service down');
        return (opts.identityYears ?? []).map((y) => ({
          ...y,
          schoolId: SCHOOL,
          status: 'closed',
          isCurrent: false,
        }));
      }),
  };
  return {
    service: new StudentTimelineService(ddb as never, identity as never),
    ddb,
    identity,
  };
}

// ============================================
// Sort + invariant 3
// ============================================

describe('getTimeline — sort + invariant 3', () => {
  it('returns enrollments sorted ascending by academicYearId', async () => {
    const ay2027 = makeEnrollment('2027', 'e-2027');
    const ay2025 = makeEnrollment('2025', 'e-2025');
    const ay2026 = makeEnrollment('2026', 'e-2026');
    const { service } = makeService({ years: [ay2027, ay2025, ay2026] });

    const result = await service.getTimeline({ studentId: STUDENT }, CTX);

    expect(result.enrollments.map((r) => r.enrollment.academicYearId)).toEqual([
      '2025', '2026', '2027',
    ]);
  });

  it('every returned row carries its own enrollmentId (invariant 3 guard)', async () => {
    const { service } = makeService({
      years: [
        makeEnrollment('2025', 'e-2025'),
        makeEnrollment('2026', 'e-2026'),
      ],
    });
    const result = await service.getTimeline({ studentId: STUDENT }, CTX);
    expect(result.enrollments).toHaveLength(2);
    for (const row of result.enrollments) {
      expect(row.enrollment.enrollmentId).toBeDefined();
      expect(row.enrollment.enrollmentId).not.toBe('');
    }
    // Distinct enrollmentIds across AYs
    const ids = result.enrollments.map((r) => r.enrollment.enrollmentId);
    expect(new Set(ids).size).toBe(2);
  });
});

// ============================================
// Range filter
// ============================================

describe('getTimeline — range filter', () => {
  it('filters fromAyId..toAyId inclusively', async () => {
    const { service } = makeService({
      years: [
        makeEnrollment('2024', 'e-2024'),
        makeEnrollment('2025', 'e-2025'),
        makeEnrollment('2026', 'e-2026'),
        makeEnrollment('2027', 'e-2027'),
      ],
    });
    const result = await service.getTimeline(
      { studentId: STUDENT, fromAyId: '2025', toAyId: '2026' },
      CTX,
    );
    expect(result.enrollments.map((r) => r.enrollment.academicYearId)).toEqual(['2025', '2026']);
  });

  it('limit caps the returned count', async () => {
    const enrollments = Array.from({ length: 100 }, (_, i) =>
      makeEnrollment(`20${(25 + i).toString().padStart(2, '0')}`, `e-${i}`),
    );
    const { service } = makeService({ years: enrollments });
    const result = await service.getTimeline({ studentId: STUDENT, limit: 10 }, CTX);
    expect(result.enrollments).toHaveLength(10);
  });
});

// ============================================
// AY metadata fallback
// ============================================

describe('getTimeline — AY metadata fallback', () => {
  it('attaches AY label/startDate/endDate when identity returns rows', async () => {
    const { service } = makeService({
      years: [makeEnrollment('2026', 'e-2026')],
      identityYears: [
        { yearId: '2026', name: '2026-27', startDate: '2026-04-15', endDate: '2027-03-14' },
      ],
    });
    const result = await service.getTimeline({ studentId: STUDENT }, CTX);
    expect(result.enrollments[0]!.academicYearLabel).toBe('2026-27');
    expect(result.enrollments[0]!.academicYearStartDate).toBe('2026-04-15');
    expect(result.enrollments[0]!.academicYearEndDate).toBe('2027-03-14');
  });

  it('degrades silently when identity getAcademicYears throws (does NOT 5xx)', async () => {
    const { service } = makeService({
      years: [makeEnrollment('2026', 'e-2026')],
      identityFail: true,
    });
    const result = await service.getTimeline({ studentId: STUDENT }, CTX);
    expect(result.enrollments).toHaveLength(1);
    expect(result.enrollments[0]!.academicYearLabel).toBeUndefined();
    expect(result.enrollments[0]!.academicYearStartDate).toBeUndefined();
  });
});
