/**
 * B2 — getStudentProfile currentEnrollment population.
 *
 * Asserts that the student profile's `currentEnrollment` carries:
 *   - `academicYearName` resolved from identity (yearId → name).
 *   - `homeroomId` set to the enrollment's sectionId (the homeroom pointer).
 *   - `homeroomName` resolved from the batch-get of section entities (reusing
 *     the classrooms read — no extra DDB call).
 * And that lookup failures degrade gracefully (field undefined, no throw).
 */

import { StudentsService } from './students.service';

type Mocks = Record<string, jest.Mock>;

const ctx = {
  tenantId: 'tenant-a',
  userId: 'user-admin',
  jwtToken: 'jwt',
  email: 'admin@example.com',
  role: 'TenantAdmin',
};

const studentEntity = {
  tenantId: 'tenant-a',
  entityKey: 'STUDENT#s-1',
  entityType: 'STUDENT',
  studentId: 's-1',
  firstName: 'Priya',
  lastName: 'Adhikari',
  dateOfBirth: '2015-03-13',
  gender: 'female',
  studentNumber: 'S267',
  primarySchoolId: 'school-1',
  currentGradeLevel: '6',
  status: 'active',
  enrollmentDate: '2025-01-01',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

const currentEnrollmentDto = {
  enrollmentId: '11111111-1111-1111-1111-111111111111',
  studentId: 's-1',
  schoolId: 'school-1',
  academicYearId: '22222222-2222-2222-2222-222222222222',
  academicYearName: undefined,
  gradeLevel: '6',
  enrollmentDate: '2025-01-01',
  status: 'enrolled',
  sectionId: 'hr-001',
  homeroomId: undefined,
  homeroomName: undefined,
};

function makeService(opts: {
  getAcademicYears?: jest.Mock;
  batchGetItems?: jest.Mock;
} = {}) {
  const dynamoDBClient: Mocks = {
    getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
    getItem: jest.fn().mockResolvedValue(studentEntity),
    // section enrollments query (classrooms path) — homeroom roster row present
    queryGSI: jest.fn().mockResolvedValue({
      items: [
        {
          studentId: 's-1',
          sectionId: 'hr-001',
          schoolId: 'school-1',
          academicYearId: '22222222-2222-2222-2222-222222222222',
          sectionNumber: 'G6A',
          isActive: true,
        },
      ],
      hasMore: false,
    }),
    batchGetItems:
      opts.batchGetItems ??
      jest.fn().mockResolvedValue([
        {
          entityKey: 'SECTION#school-1#hr-001',
          sectionName: 'Homeroom 6A',
          sectionNumber: 'G6A',
          primaryTeacherName: 'Mr. Sharma',
        },
      ]),
  };
  const identityClient: Mocks = {
    getAcademicYears:
      opts.getAcademicYears ??
      jest.fn().mockResolvedValue([
        { yearId: '22222222-2222-2222-2222-222222222222', name: '2082 BS', schoolId: 'school-1' },
        { yearId: '33333333-3333-3333-3333-333333333333', name: '2081 BS', schoolId: 'school-1' },
      ]),
  };
  const dataScopeService: Mocks = {
    resolveScope: jest.fn().mockResolvedValue({ type: 'school', schoolId: 'school-1' }),
    isStudentInScope: jest.fn().mockReturnValue(true),
  };
  const enrollmentService: Mocks = {
    getStudentEnrollmentHistory: jest.fn().mockResolvedValue([currentEnrollmentDto]),
  };
  const attendanceService: Mocks = {
    getStudentAttendanceSummary: jest.fn().mockRejectedValue(new Error('no attendance')),
  };

  const svc = new (StudentsService as any)(
    dynamoDBClient,
    { publishStudentUpdated: jest.fn() }, // eventsService
    identityClient,
    {}, // studentIdService
    dataScopeService,
    enrollmentService,
    attendanceService,
    { emit: jest.fn() }, // iemisAuditLogger
    {}, // iemisImportJobsService
  );
  return { svc, dynamoDBClient, identityClient, enrollmentService };
}

describe('StudentsService.getStudentProfile — B2 currentEnrollment population', () => {
  it('populates academicYearName (from identity), homeroomId (sectionId), and homeroomName (from section)', async () => {
    const { svc, identityClient } = makeService();

    const profile = await svc.getStudentProfile('s-1', ctx, 'school-1');

    expect(profile.currentEnrollment).toBeDefined();
    expect(profile.currentEnrollment.academicYearName).toBe('2082 BS');
    expect(profile.currentEnrollment.homeroomId).toBe('hr-001');
    expect(profile.currentEnrollment.homeroomName).toBe('Homeroom 6A');
    // One identity HTTP call to resolve the year name.
    expect(identityClient.getAcademicYears).toHaveBeenCalledTimes(1);
  });

  it('falls back to sectionNumber for homeroomName when the section has no sectionName', async () => {
    const { svc } = makeService({
      batchGetItems: jest.fn().mockResolvedValue([
        {
          entityKey: 'SECTION#school-1#hr-001',
          sectionNumber: 'G6A',
          primaryTeacherName: 'Mr. Sharma',
        },
      ]),
    });

    const profile = await svc.getStudentProfile('s-1', ctx, 'school-1');

    expect(profile.currentEnrollment.homeroomName).toBe('G6A');
    expect(profile.currentEnrollment.homeroomId).toBe('hr-001');
  });

  it('degrades gracefully (no throw, year name undefined) when the academic-year lookup fails', async () => {
    const { svc } = makeService({
      getAcademicYears: jest.fn().mockRejectedValue(new Error('identity down')),
    });

    const profile = await svc.getStudentProfile('s-1', ctx, 'school-1');

    expect(profile.currentEnrollment.academicYearName).toBeUndefined();
    // homeroom still resolves — independent of the year lookup.
    expect(profile.currentEnrollment.homeroomId).toBe('hr-001');
    expect(profile.currentEnrollment.homeroomName).toBe('Homeroom 6A');
  });
});
