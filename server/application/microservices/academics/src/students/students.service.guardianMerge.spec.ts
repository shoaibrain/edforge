/**
 * `StudentsService.updateStudent` — guardian merge on the update path (#503).
 *
 * The guardians branch SETs the whole array, so any field the client cannot
 * send is destroyed on every write. Two such fields exist:
 *
 *   - `userId` is absent from `guardianSchema` entirely. Zod strips it, the
 *     mapper whitelists it out, and `mapGuardianEntityToDto` never returns it,
 *     so the client cannot echo back what it was never given.
 *   - `hasPortalAccess` is `z.boolean().default(false)`, so Zod materialises
 *     `false` for a guardian the operator did not touch — indistinguishable
 *     from a deliberate revocation.
 *
 * Only `linkGuardianToUser` writes either one. Both are therefore server-owned
 * and must survive a PATCH that merely appends a guardian, which is the
 * ordinary Add Guardian action.
 *
 * The failure is silent and self-sealing: `resolveParentScope` matches on
 * `guardians.some(g => g.userId === userId)`, so a wiped `userId` empties the
 * parent's scope with no error — while `hasPortalAccess` staying true keeps the
 * badge green and hides the Grant Portal Access repair control.
 *
 * Harness mirrors students.service.emisIdUpdate.spec.ts — positional stubs, no DI.
 */

import { StudentsService } from './students.service';

const TENANT = 'tenant-a';
const STUDENT_ID = 'student-1';
const GUARDIAN_A = '11111111-1111-4111-8111-111111111111';
const GUARDIAN_B = '22222222-2222-4222-8222-222222222222';
const LINKED_USER_ID = 'auth-sub-aaaa-bbbb-cccc';

const ctx = {
  tenantId: TENANT,
  userId: 'user-admin',
  jwtToken: 'jwt',
  role: 'TenantAdmin' as const,
  username: 'admin',
};

/** A stored guardian as `linkGuardianToUser` leaves it. */
function storedGuardian(overrides: Record<string, any> = {}) {
  return {
    guardianId: GUARDIAN_A,
    relationship: 'father',
    firstName: 'Guardian',
    lastName: 'One',
    email: 'guardian.one@example.test',
    isPrimary: true,
    canPickup: true,
    hasPortalAccess: true,
    userId: LINKED_USER_ID,
    ...overrides,
  };
}

/** What the client PATCHes back — `guardianSchema` carries no `userId`. */
function payloadGuardian(overrides: Record<string, any> = {}) {
  return {
    guardianId: GUARDIAN_A,
    relationship: 'father' as const,
    firstName: 'Guardian',
    lastName: 'One',
    email: 'guardian.one@example.test',
    isPrimary: true,
    canPickup: true,
    // Zod's default materialises this even when the operator never touched it.
    hasPortalAccess: false,
    ...overrides,
  };
}

function build(opts: { guardians?: any[] } = {}) {
  const student = {
    studentId: STUDENT_ID,
    tenantId: TENANT,
    firstName: 'Test',
    lastName: 'Student',
    primarySchoolId: 'school-1',
    currentGradeLevel: '1',
    status: 'active',
    version: 1,
    guardians: opts.guardians ?? [storedGuardian()],
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
      publishStudentUpdated: jest.fn().mockResolvedValue(undefined),
    },
    { getSchool: jest.fn().mockResolvedValue({ schoolId: 'school-1' }) },
    { generateStudentUniqueId: jest.fn() },
    {} as any,
    {} as any,
    {} as any,
  );

  svc.findByEmisStudentId = jest.fn().mockResolvedValue(null);
  svc.toStudentResponse = jest.fn((s: any) => s);

  return { svc, dynamoDBClient };
}

/** The `:guardians` value the service handed to DynamoDB. */
function writtenGuardians(dynamoDBClient: any): any[] | undefined {
  const call = dynamoDBClient.updateItem.mock.calls[0];
  return call?.[4]?.[':guardians'];
}

describe('updateStudent — guardian merge (#503)', () => {
  describe('appending a guardian (the Add Guardian action)', () => {
    const appendPayload = [
      payloadGuardian(),
      {
        relationship: 'mother' as const,
        firstName: 'Guardian',
        lastName: 'Two',
        isPrimary: false,
        canPickup: true,
        hasPortalAccess: false,
      },
    ];

    it('preserves userId on the guardian already on the record', async () => {
      // The falsifier from the production reproduction: userId still present
      // after an ordinary append.
      const { svc, dynamoDBClient } = build();
      await svc.updateStudent(STUDENT_ID, { guardians: appendPayload }, ctx);

      const written = writtenGuardians(dynamoDBClient)!;
      expect(written.find(g => g.guardianId === GUARDIAN_A).userId).toBe(LINKED_USER_ID);
    });

    it('preserves hasPortalAccess against the Zod default', async () => {
      // The payload says false only because the schema defaults it there.
      const { svc, dynamoDBClient } = build();
      await svc.updateStudent(STUDENT_ID, { guardians: appendPayload }, ctx);

      const written = writtenGuardians(dynamoDBClient)!;
      expect(written.find(g => g.guardianId === GUARDIAN_A).hasPortalAccess).toBe(true);
    });

    it('still adds the new guardian, with a generated id', async () => {
      const { svc, dynamoDBClient } = build();
      await svc.updateStudent(STUDENT_ID, { guardians: appendPayload }, ctx);

      const written = writtenGuardians(dynamoDBClient)!;
      expect(written).toHaveLength(2);
      const added = written.find(g => g.lastName === 'Two');
      expect(added.guardianId).toEqual(expect.any(String));
      expect(added.guardianId).not.toBe(GUARDIAN_A);
    });

    it('does not invent a portal link for the newly added guardian', async () => {
      const { svc, dynamoDBClient } = build();
      await svc.updateStudent(STUDENT_ID, { guardians: appendPayload }, ctx);

      const added = writtenGuardians(dynamoDBClient)!.find(g => g.lastName === 'Two');
      expect(added.userId).toBeUndefined();
      expect(added.hasPortalAccess).toBe(false);
    });
  });

  describe('server-owned fields are not client-writable', () => {
    it('does not grant portal access from the payload alone', async () => {
      // A green badge with no userId is the self-sealing state that hides the
      // Grant Portal Access control. Granting runs through linkGuardianToUser.
      const { svc, dynamoDBClient } = build({
        guardians: [storedGuardian({ hasPortalAccess: false, userId: undefined })],
      });

      await svc.updateStudent(
        STUDENT_ID,
        { guardians: [payloadGuardian({ hasPortalAccess: true })] },
        ctx,
      );

      const written = writtenGuardians(dynamoDBClient)!;
      expect(written[0].hasPortalAccess).toBe(false);
    });

    it('writes no userId key for a guardian that never had one', async () => {
      const { svc, dynamoDBClient } = build({
        guardians: [storedGuardian({ hasPortalAccess: false, userId: undefined })],
      });

      await svc.updateStudent(STUDENT_ID, { guardians: [payloadGuardian()] }, ctx);

      expect(writtenGuardians(dynamoDBClient)![0]).not.toHaveProperty('userId');
    });
  });

  describe('everything else about the branch is unchanged', () => {
    it('still drops a guardian the payload omits', async () => {
      // Delete semantics are the reason this is a SET and must survive.
      const { svc, dynamoDBClient } = build({
        guardians: [storedGuardian(), storedGuardian({ guardianId: GUARDIAN_B, userId: undefined })],
      });

      await svc.updateStudent(STUDENT_ID, { guardians: [payloadGuardian()] }, ctx);

      const written = writtenGuardians(dynamoDBClient)!;
      expect(written).toHaveLength(1);
      expect(written[0].guardianId).toBe(GUARDIAN_A);
    });

    it('still persists ordinary operator edits on a matched guardian', async () => {
      const { svc, dynamoDBClient } = build();

      await svc.updateStudent(
        STUDENT_ID,
        { guardians: [payloadGuardian({ phone: '9800000000', occupation: 'Teacher' })] },
        ctx,
      );

      const written = writtenGuardians(dynamoDBClient)!;
      expect(written[0].phone).toBe('9800000000');
      expect(written[0].occupation).toBe('Teacher');
      expect(written[0].userId).toBe(LINKED_USER_ID);
    });

    // #503 leaves the service's `isPrimary ?? i === 0` fallback exactly as it
    // found it. That fallback is DEAD on BOTH write paths: createStudentDtoToEntity
    // (:211) and updateStudentDtoToEntity (:567) run FIRST, and student.mapper.ts:315
    // coerces `isPrimary` to `false` whenever the client omits it — so the service
    // never sees `undefined` and the `??` never fires. No guardian created or edited
    // through the API is ever marked primary. Pinned here as CURRENT behaviour, not
    // desired: when the fallback is repaired this expectation flips to `true`.
    it('documents the dead isPrimary fallback: the first guardian is NOT made primary', async () => {
      const { svc, dynamoDBClient } = build({ guardians: [] });

      await svc.updateStudent(
        STUDENT_ID,
        {
          guardians: [
            {
              relationship: 'guardian' as const,
              firstName: 'Only',
              lastName: 'One',
              canPickup: true,
              hasPortalAccess: false,
            },
          ],
        },
        ctx,
      );

      expect(writtenGuardians(dynamoDBClient)![0].isPrimary).toBe(false);
    });

    it('leaves guardians alone for a patch that does not carry them', async () => {
      const { svc, dynamoDBClient } = build();
      await svc.updateStudent(STUDENT_ID, { firstName: 'Renamed' }, ctx);

      expect(writtenGuardians(dynamoDBClient)).toBeUndefined();
    });
  });
});
