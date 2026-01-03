/**
 * SchoolsService Unit Tests
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SchoolsService } from './schools.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { RequestContext, GlobalRole } from '../common/entities/base.entity';
import { CreateSchoolDto, UpdateSchoolDto } from '../common/dto/school.dto';

describe('SchoolsService', () => {
  let service: SchoolsService;
  let mockDynamoDBClient: any;
  let mockEventsService: any;

  const mockContext: RequestContext = {
    userId: 'admin-user-id',
    tenantId: 'tenant-123',
    email: 'admin@test.com',
    globalRole: 'TenantAdmin' as GlobalRole,
    jwtToken: 'mock-jwt-token',
  };

  const mockSchool = {
    tenantId: 'tenant-123',
    entityKey: 'SCHOOL#school-123',
    entityType: 'SCHOOL' as const,
    schoolId: 'school-123',
    schoolCode: 'SCH001',
    name: 'Test Elementary School',
    shortName: 'TES',
    schoolType: 'elementary',
    gradeRange: { start: 'K', end: '5' },
    phone: '555-0100',
    email: 'school@test.com',
    status: 'active',
    timezone: 'America/New_York',
    locale: 'en-US',
    academicCalendarType: 'semester',
    createdAt: '2024-01-01T00:00:00.000Z',
    createdBy: 'admin-user-id',
    updatedAt: '2024-01-01T00:00:00.000Z',
    updatedBy: 'admin-user-id',
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
      publishSchoolCreated: jest.fn().mockResolvedValue(undefined),
      publishSchoolUpdated: jest.fn().mockResolvedValue(undefined),
      publishSchoolDeleted: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchoolsService,
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

    service = module.get<SchoolsService>(SchoolsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createSchool', () => {
    it('should create a new school', async () => {
      const createDto: CreateSchoolDto = {
        schoolCode: 'SCH001',
        name: 'Test Elementary School',
        shortName: 'TES',
        schoolType: 'elementary',
        gradeRange: { start: 'K', end: '5' },
        phone: '555-0100',
        email: 'school@test.com',
      };

      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const result = await service.createSchool(createDto, mockContext);

      expect(result).toBeDefined();
      expect(result.name).toBe('Test Elementary School');
      expect(result.schoolCode).toBe('SCH001');
      expect(result.status).toBe('setup');
      expect(mockDynamoDBClient.putItem).toHaveBeenCalled();
      expect(mockEventsService.publishSchoolCreated).toHaveBeenCalled();
    });
  });

  describe('getSchool', () => {
    it('should return a school when found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(mockSchool);

      const result = await service.getSchool('school-123', mockContext);

      expect(result).toBeDefined();
      expect(result.schoolId).toBe('school-123');
      expect(result.name).toBe('Test Elementary School');
    });

    it('should throw NotFoundException when school not found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(service.getSchool('nonexistent', mockContext))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('listSchools', () => {
    it('should return paginated list of schools', async () => {
      mockDynamoDBClient.query.mockResolvedValue({
        items: [mockSchool],
        hasMore: false,
        lastEvaluatedKey: undefined,
      });

      const result = await service.listSchools(mockContext, 50);

      expect(result.items).toHaveLength(1);
      expect(result.hasMore).toBe(false);
      expect(result.items[0].name).toBe('Test Elementary School');
    });

    it('should handle empty result', async () => {
      mockDynamoDBClient.query.mockResolvedValue({
        items: [],
        hasMore: false,
        lastEvaluatedKey: undefined,
      });

      const result = await service.listSchools(mockContext);

      expect(result.items).toHaveLength(0);
    });
  });

  describe('updateSchool', () => {
    it('should update school fields', async () => {
      const updateDto: UpdateSchoolDto = {
        name: 'Updated School Name',
        phone: '555-0200',
      };

      mockDynamoDBClient.getItem.mockResolvedValue(mockSchool);
      mockDynamoDBClient.updateItem.mockResolvedValue({
        ...mockSchool,
        name: 'Updated School Name',
        phone: '555-0200',
        updatedAt: '2024-01-02T00:00:00.000Z',
      });

      const result = await service.updateSchool('school-123', updateDto, mockContext);

      expect(result.name).toBe('Updated School Name');
      expect(result.phone).toBe('555-0200');
      expect(mockEventsService.publishSchoolUpdated).toHaveBeenCalledWith(
        'tenant-123',
        'school-123',
        expect.arrayContaining(['name', 'phone'])
      );
    });

    it('should throw NotFoundException when school not found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(service.updateSchool('nonexistent', { name: 'New Name' }, mockContext))
        .rejects.toThrow(NotFoundException);
    });

    it('should return unchanged school when no updates provided', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(mockSchool);

      const result = await service.updateSchool('school-123', {}, mockContext);

      expect(result.name).toBe('Test Elementary School');
      expect(mockDynamoDBClient.updateItem).not.toHaveBeenCalled();
    });
  });

  describe('deleteSchool', () => {
    it('should soft delete school', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(mockSchool);
      mockDynamoDBClient.updateItem.mockResolvedValue({
        ...mockSchool,
        status: 'inactive',
      });

      await service.deleteSchool('school-123', mockContext);

      expect(mockDynamoDBClient.updateItem).toHaveBeenCalledWith(
        expect.anything(),
        'tenant-123',
        'SCHOOL#school-123',
        expect.stringContaining('status'),
        expect.objectContaining({ ':status': 'inactive' }),
        undefined,
        expect.anything()
      );
    });

    it('should throw NotFoundException when school not found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(service.deleteSchool('nonexistent', mockContext))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('Department CRUD', () => {
    const mockDepartment = {
      tenantId: 'tenant-123',
      entityKey: 'SCHOOL#school-123#DEPT#dept-123',
      entityType: 'DEPARTMENT' as const,
      departmentId: 'dept-123',
      schoolId: 'school-123',
      code: 'MATH',
      name: 'Mathematics',
      description: 'Math department',
      isActive: true,
      createdAt: '2024-01-01T00:00:00.000Z',
      createdBy: 'admin-user-id',
      updatedAt: '2024-01-01T00:00:00.000Z',
      updatedBy: 'admin-user-id',
      version: 1,
    };

    describe('createDepartment', () => {
      it('should create a new department', async () => {
        mockDynamoDBClient.putItem.mockResolvedValue(undefined);

        const result = await service.createDepartment('school-123', {
          code: 'MATH',
          name: 'Mathematics',
          description: 'Math department',
        }, mockContext);

        expect(result).toBeDefined();
        expect(result.name).toBe('Mathematics');
        expect(result.code).toBe('MATH');
        expect(mockDynamoDBClient.putItem).toHaveBeenCalled();
      });
    });

    describe('getDepartment', () => {
      it('should return department when found', async () => {
        mockDynamoDBClient.getItem.mockResolvedValue(mockDepartment);

        const result = await service.getDepartment('school-123', 'dept-123', mockContext);

        expect(result.departmentId).toBe('dept-123');
        expect(result.name).toBe('Mathematics');
      });

      it('should throw NotFoundException when department not found', async () => {
        mockDynamoDBClient.getItem.mockResolvedValue(null);

        await expect(service.getDepartment('school-123', 'nonexistent', mockContext))
          .rejects.toThrow(NotFoundException);
      });
    });

    describe('listDepartments', () => {
      it('should return list of departments', async () => {
        mockDynamoDBClient.query.mockResolvedValue({
          items: [mockDepartment],
          hasMore: false,
        });

        const result = await service.listDepartments('school-123', mockContext);

        expect(result.items).toHaveLength(1);
        expect(result.items[0].name).toBe('Mathematics');
      });
    });
  });
});
