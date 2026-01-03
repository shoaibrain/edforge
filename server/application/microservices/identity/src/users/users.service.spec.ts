/**
 * UsersService Unit Tests
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { RequestContext, GlobalRole } from '../common/entities/base.entity';
import { UpdateUserDto } from '../common/dto/user.dto';

describe('UsersService', () => {
  let service: UsersService;
  let mockDynamoDBClient: any;
  let mockEventsService: any;

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
    globalRole: 'StandardUser' as GlobalRole,
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

  beforeEach(async () => {
    // Create fresh mocks for each test
    mockDynamoDBClient = {
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
    };

    mockEventsService = {
      publishUserCreated: jest.fn().mockResolvedValue(undefined),
      publishUserUpdated: jest.fn().mockResolvedValue(undefined),
      publishUserDeleted: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: DynamoDBClientService,
          useFactory: () => mockDynamoDBClient,
        },
        {
          provide: IdentityEventsService,
          useFactory: () => mockEventsService,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getUser', () => {
    it('should return a user when found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(mockUser);

      const result = await service.getUser('user-123', mockContext);

      expect(result).toBeDefined();
      expect(result.userId).toBe('user-123');
      expect(result.email).toBe('test@example.com');
      expect(result.firstName).toBe('John');
      expect(result.lastName).toBe('Doe');
    });

    it('should throw NotFoundException when user not found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(service.getUser('nonexistent', mockContext))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('listUsers', () => {
    it('should return paginated list of users', async () => {
      mockDynamoDBClient.query.mockResolvedValue({
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
      mockDynamoDBClient.query.mockResolvedValue({
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

      mockDynamoDBClient.getItem.mockResolvedValue(mockUser);
      mockDynamoDBClient.updateItem.mockResolvedValue({
        ...mockUser,
        firstName: 'Jane',
        lastName: 'Smith',
        updatedAt: '2024-01-02T00:00:00.000Z',
      });

      const result = await service.updateUser('user-123', updateDto, mockContext);

      expect(result.firstName).toBe('Jane');
      expect(result.lastName).toBe('Smith');
      expect(mockEventsService.publishUserUpdated).toHaveBeenCalledWith(
        'tenant-123',
        'user-123',
        'test@example.com',
        expect.arrayContaining(['firstName', 'lastName'])
      );
    });

    it('should throw NotFoundException when user not found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(service.updateUser('nonexistent', { firstName: 'Jane' }, mockContext))
        .rejects.toThrow(NotFoundException);
    });

    it('should return unchanged user when no updates provided', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(mockUser);

      const result = await service.updateUser('user-123', {}, mockContext);

      expect(result.firstName).toBe('John');
      expect(mockDynamoDBClient.updateItem).not.toHaveBeenCalled();
    });
  });

  describe('deleteUser', () => {
    it('should soft delete user', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(mockUser);
      mockDynamoDBClient.updateItem.mockResolvedValue({
        ...mockUser,
        status: 'inactive',
      });

      await service.deleteUser('user-123', mockContext);

      expect(mockDynamoDBClient.updateItem).toHaveBeenCalled();
      expect(mockEventsService.publishUserDeleted).toHaveBeenCalledWith(
        'tenant-123',
        'user-123',
        'test@example.com'
      );
    });

    it('should throw NotFoundException when user not found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(service.deleteUser('nonexistent', mockContext))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('getPreferences', () => {
    it('should return user preferences when found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(mockPreferences);

      const result = await service.getPreferences('user-123', mockContext);

      expect(result.theme).toBe('light');
      expect(result.language).toBe('en');
    });

    it('should create default preferences when not found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const result = await service.getPreferences('user-123', mockContext);

      expect(result).toBeDefined();
      expect(mockDynamoDBClient.putItem).toHaveBeenCalled();
    });
  });
});
