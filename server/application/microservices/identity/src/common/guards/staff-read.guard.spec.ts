import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { StaffReadGuard } from './staff-read.guard';
import { DynamoDBClientService } from '../services/dynamodb-client.service';
import { RoleAssignment } from '../entities/role-assignment.entity';

const ctxFor = (user: unknown, authorization = 'Bearer tok'): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user, headers: { authorization } }) }) as any,
    getHandler: () => undefined,
    getClass: () => undefined,
  }) as unknown as ExecutionContext;

/** Build a guard whose role query resolves to the given (already isActive-filtered) rows. */
function makeGuard(roleRows: Partial<RoleAssignment>[]) {
  const query = jest.fn().mockResolvedValue({ items: roleRows });
  const getClient = jest.fn().mockResolvedValue({});
  const ddb = { getClient, query } as unknown as DynamoDBClientService;
  return { guard: new StaffReadGuard(ddb), query, getClient };
}

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();
const caller = { userId: 'u1', tenantId: 't1', globalRole: 'TenantUser' };

describe('StaffReadGuard', () => {
  it('allows TenantAdmin without querying role assignments', async () => {
    const { guard, query, getClient } = makeGuard([]);
    await expect(
      guard.canActivate(ctxFor({ userId: 'admin', tenantId: 't1', globalRole: 'TenantAdmin' })),
    ).resolves.toBe(true);
    expect(query).not.toHaveBeenCalled();
    expect(getClient).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when the request carries no authenticated user', async () => {
    const { guard } = makeGuard([]);
    await expect(guard.canActivate(ctxFor(undefined))).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctxFor({}))).rejects.toThrow(ForbiddenException);
  });

  it('allows a caller holding a staff-type role (Teacher)', async () => {
    const { guard } = makeGuard([{ role: 'Teacher', isActive: true }]);
    await expect(guard.canActivate(ctxFor(caller))).resolves.toBe(true);
  });

  it.each(['Principal', 'VicePrincipal', 'Accountant', 'Staff', 'Counselor', 'Nurse'] as const)(
    'allows a caller whose role is %s',
    async (role) => {
      const { guard } = makeGuard([{ role, isActive: true }]);
      await expect(guard.canActivate(ctxFor(caller))).resolves.toBe(true);
    },
  );

  it('denies a Parent-only caller', async () => {
    const { guard } = makeGuard([{ role: 'Parent', isActive: true }]);
    await expect(guard.canActivate(ctxFor(caller))).rejects.toThrow(ForbiddenException);
  });

  it('denies a Student-only caller', async () => {
    const { guard } = makeGuard([{ role: 'Student', isActive: true }]);
    await expect(guard.canActivate(ctxFor(caller))).rejects.toThrow(ForbiddenException);
  });

  it('denies a caller with no role assignments', async () => {
    const { guard } = makeGuard([]);
    await expect(guard.canActivate(ctxFor(caller))).rejects.toThrow(ForbiddenException);
  });

  it('allows when a multi-role row mixes Parent with a staff role', async () => {
    const { guard } = makeGuard([{ role: 'Parent', roles: ['Parent', 'Teacher'], isActive: true }]);
    await expect(guard.canActivate(ctxFor(caller))).resolves.toBe(true);
  });

  it('ignores an expired staff role (expiresAt in the past) → denied', async () => {
    const { guard } = makeGuard([{ role: 'Teacher', isActive: true, expiresAt: PAST }]);
    await expect(guard.canActivate(ctxFor(caller))).rejects.toThrow(ForbiddenException);
  });

  it('honors a staff role whose expiresAt is in the future → allowed', async () => {
    const { guard } = makeGuard([{ role: 'Teacher', isActive: true, expiresAt: FUTURE }]);
    await expect(guard.canActivate(ctxFor(caller))).resolves.toBe(true);
  });

  it('scopes the role query to the caller and tenant', async () => {
    const { guard, query, getClient } = makeGuard([{ role: 'Teacher', isActive: true }]);
    await guard.canActivate(ctxFor(caller, 'Bearer abc123'));
    expect(getClient).toHaveBeenCalledWith('t1', 'abc123');
    expect(query).toHaveBeenCalledWith(
      expect.anything(),
      't1',
      'USER#u1#ROLE#',
      expect.any(String),
      { ':isActive': true },
    );
  });
});
