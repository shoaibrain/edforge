/**
 * `StudentsService.updateStudent` — IEMIS student ID on the update path (#480).
 *
 * CEHRD issues the student IEMIS ID *after* Flash I, so recording it on an
 * existing student is the normal lifecycle rather than a remediation path.
 * Before this change `updateStudentDtoToEntity` omitted the field from its
 * allow-list, so a PATCH carrying it returned 200 and wrote nothing.
 *
 * Making it patchable pulls in three invariants that must hold together —
 * enabling the field without them is exactly the defect #480 describes:
 *
 *   1. write-once — `null -> value` allowed, `value -> different` refused
 *   2. tenant uniqueness — the same GSI7 check `createStudent` runs
 *   3. GSI7 sparse-index keys written alongside the attribute, or the student
 *      is invisible to `findByEmisStudentId` and to IEMIS import dedup
 *
 * Harness mirrors students.service.s1-4.spec.ts — positional stubs, no DI.
 */

import { ConflictException } from '@nestjs/common';
import { StudentsService } from './students.service';

const TENANT = 'tenant-a';
const STUDENT_ID = 'student-1';
const EMIS_ID = '1234567890123456';
const OTHER_EMIS_ID = '9999999999999999';

const ctx = {
  tenantId: TENANT,
  userId: 'user-admin',
  jwtToken: 'jwt',
  role: 'TenantAdmin' as const,
  username: 'admin',
};

function build(opts: { existing?: Partial<any>; emisOwner?: { studentId: string } | null } = {}) {
  const student = {
    studentId: STUDENT_ID,
    tenantId: TENANT,
    firstName: 'Test',
    lastName: 'Student',
    primarySchoolId: 'school-1',
    currentGradeLevel: '1',
    status: 'active',
    version: 1,
    ...opts.existing,
  };

  const dynamoDBClient: any = {
    getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
    getItem: jest.fn().mockResolvedValue(student),
    putItem: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    queryGSI: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    updateItem: jest.fn(async () => ({ ...student })),
  };

  const svc = new (StudentsService as any)(
    dynamoDBClient,
    {
      publishStudentCreated: jest.fn().mockResolvedValue(undefined),
      // Fire-and-forget at students.service.ts:656 — the service calls
      // .catch() on the returned value, so it must be a promise.
      publishStudentUpdated: jest.fn().mockResolvedValue(undefined),
    },
    { getSchool: jest.fn().mockResolvedValue({ schoolId: 'school-1' }) },
    { generateStudentUniqueId: jest.fn() },
    {} as any,
    {} as any,
    {} as any,
  );

  // findByEmisStudentId is the GSI7 lookup both the create and update paths
  // use for uniqueness; stubbed so each case controls who owns the ID.
  svc.findByEmisStudentId = jest.fn().mockResolvedValue(opts.emisOwner ?? null);
  svc.toStudentResponse = jest.fn((s: any) => s);

  return { svc, dynamoDBClient };
}

/** The DDB UpdateExpression fragments and values the service assembled. */
function writtenUpdate(dynamoDBClient: any) {
  const call = dynamoDBClient.updateItem.mock.calls[0];
  if (!call) return null;
  const joined = JSON.stringify(call);
  return {
    raw: joined,
    setsGsi7: joined.includes('gsi7pk'),
    values: call.find((a: any) => a && typeof a === 'object' && !Array.isArray(a) && a[':gsi7pk']) ?? null,
  };
}

describe('updateStudent — emisStudentId (#480)', () => {
  describe('the null -> value lifecycle', () => {
    it('persists the ID on a student that has none', async () => {
      const { svc, dynamoDBClient } = build();
      await svc.updateStudent(STUDENT_ID, { emisStudentId: EMIS_ID }, ctx);

      expect(writtenUpdate(dynamoDBClient)!.raw).toContain(EMIS_ID);
    });

    it('writes the GSI7 keys alongside it', async () => {
      // Without these the student carries the ID but is invisible to
      // findByEmisStudentId, so import dedup and the uniqueness check above
      // both miss them.
      const { svc, dynamoDBClient } = build();
      await svc.updateStudent(STUDENT_ID, { emisStudentId: EMIS_ID }, ctx);

      const written = writtenUpdate(dynamoDBClient)!;
      expect(written.setsGsi7).toBe(true);
      expect(written.raw).toContain(`STUDENT#${STUDENT_ID}`);
    });

    it('checks tenant uniqueness before writing', async () => {
      const { svc } = build();
      await svc.updateStudent(STUDENT_ID, { emisStudentId: EMIS_ID }, ctx);

      expect(svc.findByEmisStudentId).toHaveBeenCalledWith(TENANT, EMIS_ID, ctx.jwtToken);
    });
  });

  describe('tenant uniqueness', () => {
    it('refuses an ID already held by another student', async () => {
      const { svc } = build({ emisOwner: { studentId: 'someone-else' } });

      await expect(
        svc.updateStudent(STUDENT_ID, { emisStudentId: EMIS_ID }, ctx),
      ).rejects.toThrow(ConflictException);
    });

    it('does not treat the student\'s own row as a conflict', async () => {
      // A GSI7 hit pointing back at this same student is not a duplicate.
      const { svc } = build({ emisOwner: { studentId: STUDENT_ID } });

      await expect(
        svc.updateStudent(STUDENT_ID, { emisStudentId: EMIS_ID }, ctx),
      ).resolves.toBeDefined();
    });
  });

  describe('write-once', () => {
    it('refuses re-pointing a student at a different federal record', async () => {
      const { svc } = build({ existing: { emisStudentId: EMIS_ID } });

      await expect(
        svc.updateStudent(STUDENT_ID, { emisStudentId: OTHER_EMIS_ID }, ctx),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses clearing an ID that is already set', async () => {
      const { svc } = build({ existing: { emisStudentId: EMIS_ID } });

      await expect(
        svc.updateStudent(STUDENT_ID, { emisStudentId: '' }, ctx),
      ).rejects.toThrow(ConflictException);
    });

    it('stays idempotent when the same value is re-sent', async () => {
      const { svc } = build({ existing: { emisStudentId: EMIS_ID } });

      await expect(
        svc.updateStudent(STUDENT_ID, { emisStudentId: EMIS_ID }, ctx),
      ).resolves.toBeDefined();
    });

    it('does not consult GSI7 when the value is unchanged', async () => {
      // An idempotent re-send should not pay for a lookup, and must not
      // trip the uniqueness check against its own row.
      const { svc } = build({ existing: { emisStudentId: EMIS_ID } });
      await svc.updateStudent(STUDENT_ID, { emisStudentId: EMIS_ID }, ctx);

      expect(svc.findByEmisStudentId).not.toHaveBeenCalled();
    });
  });

  describe('unrelated patches are untouched', () => {
    it('does not write GSI7 keys when the ID is absent from the patch', async () => {
      const { svc, dynamoDBClient } = build();
      await svc.updateStudent(STUDENT_ID, { firstName: 'Renamed' }, ctx);

      expect(writtenUpdate(dynamoDBClient)!.setsGsi7).toBe(false);
    });

    it('does not consult GSI7 for a patch that omits the ID', async () => {
      const { svc } = build({ existing: { emisStudentId: EMIS_ID } });
      await svc.updateStudent(STUDENT_ID, { firstName: 'Renamed' }, ctx);

      expect(svc.findByEmisStudentId).not.toHaveBeenCalled();
    });
  });
});
