/**
 * Staff Employment History Service - Unit Tests
 */

import { Test, TestingModule } from '@nestjs/testing';
import { StaffEmploymentHistoryService } from './staff-employment-history.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { RequestContext } from '../common/entities/base.entity';

describe('StaffEmploymentHistoryService', () => {
  let service: StaffEmploymentHistoryService;

  const mockContext: RequestContext = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    email: 'admin@test.com',
    globalRole: 'TenantAdmin',
    jwtToken: 'mock-token',
  };

  const mockDynamoDBClient = {
    getClient: jest.fn().mockResolvedValue('mock-client'),
    putItem: jest.fn().mockResolvedValue(undefined),
    query: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaffEmploymentHistoryService,
        { provide: DynamoDBClientService, useValue: mockDynamoDBClient },
      ],
    }).compile();

    service = module.get<StaffEmploymentHistoryService>(StaffEmploymentHistoryService);

    jest.clearAllMocks();
    mockDynamoDBClient.getClient.mockResolvedValue('mock-client');
    mockDynamoDBClient.putItem.mockResolvedValue(undefined);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================
  // recordStatusChange
  // ============================================

  describe('recordStatusChange', () => {
    it('should create a history entry', async () => {
      const result = await service.recordStatusChange(
        'staff-1',
        'active',
        'on_leave',
        '2025-06-01',
        mockContext,
        'Medical leave',
        'Approved by HR',
        'John Doe',
      );

      expect(result.staffId).toBe('staff-1');
      expect(result.previousStatus).toBe('active');
      expect(result.newStatus).toBe('on_leave');
      expect(result.effectiveDate).toBe('2025-06-01');
      expect(result.reason).toBe('Medical leave');
      expect(result.notes).toBe('Approved by HR');
      expect(result.staffName).toBe('John Doe');
      expect(result.changedByName).toBe('admin@test.com');
      expect(result.historyId).toBeDefined();
      expect(mockDynamoDBClient.putItem).toHaveBeenCalled();
    });

    it('should create a history entry without optional fields', async () => {
      const result = await service.recordStatusChange(
        'staff-2',
        'on_leave',
        'active',
        '2025-07-01',
        mockContext,
      );

      expect(result.staffId).toBe('staff-2');
      expect(result.previousStatus).toBe('on_leave');
      expect(result.newStatus).toBe('active');
      expect(result.reason).toBeUndefined();
      expect(result.notes).toBeUndefined();
    });
  });

  // ============================================
  // listHistory
  // ============================================

  describe('listHistory', () => {
    it('should return empty list when no history exists', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });

      const result = await service.listHistory('staff-1', mockContext);

      expect(result.items).toHaveLength(0);
      expect(result.hasMore).toBe(false);
    });

    it('should return history entries for a staff member', async () => {
      mockDynamoDBClient.query.mockResolvedValue({
        items: [
          {
            id: 'h1',
            staffId: 'staff-1',
            previousStatus: 'active',
            newStatus: 'on_leave',
            effectiveDate: '2025-06-01',
            reason: 'Medical',
            createdAt: '2025-06-01T00:00:00Z',
          },
          {
            id: 'h2',
            staffId: 'staff-1',
            previousStatus: 'on_leave',
            newStatus: 'active',
            effectiveDate: '2025-07-01',
            createdAt: '2025-07-01T00:00:00Z',
          },
        ],
        hasMore: false,
      });

      const result = await service.listHistory('staff-1', mockContext);

      expect(result.items).toHaveLength(2);
      expect(result.items[0].previousStatus).toBe('active');
      expect(result.items[0].newStatus).toBe('on_leave');
      expect(result.items[1].previousStatus).toBe('on_leave');
      expect(result.items[1].newStatus).toBe('active');
    });
  });
});
