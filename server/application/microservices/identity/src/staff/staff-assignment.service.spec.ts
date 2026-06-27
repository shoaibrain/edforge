/**
 * Staff Assignment Service - Unit Tests
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { StaffAssignmentService } from './staff-assignment.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { RoleSyncService } from '../roles/role-sync.service';
import { IemisAuditLogger } from '../common/services/iemis-audit-logger.service';
import { RequestContext } from '../common/entities/base.entity';

describe('StaffAssignmentService', () => {
  let service: StaffAssignmentService;

  const mockContext: RequestContext = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    email: 'admin@test.com',
    globalRole: 'TenantAdmin',
    jwtToken: 'mock-token',
  };

  const mockDynamoDBClient = {
    getClient: jest.fn().mockResolvedValue('mock-client'),
    getItem: jest.fn(),
    putItem: jest.fn().mockResolvedValue(undefined),
    updateItem: jest.fn(),
    query: jest.fn(),
    queryGSI: jest.fn(),
  };

  const mockEventsService = {
    publishEvent: jest.fn().mockResolvedValue(undefined),
  };

  const mockRoleSyncService = {
    syncRoleAssignment: jest.fn().mockResolvedValue(undefined),
    deactivateRoleAssignment: jest.fn().mockResolvedValue(undefined),
    deactivateAllRoleAssignments: jest.fn().mockResolvedValue(undefined),
  };

  const mockIemisAuditLogger = {
    emit: jest.fn().mockResolvedValue(null),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaffAssignmentService,
        { provide: DynamoDBClientService, useValue: mockDynamoDBClient },
        { provide: IdentityEventsService, useValue: mockEventsService },
        { provide: RoleSyncService, useValue: mockRoleSyncService },
        { provide: IemisAuditLogger, useValue: mockIemisAuditLogger },
      ],
    }).compile();

    service = module.get<StaffAssignmentService>(StaffAssignmentService);

    // Reset mocks
    jest.clearAllMocks();
    mockDynamoDBClient.getClient.mockResolvedValue('mock-client');
    mockDynamoDBClient.putItem.mockResolvedValue(undefined);
    mockEventsService.publishEvent.mockResolvedValue(undefined);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================
  // createAssignment
  // ============================================

  describe('createAssignment', () => {
    const mockStaff = {
      tenantId: 'tenant-1',
      entityKey: 'STAFF#staff-1',
      entityType: 'STAFF',
      staffId: 'staff-1',
      firstName: 'John',
      lastSurname: 'Doe',
      email: 'john@test.com',
    };

    it('should create an assignment when staff exists and no duplicate', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(mockStaff);
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });

      const result = await service.createAssignment('staff-1', {
        schoolId: 'school-1',
        role: 'teacher',
        isPrimary: false,
        beginDate: '2025-08-01',
      }, mockContext);

      expect(result.staffId).toBe('staff-1');
      expect(result.schoolId).toBe('school-1');
      expect(result.role).toBe('teacher');
      expect(result.assignmentStatus).toBe('active');
      expect(result.staffName).toBe('John Doe');
      expect(mockDynamoDBClient.putItem).toHaveBeenCalled();
    });

    it('should throw NotFoundException when staff does not exist', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(
        service.createAssignment('nonexistent', {
          schoolId: 'school-1',
          role: 'teacher',
          isPrimary: false,
          beginDate: '2025-08-01',
        }, mockContext)
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException for duplicate active assignment at same school', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(mockStaff);
      mockDynamoDBClient.query.mockResolvedValue({
        items: [{
          id: 'existing-assign',
          staffId: 'staff-1',
          schoolId: 'school-1',
          assignmentStatus: 'active',
          role: 'teacher',
          isPrimary: false,
          beginDate: '2025-01-01',
          createdAt: '2025-01-01',
          updatedAt: '2025-01-01',
        }],
        hasMore: false,
      });

      await expect(
        service.createAssignment('staff-1', {
          schoolId: 'school-1',
          role: 'teacher',
          isPrimary: false,
          beginDate: '2025-08-01',
        }, mockContext)
      ).rejects.toThrow(ConflictException);
    });

    it('should update Staff primarySchoolId when isPrimary is true', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(mockStaff);
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });

      await service.createAssignment('staff-1', {
        schoolId: 'school-2',
        role: 'principal',
        isPrimary: true,
        beginDate: '2025-08-01',
      }, mockContext);

      // putItem for assignment + updateItem for staff primarySchoolId
      expect(mockDynamoDBClient.putItem).toHaveBeenCalled();
      expect(mockDynamoDBClient.updateItem).toHaveBeenCalledWith(
        'mock-client',
        'tenant-1',
        'STAFF#staff-1',
        expect.stringContaining('primarySchoolId'),
        expect.objectContaining({ ':schoolId': 'school-2' })
      );
    });
  });

  // ============================================
  // getAssignment
  // ============================================

  describe('getAssignment', () => {
    it('should return assignment when found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue({
        id: 'assign-1',
        staffId: 'staff-1',
        schoolId: 'school-1',
        role: 'teacher',
        isPrimary: true,
        beginDate: '2025-08-01',
        assignmentStatus: 'active',
        createdAt: '2025-01-01',
        updatedAt: '2025-01-01',
      });

      const result = await service.getAssignment('staff-1', 'assign-1', mockContext);

      expect(result.assignmentId).toBe('assign-1');
      expect(result.schoolId).toBe('school-1');
      expect(result.role).toBe('teacher');
    });

    it('should throw NotFoundException when not found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(
        service.getAssignment('staff-1', 'nonexistent', mockContext)
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================
  // listAssignmentsForStaff
  // ============================================

  describe('listAssignmentsForStaff', () => {
    it('should return empty list when no assignments exist', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });

      const result = await service.listAssignmentsForStaff('staff-1', mockContext);

      expect(result.items).toHaveLength(0);
      expect(result.hasMore).toBe(false);
    });

    it('should return assignments for a staff member', async () => {
      mockDynamoDBClient.query.mockResolvedValue({
        items: [
          {
            id: 'a1',
            staffId: 'staff-1',
            schoolId: 'school-1',
            role: 'teacher',
            isPrimary: true,
            beginDate: '2025-01-01',
            assignmentStatus: 'active',
            createdAt: '2025-01-01',
            updatedAt: '2025-01-01',
          },
          {
            id: 'a2',
            staffId: 'staff-1',
            schoolId: 'school-2',
            role: 'substitute',
            isPrimary: false,
            beginDate: '2025-03-01',
            assignmentStatus: 'active',
            createdAt: '2025-03-01',
            updatedAt: '2025-03-01',
          },
        ],
        hasMore: false,
      });

      const result = await service.listAssignmentsForStaff('staff-1', mockContext);

      expect(result.items).toHaveLength(2);
      expect(result.items[0].schoolId).toBe('school-1');
      expect(result.items[1].schoolId).toBe('school-2');
    });
  });

  // ============================================
  // listAssignmentsBySchool
  // ============================================

  describe('listAssignmentsBySchool', () => {
    it('should return assignments for a school via GSI', async () => {
      mockDynamoDBClient.queryGSI.mockResolvedValue({
        items: [
          {
            id: 'a1',
            staffId: 'staff-1',
            schoolId: 'school-1',
            role: 'teacher',
            isPrimary: true,
            beginDate: '2025-01-01',
            assignmentStatus: 'active',
            staffName: 'John Doe',
            createdAt: '2025-01-01',
            updatedAt: '2025-01-01',
          },
        ],
        hasMore: false,
      });

      const result = await service.listAssignmentsBySchool('school-1', mockContext);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].staffName).toBe('John Doe');
    });
  });

  // ============================================
  // updateAssignment
  // ============================================

  describe('updateAssignment', () => {
    it('should update assignment fields', async () => {
      const existing = {
        id: 'assign-1',
        staffId: 'staff-1',
        schoolId: 'school-1',
        role: 'teacher',
        isPrimary: false,
        beginDate: '2025-01-01',
        assignmentStatus: 'active',
        createdAt: '2025-01-01',
        updatedAt: '2025-01-01',
        version: 1,
      };

      mockDynamoDBClient.getItem
        // 1) the existing assignment
        .mockResolvedValueOnce(existing)
        // 2) resolveDepartment lookup: an active department for this school
        .mockResolvedValueOnce({ departmentId: 'Science', name: 'Science', isActive: true })
        // 3+) any later reads (e.g. staff-for-role-sync)
        .mockResolvedValue(existing);
      mockDynamoDBClient.updateItem.mockResolvedValue({
        ...existing,
        departmentId: 'Science',
        departmentName: 'Science',
        positionTitle: 'Head of Science',
        version: 2,
      });

      const result = await service.updateAssignment('staff-1', 'assign-1', {
        departmentId: 'Science',
        positionTitle: 'Head of Science',
      }, mockContext);

      expect(result.departmentId).toBe('Science');
      expect(result.positionTitle).toBe('Head of Science');
    });

    it('should throw NotFoundException when assignment not found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(
        service.updateAssignment('staff-1', 'nonexistent', { departmentId: 'Math' }, mockContext)
      ).rejects.toThrow(NotFoundException);
    });

    it('should return unchanged assignment when no fields provided', async () => {
      const existing = {
        id: 'assign-1',
        staffId: 'staff-1',
        schoolId: 'school-1',
        role: 'teacher',
        isPrimary: false,
        beginDate: '2025-01-01',
        assignmentStatus: 'active',
        createdAt: '2025-01-01',
        updatedAt: '2025-01-01',
      };

      mockDynamoDBClient.getItem.mockResolvedValue(existing);

      const result = await service.updateAssignment('staff-1', 'assign-1', {}, mockContext);

      expect(result.assignmentId).toBe('assign-1');
      expect(mockDynamoDBClient.updateItem).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // endAssignment
  // ============================================

  describe('endAssignment', () => {
    it('should end an active assignment', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue({
        id: 'assign-1',
        staffId: 'staff-1',
        schoolId: 'school-1',
        assignmentStatus: 'active',
      });
      mockDynamoDBClient.updateItem.mockResolvedValue(undefined);

      await service.endAssignment('staff-1', 'assign-1', '2025-06-30', mockContext);

      expect(mockDynamoDBClient.updateItem).toHaveBeenCalledWith(
        'mock-client',
        'tenant-1',
        expect.stringContaining('ASSIGN#assign-1'),
        expect.stringContaining('assignmentStatus'),
        expect.objectContaining({
          ':status': 'ended',
          ':endDate': '2025-06-30',
        })
      );
    });

    it('should throw NotFoundException when assignment not found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(
        service.endAssignment('staff-1', 'nonexistent', '2025-06-30', mockContext)
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when assignment already ended', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue({
        id: 'assign-1',
        staffId: 'staff-1',
        schoolId: 'school-1',
        assignmentStatus: 'ended',
      });

      await expect(
        service.endAssignment('staff-1', 'assign-1', '2025-06-30', mockContext)
      ).rejects.toThrow(BadRequestException);
    });
  });
});
