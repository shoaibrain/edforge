/**
 * Finance entity-level ownership enforcement — the data-scope layer for money.
 *
 * In finance, "Parent/Student see only their own invoices/payments/accounts" is
 * enforced by IdentityClientService.enforceStudentOwnership + getLinkedStudentIds
 * (NOT the academics DataScopeService). These were previously untested. Proves
 * the role bypasses, the Parent/Student ownership denial, and the fail-closed
 * posture (empty linked set or academics outage → deny).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { IdentityClientService } from './identity-client.service';
import { HttpClientService } from '@app/http-client';
import type { RequestContext } from '../entities/base.entity';

const mockHttpClient = { get: jest.fn() };

function ctx(role: string): RequestContext {
  return {
    tenantId: 'tenant-1',
    userId: 'user-1',
    email: 'user@school.org',
    role,
    jwtToken: 'mock-jwt',
  } as RequestContext;
}

describe('IdentityClientService — finance ownership enforcement', () => {
  let service: IdentityClientService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdentityClientService,
        { provide: HttpClientService, useValue: mockHttpClient },
      ],
    }).compile();
    service = module.get<IdentityClientService>(IdentityClientService);
  });

  describe('enforceStudentOwnership', () => {
    it('TenantAdmin bypasses — no role lookup', async () => {
      const roleSpy = jest.spyOn(service, 'getUserRole');
      await expect(service.enforceStudentOwnership('student-9', 'school-1', ctx('TenantAdmin'))).resolves.toBeUndefined();
      expect(roleSpy).not.toHaveBeenCalled();
    });

    it.each(['Principal', 'VicePrincipal', 'Accountant'])(
      '%s bypasses entity-level ownership (no linked-student lookup)',
      async (role) => {
        jest.spyOn(service, 'getUserRole').mockResolvedValue({ role } as any);
        const linkedSpy = jest.spyOn(service, 'getLinkedStudentIds');
        await expect(service.enforceStudentOwnership('any-student', 'school-1', ctx('TenantUser'))).resolves.toBeUndefined();
        expect(linkedSpy).not.toHaveBeenCalled();
      },
    );

    it('Parent owning the student is allowed', async () => {
      jest.spyOn(service, 'getUserRole').mockResolvedValue({ role: 'Parent' } as any);
      jest.spyOn(service, 'getLinkedStudentIds').mockResolvedValue(['student-1']);
      await expect(service.enforceStudentOwnership('student-1', 'school-1', ctx('TenantUser'))).resolves.toBeUndefined();
    });

    it('Parent NOT owning the student is denied (403)', async () => {
      jest.spyOn(service, 'getUserRole').mockResolvedValue({ role: 'Parent' } as any);
      jest.spyOn(service, 'getLinkedStudentIds').mockResolvedValue(['student-1']);
      await expect(service.enforceStudentOwnership('student-2', 'school-1', ctx('TenantUser'))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('Student accessing another student record is denied (403)', async () => {
      jest.spyOn(service, 'getUserRole').mockResolvedValue({ role: 'Student' } as any);
      jest.spyOn(service, 'getLinkedStudentIds').mockResolvedValue(['student-self']);
      await expect(service.enforceStudentOwnership('student-other', 'school-1', ctx('TenantUser'))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('Parent with an empty linked set is denied (fail-closed)', async () => {
      jest.spyOn(service, 'getUserRole').mockResolvedValue({ role: 'Parent' } as any);
      jest.spyOn(service, 'getLinkedStudentIds').mockResolvedValue([]);
      await expect(service.enforceStudentOwnership('student-1', 'school-1', ctx('TenantUser'))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('Staff and other non-parent/student roles pass entity-level (list access already gated by the guard)', async () => {
      jest.spyOn(service, 'getUserRole').mockResolvedValue({ role: 'Staff' } as any);
      await expect(service.enforceStudentOwnership('any-student', 'school-1', ctx('TenantUser'))).resolves.toBeUndefined();
    });

    // FINDING (defense-in-depth): a user with NO role at the school is NOT denied
    // here — enforceStudentOwnership falls through to allow. Entity-level safety
    // therefore relies on the PermissionGuard having denied the roleless user at
    // the route first. Pinned so any change to that reliance is a conscious one.
    it('null role (no role at school) falls through to allow — relies on the guard to deny first', async () => {
      jest.spyOn(service, 'getUserRole').mockResolvedValue(null);
      await expect(service.enforceStudentOwnership('any-student', 'school-1', ctx('TenantUser'))).resolves.toBeUndefined();
    });
  });

  describe('getLinkedStudentIds', () => {
    it('maps the academics /students response to studentIds', async () => {
      mockHttpClient.get.mockResolvedValue({ data: { items: [{ studentId: 's1' }, { studentId: 's2' }] } });
      const ids = await service.getLinkedStudentIds('parent-1', 'school-1', ctx('TenantUser'));
      expect(ids).toEqual(['s1', 's2']);
    });

    it('fails closed to [] when academics is unreachable', async () => {
      mockHttpClient.get.mockRejectedValue(new Error('academics down'));
      const ids = await service.getLinkedStudentIds('parent-1', 'school-1', ctx('TenantUser'));
      expect(ids).toEqual([]);
    });

    it('caches per (tenant, user, school) — second call does not re-hit academics', async () => {
      mockHttpClient.get.mockResolvedValue({ data: { items: [{ studentId: 's1' }] } });
      const c = ctx('TenantUser');
      await service.getLinkedStudentIds('parent-1', 'school-1', c);
      await service.getLinkedStudentIds('parent-1', 'school-1', c);
      expect(mockHttpClient.get).toHaveBeenCalledTimes(1);
    });

    it('does NOT share cache across tenants (same userId/schoolId, different tenant)', async () => {
      mockHttpClient.get
        .mockResolvedValueOnce({ data: { items: [{ studentId: 'tenant1-student' }] } })
        .mockResolvedValueOnce({ data: { items: [{ studentId: 'tenant2-student' }] } });
      const t1 = ctx('TenantUser');
      const t2 = { ...ctx('TenantUser'), tenantId: 'tenant-2' } as RequestContext;

      expect(await service.getLinkedStudentIds('parent-1', 'school-1', t1)).toEqual(['tenant1-student']);
      expect(await service.getLinkedStudentIds('parent-1', 'school-1', t2)).toEqual(['tenant2-student']);
      expect(mockHttpClient.get).toHaveBeenCalledTimes(2);
    });
  });
});
