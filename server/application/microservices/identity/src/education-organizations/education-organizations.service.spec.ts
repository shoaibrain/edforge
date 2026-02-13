/**
 * EducationOrganizationsService Unit Tests
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { EducationOrganizationsService } from './education-organizations.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { RequestContext, GlobalRole } from '../common/entities/base.entity';

describe('EducationOrganizationsService', () => {
  let service: EducationOrganizationsService;
  let mockDynamoDBClient: any;
  let mockEventsService: any;

  const mockContext: RequestContext = {
    userId: 'admin-user-id',
    tenantId: 'tenant-123',
    email: 'admin@test.com',
    globalRole: 'TenantAdmin' as GlobalRole,
    jwtToken: 'mock-jwt-token',
  };

  const mockSEA = {
    tenantId: 'tenant-123',
    entityKey: 'SEA#sea-123',
    entityType: 'STATE_EDUCATION_AGENCY',
    id: 'sea-123',
    stateEducationAgencyId: 1001,
    nameOfInstitution: 'State Department of Education',
    operationalStatusDescriptor: 'Active',
    categories: [{ educationOrganizationCategoryDescriptor: 'State Education Agency' }],
    createdAt: '2024-01-01T00:00:00.000Z',
    createdBy: 'admin-user-id',
    updatedAt: '2024-01-01T00:00:00.000Z',
    updatedBy: 'admin-user-id',
    version: 1,
  };

  const mockLEA = {
    tenantId: 'tenant-123',
    entityKey: 'LEA#lea-123',
    entityType: 'LOCAL_EDUCATION_AGENCY',
    id: 'lea-123',
    localEducationAgencyId: 2001,
    nameOfInstitution: 'Springfield School District',
    leaCategoryDescriptor: 'Independent',
    operationalStatusDescriptor: 'Active',
    stateEducationAgencyId: 'sea-123',
    categories: [{ educationOrganizationCategoryDescriptor: 'Local Education Agency' }],
    gsi1pk: 'TENANT#tenant-123#SEA#sea-123',
    gsi1sk: 'LEA#lea-123',
    createdAt: '2024-01-01T00:00:00.000Z',
    createdBy: 'admin-user-id',
    updatedAt: '2024-01-01T00:00:00.000Z',
    updatedBy: 'admin-user-id',
    version: 1,
  };

  const mockESC = {
    tenantId: 'tenant-123',
    entityKey: 'ESC#esc-123',
    entityType: 'EDUCATION_SERVICE_CENTER',
    id: 'esc-123',
    educationServiceCenterId: 3001,
    nameOfInstitution: 'Regional Service Center #5',
    operationalStatusDescriptor: 'Active',
    stateEducationAgencyId: 'sea-123',
    categories: [{ educationOrganizationCategoryDescriptor: 'Education Service Center' }],
    gsi1pk: 'TENANT#tenant-123#SEA#sea-123',
    gsi1sk: 'ESC#esc-123',
    createdAt: '2024-01-01T00:00:00.000Z',
    createdBy: 'admin-user-id',
    updatedAt: '2024-01-01T00:00:00.000Z',
    updatedBy: 'admin-user-id',
    version: 1,
  };

  beforeEach(async () => {
    mockDynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
      getItem: jest.fn(),
      putItem: jest.fn().mockResolvedValue(undefined),
      updateItem: jest.fn(),
      query: jest.fn(),
    };

    mockEventsService = {
      publishSEACreated: jest.fn().mockResolvedValue(undefined),
      publishSEAUpdated: jest.fn().mockResolvedValue(undefined),
      publishLEACreated: jest.fn().mockResolvedValue(undefined),
      publishLEAUpdated: jest.fn().mockResolvedValue(undefined),
      publishLEADeleted: jest.fn().mockResolvedValue(undefined),
      publishESCCreated: jest.fn().mockResolvedValue(undefined),
      publishESCUpdated: jest.fn().mockResolvedValue(undefined),
      publishESCDeleted: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: DynamoDBClientService,
          useValue: mockDynamoDBClient,
        },
        {
          provide: IdentityEventsService,
          useValue: mockEventsService,
        },
        {
          provide: EducationOrganizationsService,
          useFactory: (db: DynamoDBClientService, events: IdentityEventsService) => {
            return new EducationOrganizationsService(db, events);
          },
          inject: [DynamoDBClientService, IdentityEventsService],
        },
      ],
    }).compile();

    service = module.get<EducationOrganizationsService>(EducationOrganizationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================
  // SEA Tests
  // ============================================

  describe('getSEA', () => {
    it('should return null when no SEA exists', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });

      const result = await service.getSEA(mockContext);
      expect(result).toBeNull();
    });

    it('should return SEA when it exists', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [mockSEA], hasMore: false });

      const result = await service.getSEA(mockContext);
      expect(result).toBeDefined();
      expect(result!.nameOfInstitution).toBe('State Department of Education');
      expect(result!.stateEducationAgencyId).toBe(1001);
    });
  });

  describe('createOrUpdateSEA', () => {
    const createDto = {
      stateEducationAgencyId: 1001,
      nameOfInstitution: 'State Department of Education',
      categories: [{ educationOrganizationCategoryDescriptor: 'State Education Agency' }],
    };

    it('should create a new SEA when none exists', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });

      const result = await service.createOrUpdateSEA(createDto as any, mockContext);

      expect(mockDynamoDBClient.putItem).toHaveBeenCalled();
      expect(result.nameOfInstitution).toBe('State Department of Education');
      expect(result.stateEducationAgencyId).toBe(1001);
      expect(result.id).toBeDefined();
    });

    it('should update existing SEA', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [mockSEA], hasMore: false });
      mockDynamoDBClient.updateItem.mockResolvedValue({
        ...mockSEA,
        nameOfInstitution: 'Updated SEA Name',
      });

      const result = await service.createOrUpdateSEA(
        { ...createDto, nameOfInstitution: 'Updated SEA Name' } as any,
        mockContext,
      );

      expect(mockDynamoDBClient.updateItem).toHaveBeenCalled();
      expect(mockDynamoDBClient.putItem).not.toHaveBeenCalled();
      expect(result.nameOfInstitution).toBe('Updated SEA Name');
    });
  });

  // ============================================
  // LEA Tests
  // ============================================

  describe('listLEAs', () => {
    it('should return empty list when no LEAs exist', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });

      const result = await service.listLEAs({ limit: 20 } as any, mockContext);
      expect(result.items).toHaveLength(0);
      expect(result.hasMore).toBe(false);
    });

    it('should return LEAs with in-memory search filter', async () => {
      mockDynamoDBClient.query.mockResolvedValue({
        items: [
          mockLEA,
          { ...mockLEA, id: 'lea-456', nameOfInstitution: 'Other District' },
        ],
        hasMore: false,
      });

      const result = await service.listLEAs(
        { search: 'Springfield', limit: 20 } as any,
        mockContext,
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0].nameOfInstitution).toBe('Springfield School District');
    });
  });

  describe('getLEA', () => {
    it('should return LEA when found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(mockLEA);

      const result = await service.getLEA('lea-123', mockContext);
      expect(result.nameOfInstitution).toBe('Springfield School District');
      expect(result.localEducationAgencyId).toBe(2001);
    });

    it('should throw NotFoundException when LEA not found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(service.getLEA('nonexistent', mockContext))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('createLEA', () => {
    const createDto = {
      localEducationAgencyId: 2002,
      nameOfInstitution: 'New District',
      leaCategoryDescriptor: 'Independent',
      stateEducationAgencyId: 'sea-123',
      categories: [{ educationOrganizationCategoryDescriptor: 'Local Education Agency' }],
    };

    it('should create LEA with valid parent references', async () => {
      // SEA exists
      mockDynamoDBClient.getItem.mockResolvedValue(mockSEA);

      const result = await service.createLEA(createDto as any, mockContext);

      expect(mockDynamoDBClient.putItem).toHaveBeenCalled();
      expect(result.nameOfInstitution).toBe('New District');
      expect(result.localEducationAgencyId).toBe(2002);
    });

    it('should throw BadRequestException for invalid SEA reference', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(service.createLEA(createDto as any, mockContext))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('updateLEA', () => {
    it('should update LEA fields', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(mockLEA);
      mockDynamoDBClient.updateItem.mockResolvedValue({
        ...mockLEA,
        nameOfInstitution: 'Updated District',
      });

      const result = await service.updateLEA(
        'lea-123',
        { nameOfInstitution: 'Updated District' } as any,
        mockContext,
      );

      expect(mockDynamoDBClient.updateItem).toHaveBeenCalled();
      expect(result.nameOfInstitution).toBe('Updated District');
    });

    it('should throw NotFoundException when LEA not found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(service.updateLEA('nonexistent', {} as any, mockContext))
        .rejects.toThrow(NotFoundException);
    });

    it('should reject self-referencing parent LEA', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(mockLEA);

      await expect(
        service.updateLEA(
          'lea-123',
          { parentLocalEducationAgencyId: 'lea-123' } as any,
          mockContext,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteLEA', () => {
    it('should soft-delete LEA by setting status to Inactive', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(mockLEA);
      mockDynamoDBClient.updateItem.mockResolvedValue(undefined);

      await service.deleteLEA('lea-123', mockContext);

      expect(mockDynamoDBClient.updateItem).toHaveBeenCalledWith(
        expect.anything(),
        'tenant-123',
        'LEA#lea-123',
        expect.stringContaining('SET'),
        expect.objectContaining({ ':status': 'Inactive' }),
        undefined,
        expect.any(Object),
      );
    });

    it('should throw NotFoundException when LEA not found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(service.deleteLEA('nonexistent', mockContext))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ============================================
  // ESC Tests
  // ============================================

  describe('getESC', () => {
    it('should return ESC when found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(mockESC);

      const result = await service.getESC('esc-123', mockContext);
      expect(result.nameOfInstitution).toBe('Regional Service Center #5');
    });

    it('should throw NotFoundException when ESC not found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(service.getESC('nonexistent', mockContext))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('createESC', () => {
    const createDto = {
      educationServiceCenterId: 3002,
      nameOfInstitution: 'New Service Center',
      stateEducationAgencyId: 'sea-123',
      categories: [{ educationOrganizationCategoryDescriptor: 'Education Service Center' }],
    };

    it('should create ESC with valid SEA reference', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(mockSEA);

      const result = await service.createESC(createDto as any, mockContext);

      expect(mockDynamoDBClient.putItem).toHaveBeenCalled();
      expect(result.nameOfInstitution).toBe('New Service Center');
    });

    it('should throw BadRequestException for invalid SEA reference', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(service.createESC(createDto as any, mockContext))
        .rejects.toThrow(BadRequestException);
    });
  });

  // ============================================
  // Hierarchy Tests
  // ============================================

  describe('getHierarchy', () => {
    it('should return empty hierarchy for new tenant', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });

      const result = await service.getHierarchy(mockContext);

      expect(result.sea).toBeNull();
      expect(result.educationServiceCenters).toHaveLength(0);
      expect(result.unassigned).toHaveLength(0);
    });

    it('should build full hierarchy tree', async () => {
      const mockSchool = {
        schoolId: 'school-1',
        name: 'Springfield Elementary',
        entityType: 'SCHOOL',
        status: 'active',
        localEducationAgencyId: 'lea-123',
      };

      const mockUnassignedSchool = {
        schoolId: 'school-2',
        name: 'Orphaned School',
        entityType: 'SCHOOL',
        status: 'active',
      };

      // Return different data for each query based on SK prefix
      mockDynamoDBClient.query
        .mockResolvedValueOnce({ items: [mockSEA], hasMore: false })   // SEA query
        .mockResolvedValueOnce({ items: [mockLEA], hasMore: false })   // LEA query
        .mockResolvedValueOnce({ items: [mockESC], hasMore: false })   // ESC query
        .mockResolvedValueOnce({ items: [mockSchool, mockUnassignedSchool], hasMore: false }); // School query

      const result = await service.getHierarchy(mockContext);

      // SEA is root
      expect(result.sea).toBeDefined();
      expect(result.sea!.name).toBe('State Department of Education');
      expect(result.sea!.type).toBe('stateEducationAgency');

      // LEA is child of SEA with school as child
      expect(result.sea!.children).toHaveLength(1);
      expect(result.sea!.children[0].name).toBe('Springfield School District');
      expect(result.sea!.children[0].children).toHaveLength(1);
      expect(result.sea!.children[0].children[0].name).toBe('Springfield Elementary');

      // ESC is separate
      expect(result.educationServiceCenters).toHaveLength(1);
      expect(result.educationServiceCenters[0].name).toBe('Regional Service Center #5');

      // Unassigned schools
      expect(result.unassigned).toHaveLength(1);
      expect(result.unassigned[0].name).toBe('Orphaned School');
    });

    it('should handle tenant with schools but no hierarchy', async () => {
      const mockSchool = {
        schoolId: 'school-1',
        name: 'Standalone School',
        entityType: 'SCHOOL',
        status: 'active',
      };

      mockDynamoDBClient.query
        .mockResolvedValueOnce({ items: [], hasMore: false })          // No SEA
        .mockResolvedValueOnce({ items: [], hasMore: false })          // No LEAs
        .mockResolvedValueOnce({ items: [], hasMore: false })          // No ESCs
        .mockResolvedValueOnce({ items: [mockSchool], hasMore: false }); // One school

      const result = await service.getHierarchy(mockContext);

      expect(result.sea).toBeNull();
      expect(result.unassigned).toHaveLength(1);
      expect(result.unassigned[0].name).toBe('Standalone School');
    });
  });
});
