/**
 * Sprint 1 S1.4 — Student.emisStudentId gate for IEMIS-registered schools.
 *
 * Focused unit coverage of the new pre-create check:
 *   "If school.emisSchoolCode is set and createStudentDto.emisStudentId is
 *    missing → 400 EMIS_STUDENT_ID_REQUIRED"
 *
 * The full createStudent flow is integration-heavy (DDB + identity HTTP
 * + event bus + USI generation). This spec short-circuits by mocking the
 * school-lookup to return the two shapes that matter for the gate, and
 * asserts that downstream DDB writes never land when the gate fires.
 */

import { BadRequestException, ConflictException } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { StudentsService } from './students.service';

type PartialMocks = Record<string, jest.Mock>;

function makeServiceWithMocks(schoolFixture: { emisSchoolCode?: string }) {
  const identityClient: PartialMocks = {
    getSchool: jest.fn().mockResolvedValue({
      schoolId: 'school-1',
      schoolCode: 'WHS',
      emisSchoolCode: schoolFixture.emisSchoolCode,
      name: 'Test School',
      schoolType: 'elementary',
      gradeRange: { start: '1', end: '5' },
      status: 'active',
      timezone: 'Asia/Kathmandu',
      locale: 'ne-NP',
      academicCalendarType: 'annual',
    }),
  };

  const dynamoDBClient: PartialMocks = {
    getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
    getItem: jest.fn().mockResolvedValue(null),
    putItem: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    queryGSI: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
  };

  const studentIdService = { generateStudentUniqueId: jest.fn().mockResolvedValue('WHS-2026-00001') };
  const eventsService = { publishStudentCreated: jest.fn().mockResolvedValue(undefined) };
  const dataScopeService = {} as any;
  const enrollmentService = {} as any;
  const attendanceService = {} as any;

  // StudentsService's constructor pulls in forward-ref modules; passing
  // minimal stubs in the correct positional order is enough for the
  // narrow code path under test.
  const svc = new (StudentsService as any)(
    dynamoDBClient,
    eventsService,
    identityClient,
    studentIdService,
    dataScopeService,
    enrollmentService,
    attendanceService,
  );

  return { svc, identityClient, dynamoDBClient, eventsService };
}

const ctx = {
  tenantId: 'tenant-a',
  userId: 'user-admin',
  jwtToken: 'jwt',
  role: 'TenantAdmin' as const,
  username: 'admin',
};

const studentDtoBase = {
  schoolId: 'school-1',
  firstName: 'Test',
  lastName: 'Student',
  dateOfBirth: '2015-01-01',
  gender: 'male' as const,
  currentGradeLevel: '1',
  guardians: [],
};

describe('StudentsService.createStudent — IEMIS student-ID gate (S1.4)', () => {
  // #481 — this case previously asserted a 400 EMIS_STUDENT_ID_REQUIRED. That
  // gate was the bug: CEHRD issues the student IEMIS ID *after* Flash I, so a
  // new ECED/Grade 1 entrant provably cannot have one at enrolment, and every
  // PABSON school carries an emisSchoolCode. The assertion is inverted rather
  // than deleted, so the regression it now guards is the re-introduction of
  // the gate.
  it('allows creation without emisStudentId at an IEMIS-registered school', async () => {
    const { svc, dynamoDBClient } = makeServiceWithMocks({ emisSchoolCode: '31012345' });

    await expect(svc.createStudent(studentDtoBase as any, ctx)).resolves.toBeDefined();
    expect(dynamoDBClient.putItem).toHaveBeenCalled();
  });

  it('warns when the ID is absent, so an upper-grade intake that should have one is visible', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    try {
      const { svc } = makeServiceWithMocks({ emisSchoolCode: '31012345' });
      await svc.createStudent(studentDtoBase as any, ctx);

      const messages = warn.mock.calls.map(c => String(c[0])).join('\n');
      expect(messages).toContain('without emisStudentId');
      expect(messages).toContain('Flash II');
    } finally {
      warn.mockRestore();
    }
  });

  it('passes the gate when school is IEMIS-registered AND emisStudentId is supplied', async () => {
    const { svc } = makeServiceWithMocks({ emisSchoolCode: '31012345' });

    const dto = { ...studentDtoBase, emisStudentId: '1234567890123456' };
    // Not asserting full flow success — other validations can still
    // short-circuit. The check is that it does NOT fail with the
    // EMIS_STUDENT_ID_REQUIRED errorCode.
    try {
      await svc.createStudent(dto as any, ctx);
    } catch (e: any) {
      expect(e.response?.errorCode).not.toBe('EMIS_STUDENT_ID_REQUIRED');
    }
  });

  it('passes the gate when school has no emisSchoolCode (non-PABSON tenants)', async () => {
    const { svc } = makeServiceWithMocks({ emisSchoolCode: undefined });

    try {
      await svc.createStudent(studentDtoBase as any, ctx);
    } catch (e: any) {
      expect(e.response?.errorCode).not.toBe('EMIS_STUDENT_ID_REQUIRED');
    }
  });

  it('does NOT call the school lookup twice (S0.5 cache flow preserved)', async () => {
    const { svc, identityClient } = makeServiceWithMocks({ emisSchoolCode: undefined });

    try {
      await svc.createStudent(studentDtoBase as any, ctx);
    } catch {
      // ignore downstream failures — we only care about the lookup count
    }
    // The gate reads from the same `school` variable as schoolCode below,
    // so there must be exactly one getSchool call.
    expect(identityClient.getSchool).toHaveBeenCalledTimes(1);
  });

  // #481 — likewise inverted. Other identifiers were never a substitute for
  // the IEMIS ID, and they are still not; the point is simply that their
  // presence or absence no longer decides whether enrolment is possible.
  it('creates regardless of other ID fields when emisStudentId is absent', async () => {
    const { svc, dynamoDBClient } = makeServiceWithMocks({ emisSchoolCode: '31012345' });

    const dto = {
      ...studentDtoBase,
      studentNumber: 'WHS-2026-00001',
      stateStudentId: 'STATE-123',
      // no emisStudentId — issued by CEHRD after Flash I
    };

    await expect(svc.createStudent(dto as any, ctx)).resolves.toBeDefined();
    expect(dynamoDBClient.putItem).toHaveBeenCalled();
  });
});
