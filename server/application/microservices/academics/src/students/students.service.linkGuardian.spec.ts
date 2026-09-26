/**
 * `StudentsService.linkGuardianToUser` — the no-match branch (#521).
 *
 * Granting portal access is a two-step flow: the client creates the parent account in Identity,
 * then calls this to record the resulting `userId` on the guardian. Step 1 has therefore already
 * had a side effect by the time this runs.
 *
 * The no-match branch used to log a warning and `return`. The controller responds
 * `{ linked: true }` unconditionally, so a miss was reported to the operator as a success while
 * the freshly created portal account was left with nothing referencing it — and the record kept
 * `hasPortalAccess` in whatever state it was already in.
 *
 * Matching is `guardianId` first, then a case-insensitive email fallback. The fallback cannot
 * rescue a bad `guardianId` for a guardian that has no email, which is the entire imported
 * population in the pilot tenant — so the miss is reachable in practice, not theoretical.
 *
 * Harness mirrors students.service.guardianMerge.spec.ts — positional stubs, no DI.
 */

import { NotFoundException } from '@nestjs/common';
import { StudentsService } from './students.service';

const TENANT = 'tenant-a';
const STUDENT_ID = 'student-1';
const GUARDIAN_A = '11111111-1111-4111-8111-111111111111';
const GUARDIAN_B = '22222222-2222-4222-8222-222222222222';
const UNKNOWN_GUARDIAN = '99999999-9999-4999-8999-999999999999';
const NEW_USER_ID = 'auth-sub-dddd-eeee-ffff';

const ctx = {
  tenantId: TENANT,
  userId: 'user-admin',
  jwtToken: 'jwt',
  role: 'TenantAdmin' as const,
  username: 'admin',
};

function guardian(overrides: Record<string, any> = {}) {
  return {
    guardianId: GUARDIAN_A,
    relationship: 'father',
    firstName: 'Guardian',
    lastName: 'One',
    email: 'guardian.one@example.test',
    isPrimary: true,
    canPickup: true,
    hasPortalAccess: false,
    ...overrides,
  };
}

function build(opts: { guardians?: any[]; student?: any } = {}) {
  const student =
    opts.student === null
      ? null
      : {
          studentId: STUDENT_ID,
          tenantId: TENANT,
          firstName: 'Test',
          lastName: 'Student',
          primarySchoolId: 'school-1',
          currentGradeLevel: '1',
          status: 'active',
          version: 1,
          guardians: opts.guardians ?? [guardian()],
        };

  const dynamoDBClient: any = {
    getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
    getItem: jest.fn().mockResolvedValue(student),
    updateItem: jest.fn().mockResolvedValue(undefined),
  };

  const svc = new (StudentsService as any)(
    dynamoDBClient,
    { publishStudentUpdated: jest.fn().mockResolvedValue(undefined) },
    { getSchool: jest.fn().mockResolvedValue({ schoolId: 'school-1' }) },
    { generateStudentUniqueId: jest.fn() },
    {} as any,
    {} as any,
    {} as any,
  );

  return { svc, dynamoDBClient };
}

/** The `:guardians` value handed to DynamoDB, if a write happened at all. */
function written(dynamoDBClient: any): any[] | undefined {
  return dynamoDBClient.updateItem.mock.calls[0]?.[4]?.[':guardians'];
}

describe('linkGuardianToUser (#521)', () => {
  describe('the matching paths still work', () => {
    it('links by guardianId and marks portal access granted', async () => {
      const { svc, dynamoDBClient } = build();

      await svc.linkGuardianToUser(STUDENT_ID, NEW_USER_ID, GUARDIAN_A, 'ignored@example.test', ctx);

      const out = written(dynamoDBClient);
      expect(out).toHaveLength(1);
      expect(out![0].userId).toBe(NEW_USER_ID);
      expect(out![0].hasPortalAccess).toBe(true);
    });

    it('falls back to the email when guardianId does not match', async () => {
      const { svc, dynamoDBClient } = build();

      await svc.linkGuardianToUser(
        STUDENT_ID,
        NEW_USER_ID,
        UNKNOWN_GUARDIAN,
        'GUARDIAN.ONE@EXAMPLE.TEST', // case-insensitive
        ctx,
      );

      expect(written(dynamoDBClient)![0].userId).toBe(NEW_USER_ID);
    });

    it('links the addressed guardian and leaves the others untouched', async () => {
      const other = guardian({
        guardianId: GUARDIAN_B,
        firstName: 'Guardian',
        lastName: 'Two',
        email: 'guardian.two@example.test',
        isPrimary: false,
      });
      const { svc, dynamoDBClient } = build({ guardians: [guardian(), other] });

      await svc.linkGuardianToUser(STUDENT_ID, NEW_USER_ID, GUARDIAN_B, 'x@example.test', ctx);

      const out = written(dynamoDBClient)!;
      expect(out[1].userId).toBe(NEW_USER_ID);
      expect(out[0].userId).toBeUndefined();
      expect(out[0].hasPortalAccess).toBe(false);
    });
  });

  describe('the no-match branch must fail loudly, not silently succeed', () => {
    it('throws when neither guardianId nor email matches', async () => {
      const { svc } = build();

      await expect(
        svc.linkGuardianToUser(STUDENT_ID, NEW_USER_ID, UNKNOWN_GUARDIAN, 'nobody@example.test', ctx),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('writes nothing when it cannot find the guardian', async () => {
      // The core regression: a miss used to fall through to `{ linked: true }` with no write.
      const { svc, dynamoDBClient } = build();

      await expect(
        svc.linkGuardianToUser(STUDENT_ID, NEW_USER_ID, UNKNOWN_GUARDIAN, 'nobody@example.test', ctx),
      ).rejects.toThrow();

      expect(dynamoDBClient.updateItem).not.toHaveBeenCalled();
    });

    it('throws when the student carries no guardians at all', async () => {
      const { svc } = build({ guardians: [] });

      await expect(
        svc.linkGuardianToUser(STUDENT_ID, NEW_USER_ID, GUARDIAN_A, 'a@example.test', ctx),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws for an email-less guardian when the guardianId is wrong — the imported-cohort case', async () => {
      // Every imported guardian in the pilot tenant has no email, so the fallback cannot save a
      // stale guardianId. This is the reachable production shape of the miss.
      const { svc, dynamoDBClient } = build({ guardians: [guardian({ email: undefined })] });

      await expect(
        svc.linkGuardianToUser(STUDENT_ID, NEW_USER_ID, UNKNOWN_GUARDIAN, 'anything@example.test', ctx),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(dynamoDBClient.updateItem).not.toHaveBeenCalled();
    });

    it('does not put the guardian email in the error message', async () => {
      // The replaced warn log interpolated it; that site is tracked under #506.
      const { svc } = build();
      const email = 'private.address@example.test';

      await expect(
        svc.linkGuardianToUser(STUDENT_ID, NEW_USER_ID, UNKNOWN_GUARDIAN, email, ctx),
      ).rejects.toThrow(expect.not.stringContaining(email) as any);
    });
  });

  it('still throws when the student does not exist', async () => {
    const { svc } = build({ student: null });

    await expect(
      svc.linkGuardianToUser(STUDENT_ID, NEW_USER_ID, GUARDIAN_A, 'a@example.test', ctx),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
