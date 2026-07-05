/**
 * UsersService Unit Tests
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { AuthService } from '../auth/auth.service';
import { StaffService } from '../staff/staff.service';
import { RoleSyncService } from '../roles/role-sync.service';
import { RequestContext, GlobalRole } from '../common/entities/base.entity';
import { AdminEnableUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import type { UpdateUserDto } from '@aibrains/shared-types';

describe('UsersService', () => {
  let service: UsersService;
  let dynamoDBClient: DynamoDBClientService;
  let eventsService: IdentityEventsService;

  const mockContext: RequestContext = {
    userId: 'admin-user-id',
    tenantId: 'tenant-123',
    email: 'admin@test.com',
    globalRole: 'TenantAdmin' as GlobalRole,
    jwtToken: 'mock-jwt-token',
  };

  const mockUser = {
    tenantId: 'tenant-123',
    entityKey: 'USER#user-123',
    entityType: 'USER' as const,
    userId: 'user-123',
    email: 'test@example.com',
    cognitoUsername: 'test@example.com',
    cognitoSub: 'user-123',
    firstName: 'John',
    lastName: 'Doe',
    globalRole: 'TenantUser' as GlobalRole,
    status: 'active' as const,
    gsi1pk: 'EMAIL#test@example.com',
    gsi1sk: 'TENANT#tenant-123',
    createdAt: '2024-01-01T00:00:00.000Z',
    createdBy: 'admin-user-id',
    updatedAt: '2024-01-01T00:00:00.000Z',
    updatedBy: 'admin-user-id',
    version: 1,
  };

  const mockPreferences = {
    tenantId: 'tenant-123',
    entityKey: 'USER#user-123#PREFS',
    entityType: 'USER_PREFERENCES' as const,
    userId: 'user-123',
    theme: 'light',
    language: 'en',
    timezone: 'America/New_York',
    dateFormat: 'MM/DD/YYYY',
    notifications: { email: true, push: false },
    createdAt: '2024-01-01T00:00:00.000Z',
    createdBy: 'user-123',
    updatedAt: '2024-01-01T00:00:00.000Z',
    updatedBy: 'user-123',
    version: 1,
  };

  // Create properly typed mock objects
  const mockDynamoDBClientService = {
    getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
    getSystemClient: jest.fn().mockReturnValue({ send: jest.fn() }),
    getItem: jest.fn(),
    putItem: jest.fn(),
    updateItem: jest.fn(),
    deleteItem: jest.fn(),
    query: jest.fn(),
    queryGSI: jest.fn(),
    batchWrite: jest.fn(),
    transactWrite: jest.fn(),
    getTableName: jest.fn().mockReturnValue('test-table'),
  };

  const mockIdentityEventsService = {
    publishUserCreated: jest.fn().mockResolvedValue(undefined),
    publishUserUpdated: jest.fn().mockResolvedValue(undefined),
    publishUserDeleted: jest.fn().mockResolvedValue(undefined),
  };

  const mockAuthService = {};

  const mockStaffService = {};

  const mockRoleSyncService = {
    syncRoleAssignment: jest.fn().mockResolvedValue(undefined),
    deactivateRoleAssignment: jest.fn().mockResolvedValue(undefined),
    deactivateAllRoleAssignments: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: DynamoDBClientService,
          useValue: mockDynamoDBClientService,
        },
        {
          provide: IdentityEventsService,
          useValue: mockIdentityEventsService,
        },
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: StaffService,
          useValue: mockStaffService,
        },
        {
          provide: RoleSyncService,
          useValue: mockRoleSyncService,
        },
        {
          provide: UsersService,
          useFactory: (
            db: DynamoDBClientService,
            events: IdentityEventsService,
            auth: AuthService,
            staff: StaffService,
            roleSync: RoleSyncService,
          ) => {
            // Layer 4.5/4.6 — UsersService now takes (analytics wrapper,
            // raw analytics service) as two additional ctor args. Tests
            // don't verify analytics emits — stub both with no-op jest mocks.
            const analyticsStub: any = {
              emitUserCreated: jest.fn(),
              emitUserUpdated: jest.fn(),
              emitUserDisabled: jest.fn(),
            };
            const analyticsRawStub: any = {
              isEnabled: () => false,
              emitAuditLogged: jest.fn().mockResolvedValue(undefined),
            };
            return new UsersService(db, events, auth, staff, roleSync, analyticsStub, analyticsRawStub);
          },
          inject: [DynamoDBClientService, IdentityEventsService, AuthService, StaffService, RoleSyncService],
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    dynamoDBClient = module.get<DynamoDBClientService>(DynamoDBClientService);
    eventsService = module.get<IdentityEventsService>(IdentityEventsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(dynamoDBClient).toBeDefined();
    expect(eventsService).toBeDefined();
  });

  it('should have dynamoDBClient properly injected', () => {
    // Access the private property through bracket notation for testing
    expect((service as any).dynamoDBClient).toBe(dynamoDBClient);
  });

  describe('getUser', () => {
    it('should return a user when found', async () => {
      mockDynamoDBClientService.getItem.mockResolvedValue(mockUser);

      const result = await service.getUser('user-123', mockContext);

      expect(result).toBeDefined();
      expect(result.userId).toBe('user-123');
      expect(result.email).toBe('test@example.com');
      expect(result.firstName).toBe('John');
      expect(result.lastName).toBe('Doe');
    });

    it('should throw NotFoundException when user not found', async () => {
      mockDynamoDBClientService.getItem.mockResolvedValue(null);

      await expect(service.getUser('nonexistent', mockContext))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('listUsers', () => {
    it('should return paginated list of users', async () => {
      mockDynamoDBClientService.query.mockResolvedValue({
        items: [mockUser],
        hasMore: false,
        lastEvaluatedKey: undefined,
      });

      const result = await service.listUsers(mockContext, 50);

      expect(result.items).toHaveLength(1);
      expect(result.hasMore).toBe(false);
      expect(result.items[0].email).toBe('test@example.com');
    });

    it('should handle empty result', async () => {
      mockDynamoDBClientService.query.mockResolvedValue({
        items: [],
        hasMore: false,
        lastEvaluatedKey: undefined,
      });

      const result = await service.listUsers(mockContext);

      expect(result.items).toHaveLength(0);
      expect(result.hasMore).toBe(false);
    });
  });

  describe('updateUser', () => {
    it('should update user fields', async () => {
      const updateDto: UpdateUserDto = {
        firstName: 'Jane',
        lastName: 'Smith',
      };

      mockDynamoDBClientService.getItem.mockResolvedValue(mockUser);
      mockDynamoDBClientService.updateItem.mockResolvedValue({
        ...mockUser,
        firstName: 'Jane',
        lastName: 'Smith',
        updatedAt: '2024-01-02T00:00:00.000Z',
      });

      const result = await service.updateUser('user-123', updateDto, mockContext);

      expect(result.firstName).toBe('Jane');
      expect(result.lastName).toBe('Smith');
      expect(mockIdentityEventsService.publishUserUpdated).toHaveBeenCalledWith(
        'tenant-123',
        'user-123',
        'test@example.com',
        expect.arrayContaining(['firstName', 'lastName'])
      );
    });

    it('should throw NotFoundException when user not found', async () => {
      mockDynamoDBClientService.getItem.mockResolvedValue(null);

      await expect(service.updateUser('nonexistent', { firstName: 'Jane' }, mockContext))
        .rejects.toThrow(NotFoundException);
    });

    it('should return unchanged user when no updates provided', async () => {
      mockDynamoDBClientService.getItem.mockResolvedValue(mockUser);

      const result = await service.updateUser('user-123', {}, mockContext);

      expect(result.firstName).toBe('John');
      expect(mockDynamoDBClientService.updateItem).not.toHaveBeenCalled();
    });
  });

  describe('updateUser — reactivation cascade (S2)', () => {
    const inactiveUser = { ...mockUser, status: 'inactive' as const };
    const userDeactivatedRole = {
      tenantId: 'tenant-123',
      entityKey: 'USER#user-123#ROLE#school-1',
      userId: 'user-123',
      schoolId: 'school-1',
      role: 'Teacher',
      isActive: false,
      deactivationReason: 'User deactivated',
    };

    beforeEach(() => {
      mockDynamoDBClientService.getItem.mockResolvedValue(inactiveUser);
      mockDynamoDBClientService.updateItem.mockResolvedValue({
        ...inactiveUser,
        status: 'active',
      });
    });

    it('cascade-restores ONLY roles removed by the user deactivation, and enables Cognito', async () => {
      mockDynamoDBClientService.query.mockResolvedValue({
        items: [userDeactivatedRole],
      });

      await service.updateUser('user-123', { status: 'active' }, mockContext);

      // The exclusion of individually admin-revoked roles is enforced by the
      // query filter: only rows with deactivationReason 'User deactivated'.
      expect(mockDynamoDBClientService.query).toHaveBeenCalledWith(
        expect.anything(),
        'tenant-123',
        'USER#user-123#ROLE#',
        'isActive = :isActive AND deactivationReason = :reason',
        { ':isActive': false, ':reason': 'User deactivated' }
      );

      // The returned row is restored: isActive true + deactivation fields cleared.
      expect(mockDynamoDBClientService.updateItem).toHaveBeenCalledWith(
        expect.anything(),
        'tenant-123',
        'USER#user-123#ROLE#school-1',
        expect.stringContaining('isActive = :isActive'),
        expect.objectContaining({ ':isActive': true, ':nullVal': null })
      );

      // Cognito re-enabled.
      expect(AdminEnableUserCommand).toHaveBeenCalledWith(
        expect.objectContaining({ Username: inactiveUser.cognitoUsername })
      );
    });

    it('restores nothing when the deactivation removed no roles (no role write)', async () => {
      mockDynamoDBClientService.query.mockResolvedValue({ items: [] });

      await service.updateUser('user-123', { status: 'active' }, mockContext);

      // No role-restore updateItem (only the user-status update runs). A
      // role-restore call is identifiable by the null-clear value.
      expect(mockDynamoDBClientService.updateItem).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.stringContaining('#ROLE#'),
        expect.anything(),
        expect.objectContaining({ ':nullVal': null })
      );
    });

    it('does not run the reactivation cascade for non-active status changes', async () => {
      await service.updateUser('user-123', { status: 'suspended' }, mockContext);
      expect(mockDynamoDBClientService.query).not.toHaveBeenCalled();
    });
  });

  describe('deleteUser', () => {
    it('should soft delete user', async () => {
      mockDynamoDBClientService.getItem.mockResolvedValue(mockUser);
      mockDynamoDBClientService.updateItem.mockResolvedValue({
        ...mockUser,
        status: 'inactive',
      });

      await service.deleteUser('user-123', mockContext);

      expect(mockDynamoDBClientService.updateItem).toHaveBeenCalled();
      expect(mockIdentityEventsService.publishUserDeleted).toHaveBeenCalledWith(
        'tenant-123',
        'user-123',
        'test@example.com'
      );
    });

    it('should throw NotFoundException when user not found', async () => {
      mockDynamoDBClientService.getItem.mockResolvedValue(null);

      await expect(service.deleteUser('nonexistent', mockContext))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('getPreferences', () => {
    it('should return user preferences when found', async () => {
      mockDynamoDBClientService.getItem.mockResolvedValue(mockPreferences);

      const result = await service.getPreferences('user-123', mockContext);

      expect(result.theme).toBe('light');
      expect(result.language).toBe('en');
    });

    it('should create default preferences when not found', async () => {
      mockDynamoDBClientService.getItem.mockResolvedValue(null);
      mockDynamoDBClientService.putItem.mockResolvedValue(undefined);

      const result = await service.getPreferences('user-123', mockContext);

      expect(result).toBeDefined();
      expect(mockDynamoDBClientService.putItem).toHaveBeenCalled();
    });
  });
});
