import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { RolesService } from './roles.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { DEFAULT_ROLE_PERMISSIONS } from '../common/entities/role-assignment.entity';
import type { RequestContext } from '../common/entities/base.entity';

const mockClient = { send: jest.fn() };

const mockDynamoDBClient = {
  getClient: jest.fn().mockResolvedValue(mockClient),
  getItem: jest.fn(),
  putItem: jest.fn(),
  updateItem: jest.fn(),
  query: jest.fn(),
};

const adminContext: RequestContext = {
  tenantId: 'tenant-1',
  userId: 'admin-user',
  globalRole: 'TenantAdmin',
  jwtToken: 'mock-jwt',
  email: 'admin@test.edu',
};

const userContext: RequestContext = {
  tenantId: 'tenant-1',
  userId: 'regular-user',
  globalRole: 'TenantUser',
  jwtToken: 'mock-jwt',
  email: 'user@test.edu',
};

const principalContext: RequestContext = {
  tenantId: 'tenant-1',
  userId: 'principal-user',
  globalRole: 'TenantUser',
  jwtToken: 'mock-jwt',
  email: 'principal@test.edu',
};

const mockActiveRole = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  schoolId: 'school-1',
  role: 'Teacher',
  isActive: true,
  assignedAt: '2024-01-01T00:00:00.000Z',
  assignedBy: 'admin-user',
  entityType: 'ROLE_ASSIGNMENT',
  entityKey: 'USER#user-1#ROLE#school-1',
  createdAt: '2024-01-01T00:00:00.000Z',
  createdBy: 'admin-user',
  updatedAt: '2024-01-01T00:00:00.000Z',
  updatedBy: 'admin-user',
  version: 1,
};

describe('RolesService', () => {
  let service: RolesService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesService,
        { provide: DynamoDBClientService, useValue: mockDynamoDBClient },
      ],
    }).compile();

    service = module.get<RolesService>(RolesService);
  });

  describe('assignRole', () => {
    it('should allow TenantAdmin to assign a role', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const result = await service.assignRole('user-1', {
        schoolId: 'school-1',
        role: 'Teacher',
      }, adminContext);

      expect(result.userId).toBe('user-1');
      expect(result.schoolId).toBe('school-1');
      expect(result.role).toBe('Teacher');
      expect(mockDynamoDBClient.putItem).toHaveBeenCalled();
    });

    it('should allow Principal to assign a role at their school', async () => {
      // First call: check assigner's role at school (Principal)
      // Second call: check existing role for target user (none)
      mockDynamoDBClient.getItem
        .mockResolvedValueOnce({ ...mockActiveRole, userId: 'principal-user', role: 'Principal' })
        .mockResolvedValueOnce(null);
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const result = await service.assignRole('user-1', {
        schoolId: 'school-1',
        role: 'Teacher',
      }, principalContext);

      expect(result.role).toBe('Teacher');
    });

    it('should deny non-admin non-principal from assigning roles', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(service.assignRole('user-1', {
        schoolId: 'school-1',
        role: 'Teacher',
      }, userContext)).rejects.toThrow(ForbiddenException);
    });

    it('should block duplicate active role assignment', async () => {
      // For admin context, first getItem is for existing role check
      mockDynamoDBClient.getItem.mockResolvedValue({ ...mockActiveRole, isActive: true });

      await expect(service.assignRole('user-1', {
        schoolId: 'school-1',
        role: 'Teacher',
      }, adminContext)).rejects.toThrow(ConflictException);
    });
  });

  describe('getUserRoles', () => {
    it('should return globalRole and school roles', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue({ globalRole: 'TenantUser' });
      mockDynamoDBClient.query.mockResolvedValue({
        items: [mockActiveRole],
      });

      const result = await service.getUserRoles('user-1', adminContext);

      expect(result.userId).toBe('user-1');
      expect(result.globalRole).toBe('TenantUser');
      expect(result.schoolRoles).toHaveLength(1);
      expect(result.schoolRoles[0].role).toBe('Teacher');
    });

    it('should throw NotFoundException if user not found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(service.getUserRoles('nonexistent', adminContext))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('getRole', () => {
    it('should return role assignment', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(mockActiveRole);

      const result = await service.getRole('user-1', 'school-1', adminContext);

      expect(result.role).toBe('Teacher');
      expect(result.schoolId).toBe('school-1');
    });

    it('should throw NotFoundException if role not found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(service.getRole('user-1', 'school-1', adminContext))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('updateRole', () => {
    it('should allow TenantAdmin to update a role', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(mockActiveRole);
      mockDynamoDBClient.updateItem.mockResolvedValue({
        ...mockActiveRole,
        role: 'VicePrincipal',
      });

      const result = await service.updateRole('user-1', 'school-1', {
        role: 'VicePrincipal',
      }, adminContext);

      expect(result.role).toBe('VicePrincipal');
    });

    it('should deny non-admin non-principal from updating roles', async () => {
      mockDynamoDBClient.getItem
        .mockResolvedValueOnce(mockActiveRole) // existing role
        .mockResolvedValueOnce(null); // assigner has no role

      await expect(service.updateRole('user-1', 'school-1', {
        role: 'VicePrincipal',
      }, userContext)).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if role not found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(service.updateRole('user-1', 'school-1', {
        role: 'VicePrincipal',
      }, adminContext)).rejects.toThrow(NotFoundException);
    });
  });

  describe('deactivateRole', () => {
    it('should allow TenantAdmin to deactivate a role', async () => {
      mockDynamoDBClient.updateItem.mockResolvedValue(undefined);

      await service.deactivateRole('user-1', 'school-1', {
        reason: 'End of term',
      }, adminContext);

      expect(mockDynamoDBClient.updateItem).toHaveBeenCalled();
    });

    it('should deny non-admin non-principal from deactivating roles', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(service.deactivateRole('user-1', 'school-1', {
        reason: 'Unauthorized',
      }, userContext)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('checkPermission', () => {
    it('should allow TenantAdmin full access', async () => {
      const result = await service.checkPermission({
        resource: 'students',
        action: 'delete',
        schoolId: 'school-1',
      }, adminContext);

      expect(result.allowed).toBe(true);
    });

    it('should deny when no school specified', async () => {
      const result = await service.checkPermission({
        resource: 'students',
        action: 'view',
      } as any, userContext);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('School context');
    });

    it('should deny when user has no role at school', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      const result = await service.checkPermission({
        resource: 'students',
        action: 'view',
        schoolId: 'school-1',
      }, userContext);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('No active role');
    });

    it('should deny when role is inactive', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue({
        ...mockActiveRole,
        isActive: false,
      });

      const result = await service.checkPermission({
        resource: 'students',
        action: 'view',
        schoolId: 'school-1',
      }, userContext);

      expect(result.allowed).toBe(false);
    });

    it('should deny when role is expired', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue({
        ...mockActiveRole,
        expiresAt: '2020-01-01T00:00:00.000Z',
      });

      const result = await service.checkPermission({
        resource: 'students',
        action: 'view',
        schoolId: 'school-1',
      }, userContext);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('expired');
    });

    it('should allow action matching multi-action default permission', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue({
        ...mockActiveRole,
        role: 'VicePrincipal',
      });

      // VicePrincipal has 'students:view,edit'
      const result = await service.checkPermission({
        resource: 'students',
        action: 'edit',
        schoolId: 'school-1',
      }, userContext);

      expect(result.allowed).toBe(true);
    });

    it('should deny action not in multi-action permission', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue({
        ...mockActiveRole,
        role: 'VicePrincipal',
      });

      // VicePrincipal has 'students:view,edit' but not 'delete'
      const result = await service.checkPermission({
        resource: 'students',
        action: 'delete',
        schoolId: 'school-1',
      }, userContext);

      expect(result.allowed).toBe(false);
    });

    it('should allow wildcard permission', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue({
        ...mockActiveRole,
        role: 'Principal',
      });

      // Principal has 'students:*'
      const result = await service.checkPermission({
        resource: 'students',
        action: 'delete',
        schoolId: 'school-1',
      }, userContext);

      expect(result.allowed).toBe(true);
    });

    it('should respect override allow', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue({
        ...mockActiveRole,
        role: 'Staff', // Staff only has students:view
        permissionOverrides: [
          { resource: 'students', action: 'edit', effect: 'allow' },
        ],
      });

      const result = await service.checkPermission({
        resource: 'students',
        action: 'edit',
        schoolId: 'school-1',
      }, userContext);

      expect(result.allowed).toBe(true);
    });

    it('should respect override deny', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue({
        ...mockActiveRole,
        role: 'Principal', // Principal has students:*
        permissionOverrides: [
          { resource: 'students', action: 'delete', effect: 'deny' },
        ],
      });

      const result = await service.checkPermission({
        resource: 'students',
        action: 'delete',
        schoolId: 'school-1',
      }, userContext);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('explicitly denied');
    });

    it('should apply deny-wins when both allow and deny overrides match', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue({
        ...mockActiveRole,
        role: 'Teacher',
        permissionOverrides: [
          { resource: 'students', action: 'edit', effect: 'allow' },
          { resource: 'students', action: 'edit', effect: 'deny' },
        ],
      });

      const result = await service.checkPermission({
        resource: 'students',
        action: 'edit',
        schoolId: 'school-1',
      }, userContext);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('explicitly denied');
    });

    it('should deny Teacher from accessing ungranted resources', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(mockActiveRole);

      // Teacher does not have 'billing:view'
      const result = await service.checkPermission({
        resource: 'billing',
        action: 'view',
        schoolId: 'school-1',
      }, userContext);

      expect(result.allowed).toBe(false);
    });
  });
});
