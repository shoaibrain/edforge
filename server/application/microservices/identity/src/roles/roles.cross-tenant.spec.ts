import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { RolesService } from './roles.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import type { RequestContext } from '../common/entities/base.entity';

const mockClient = { send: jest.fn() };

const mockDynamoDBClient = {
  getClient: jest.fn().mockResolvedValue(mockClient),
  getItem: jest.fn(),
  putItem: jest.fn(),
  updateItem: jest.fn(),
  query: jest.fn(),
};

const tenantAContext: RequestContext = {
  tenantId: 'tenant-A',
  userId: 'admin-A',
  globalRole: 'TenantAdmin',
  jwtToken: 'mock-jwt-A',
  email: 'admin@tenant-a.edu',
};

const tenantBContext: RequestContext = {
  tenantId: 'tenant-B',
  userId: 'user-B',
  globalRole: 'TenantUser',
  jwtToken: 'mock-jwt-B',
  email: 'user@tenant-b.edu',
};

describe('RolesService - Cross-Tenant Isolation', () => {
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

  describe('getUserRoles', () => {
    it('should return empty when querying user from different tenant', async () => {
      // DynamoDB returns null because the partition key (tenantId) won't match
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(
        service.getUserRoles('user-from-tenant-A', tenantBContext)
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getRole', () => {
    it('should throw NotFoundException for cross-tenant role lookup', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(
        service.getRole('user-from-tenant-A', 'school-1', tenantBContext)
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('checkPermission', () => {
    it('should deny permission when user has no role in other tenant school', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      const result = await service.checkPermission(
        { resource: 'students', action: 'view', schoolId: 'school-from-tenant-A' },
        tenantBContext
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('No active role');
    });
  });

  describe('assignRole', () => {
    it('should not allow cross-tenant role assignment (DynamoDB isolation)', async () => {
      // Non-admin in tenant-B tries to assign role
      // getItem returns null (no Principal role found in tenant-B for that school)
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(
        service.assignRole('user-from-tenant-A', {
          schoolId: 'school-from-tenant-A',
          role: 'Teacher',
        }, tenantBContext)
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('partition key isolation', () => {
    it('should pass correct tenantId to DynamoDB for all operations', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      // Attempt getUserRoles — should use tenantAContext.tenantId
      try {
        await service.getUserRoles('some-user', tenantAContext);
      } catch {
        // Expected NotFoundException
      }

      // Verify the DynamoDB client was called with tenant-A's tenantId
      expect(mockDynamoDBClient.getClient).toHaveBeenCalledWith('tenant-A', 'mock-jwt-A');
      expect(mockDynamoDBClient.getItem).toHaveBeenCalledWith(
        mockClient,
        'tenant-A',
        expect.any(String)
      );
    });
  });
});
