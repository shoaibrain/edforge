/**
 * `IdentityClientService.getStudentInfo` — the academics student projection.
 *
 * #505a: academics already returns the student's `enrollmentDate` (the entry
 * date pro-rating keys off); this client used to discard it. These tests pin
 * that it now survives the projection, that an absent/blank value projects to
 * `undefined` rather than `''`, and that a transport failure still degrades to
 * `null` rather than throwing.
 */

import { HttpClientService } from '@app/http-client';
import { IdentityClientService } from './identity-client.service';
import type { RequestContext } from '../entities/base.entity';

const STUDENT_ID = 'student-1';

const ctx = (): RequestContext =>
  ({
    tenantId: 'tenant-a-uuid',
    userId: 'u1',
    jwtToken: 'jwt',
    role: 'Accountant',
    schoolId: 'school-1',
  }) as unknown as RequestContext;

describe('finance IdentityClientService.getStudentInfo (#505a)', () => {
  let service: IdentityClientService;
  let httpClient: { get: jest.Mock };

  beforeEach(() => {
    httpClient = { get: jest.fn() };
    service = new IdentityClientService(httpClient as unknown as HttpClientService);
  });

  it('projects enrollmentDate alongside the existing identifiers', async () => {
    httpClient.get.mockResolvedValue({
      data: {
        studentId: STUDENT_ID,
        firstName: 'A',
        lastName: 'B',
        currentGradeLevel: '6',
        studentNumber: 'R-12',
        emisStudentId: 'E-34',
        enrollmentDate: '2026-08-20',
      },
    });

    const info = await service.getStudentInfo(STUDENT_ID, ctx());

    expect(info).toEqual({
      studentId: STUDENT_ID,
      firstName: 'A',
      lastName: 'B',
      gradeLevel: '6',
      studentNumber: 'R-12',
      emisStudentId: 'E-34',
      enrollmentDate: '2026-08-20',
    });
  });

  it('an absent or blank enrollmentDate projects to undefined, and the rest of the shape is unchanged', async () => {
    httpClient.get.mockResolvedValue({
      data: { studentId: STUDENT_ID, firstName: 'A', lastName: 'B', enrollmentDate: '' },
    });

    const info = await service.getStudentInfo(STUDENT_ID, ctx());

    expect(info?.enrollmentDate).toBeUndefined();
    expect(info?.gradeLevel).toBe('');
  });

  it('transport failure still degrades to null', async () => {
    httpClient.get.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.getStudentInfo(STUDENT_ID, ctx())).resolves.toBeNull();
  });
});
