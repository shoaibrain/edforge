/**
 * Sections Service Unit Tests
 *
 * Tests CRUD operations, validation logic, and event publishing
 * for the course section management service.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { SectionsService } from './sections.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { RequestContext } from '../common/entities/base.entity';
import { Course, CourseSection, createSectionEntity, HOMEROOM_SECTION_COURSE_KEY } from '../common/entities/course.entity';
import { CreateSectionDto, UpdateSectionDto, DesignateHomeroomDto } from '@aibrains/shared-types';
import { DataScopeService } from '../common/services/data-scope.service';

// ============================================
// Mocks
// ============================================

const mockDynamoDBClient = {
  getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
  getItem: jest.fn(),
  putItem: jest.fn(),
  updateItem: jest.fn(),
  deleteItem: jest.fn(),
  query: jest.fn(),
  queryGSI: jest.fn(),
  queryGSIFilled: jest.fn(),
  countGSI: jest.fn(),
  batchGetItems: jest.fn(),
};

const mockEventsService = {
  publishSectionCreated: jest.fn().mockResolvedValue(undefined),
  publishSectionUpdated: jest.fn().mockResolvedValue(undefined),
  publishSectionDeleted: jest.fn().mockResolvedValue(undefined),
};

const mockIdentityClient = {
  getSchool: jest.fn(),
  validateSchoolExists: jest.fn(),
  validateStaffExists: jest.fn(),
  getCurrentAcademicYear: jest.fn(),
  getAcademicYears: jest.fn(),
  getStaff: jest.fn().mockResolvedValue({ firstName: 'John', lastSurname: 'Smith' }),
};

const mockDataScopeService = {
  getSchoolIdsForUser: jest.fn().mockResolvedValue(['school-001']),
  hasAccessToSchool: jest.fn().mockResolvedValue(true),
  resolveScope: jest.fn().mockResolvedValue({ type: 'school', schoolId: 'school-001' }),
  isSectionInScope: jest.fn().mockReturnValue(true),
};

// ============================================
// Fixtures
// ============================================

const mockContext: RequestContext = {
  userId: 'admin-user-001',
  tenantId: 'tenant-001',
  email: 'admin@school.edu',
  role: 'TenantAdmin',
  jwtToken: 'mock-jwt-token',
};

function makeMockCourse(overrides: Partial<Course> = {}): Course {
  return {
    tenantId: 'tenant-001',
    entityKey: 'COURSE#school-001#course-001',
    entityType: 'COURSE',
    courseId: 'course-001',
    courseCode: 'MATH101',
    courseName: 'Algebra 1',
    schoolId: 'school-001',
    gradeLevels: ['9', '10'],
    credits: 1,
    subjectArea: 'mathematics',
    courseType: 'required',
    typicalDuration: 'year',
    isActive: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    createdBy: 'admin-user-001',
    updatedBy: 'admin-user-001',
    version: 1,
    gsi1pk: 'TENANT#tenant-001#SCHOOL#school-001',
    gsi1sk: 'COURSE#general#ALGEBRA 1',
    ...overrides,
  };
}

function makeMockSection(overrides: Partial<CourseSection> = {}): CourseSection {
  return {
    tenantId: 'tenant-001',
    entityKey: 'SECTION#school-001#section-001',
    entityType: 'SECTION',
    sectionId: 'section-001',
    courseId: 'course-001',
    courseCode: 'MATH101',
    courseName: 'Algebra 1',
    subjectArea: 'mathematics',
    schoolId: 'school-001',
    academicYearId: 'year-001',
    sectionNumber: '001',
    primaryTeacherId: 'teacher-001',
    maxEnrollment: 30,
    currentEnrollment: 0,
    isActive: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    createdBy: 'admin-user-001',
    updatedBy: 'admin-user-001',
    version: 1,
    gsi1pk: 'TENANT#tenant-001#SCHOOL#school-001',
    gsi1sk: 'SECTION#course-001#001',
    ...overrides,
  };
}

const mockCreateDto: CreateSectionDto = {
  courseId: 'course-001',
  schoolId: 'school-001',
  academicYearId: 'year-001',
  sectionNumber: '001',
  primaryTeacherId: 'teacher-001',
  maxEnrollment: 30,
  sectionType: 'instructional',
};

// ============================================
// Tests
// ============================================

describe('SectionsService', () => {
  let service: SectionsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SectionsService,
        { provide: DynamoDBClientService, useValue: mockDynamoDBClient },
        { provide: AcademicsEventsService, useValue: mockEventsService },
        { provide: IdentityClientService, useValue: mockIdentityClient },
        { provide: DataScopeService, useValue: mockDataScopeService },
      ],
    }).compile();

    service = module.get<SectionsService>(SectionsService);
  });

  // ------------------------------------------
  // createSection
  // ------------------------------------------
  describe('createSection', () => {
    beforeEach(() => {
      mockDynamoDBClient.getItem.mockResolvedValue(makeMockCourse());
      mockIdentityClient.validateSchoolExists.mockResolvedValue(true);
      mockIdentityClient.validateStaffExists.mockResolvedValue(true);
      mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);
    });

    it('should create a section successfully', async () => {
      const result = await service.createSection(mockCreateDto, mockContext);

      expect(result).toBeDefined();
      expect(result.sectionNumber).toBe('001');
      expect(result.courseId).toBe('course-001');
      expect(result.primaryTeacherId).toBe('teacher-001');
      expect(result.currentEnrollment).toBe(0);
      expect(result.isActive).toBe(true);
      expect(result.courseCode).toBe('MATH101');
      expect(result.courseName).toBe('Algebra 1');
      expect(result.subjectArea).toBe('mathematics');

      expect(mockDynamoDBClient.putItem).toHaveBeenCalledTimes(1);
      expect(mockEventsService.publishSectionCreated).toHaveBeenCalled();
    });

    it('S3.T2: persists sectionType (default instructional) on the SECTION row', async () => {
      await service.createSection(mockCreateDto, mockContext);

      const persisted = mockDynamoDBClient.putItem.mock.calls[0][1];
      expect(persisted.sectionType).toBe('instructional');
      expect(persisted.gsi1sk).toBe('SECTION#course-001#001');
    });

    it('S3.T2: rejects an instructional create with no courseId (guard fires before any write)', async () => {
      const noCourse = { ...mockCreateDto, courseId: undefined };

      await expect(service.createSection(noCourse, mockContext))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(mockDynamoDBClient.putItem).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if course does not exist', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(service.createSection(mockCreateDto, mockContext))
        .rejects.toThrow(NotFoundException);

      expect(mockDynamoDBClient.putItem).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if course is inactive', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(makeMockCourse({ isActive: false }));

      await expect(service.createSection(mockCreateDto, mockContext))
        .rejects.toThrow(BadRequestException);

      expect(mockDynamoDBClient.putItem).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if school does not exist', async () => {
      mockIdentityClient.validateSchoolExists.mockResolvedValue(false);

      await expect(service.createSection(mockCreateDto, mockContext))
        .rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if teacher does not exist', async () => {
      // The service validates the PRIMARY teacher via getStaff (validateStaffExists
      // is co-teacher only); a missing primary teacher resolves null -> NotFound.
      mockIdentityClient.getStaff.mockResolvedValueOnce(null);

      await expect(service.createSection(mockCreateDto, mockContext))
        .rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if section number already exists for the course', async () => {
      mockDynamoDBClient.queryGSI.mockResolvedValue({
        items: [makeMockSection()],
        hasMore: false,
      });

      await expect(service.createSection(mockCreateDto, mockContext))
        .rejects.toThrow(ConflictException);
    });

    it('should not block on event publishing failure', async () => {
      mockEventsService.publishSectionCreated.mockRejectedValue(new Error('EventBridge down'));

      const result = await service.createSection(mockCreateDto, mockContext);

      expect(result).toBeDefined();
      expect(result.sectionNumber).toBe('001');
    });
  });

  // ------------------------------------------
  // getSection
  // ------------------------------------------
  // ------------------------------------------
  // createSectionEntity factory — homeroom keying (S3.T2)
  // ------------------------------------------
  describe('createSectionEntity (homeroom)', () => {
    it('keys a homeroom (no courseId) under the HOMEROOM sentinel in GSI1SK — no new GSI', () => {
      const entity = createSectionEntity('tenant-001', 'sec-hr-1', 'school-001', {
        sectionType: 'homeroom',
        academicYearId: 'year-001',
        sectionNumber: 'G9A',
        primaryTeacherId: 'teacher-001',
        coTeacherIds: ['teacher-002'],
        maxEnrollment: 40,
        currentEnrollment: 0,
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        version: 1,
      } as any);

      expect(entity.courseId).toBeUndefined();
      expect(entity.sectionType).toBe('homeroom');
      expect(entity.gsi1sk).toBe(`SECTION#${HOMEROOM_SECTION_COURSE_KEY}#G9A`);
    });
  });

  // ------------------------------------------
  // designateHomeroom (S3.T4)
  // ------------------------------------------
  describe('designateHomeroom', () => {
    const homeroomDto: DesignateHomeroomDto = {
      schoolId: 'school-001',
      academicYearId: 'year-001',
      sectionNumber: 'G6A',
      sectionName: 'Grade 6 A',
      primaryTeacherId: 'teacher-001',
      coTeacherIds: ['teacher-002'],
      maxEnrollment: 60,
    };

    beforeEach(() => {
      mockIdentityClient.validateSchoolExists.mockResolvedValue(true);
      mockIdentityClient.getAcademicYears.mockResolvedValue([{ yearId: 'year-001', status: 'active' }]);
      mockIdentityClient.validateStaffExists.mockResolvedValue(true);
      mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);
    });

    it('creates a homeroom Section (sectionType:homeroom, no courseId, primary + co-teacher) keyed under the sentinel', async () => {
      const result = await service.designateHomeroom(homeroomDto, mockContext);

      expect(result.sectionType).toBe('homeroom');
      expect(result.sectionNumber).toBe('G6A');
      expect(result.courseId).toBeUndefined();
      expect(result.primaryTeacherId).toBe('teacher-001');
      expect(result.coTeacherIds).toEqual(['teacher-002']);

      const persisted = mockDynamoDBClient.putItem.mock.calls[0][1];
      expect(persisted.entityType).toBe('SECTION');
      expect(persisted.sectionType).toBe('homeroom');
      expect(persisted.courseId).toBeUndefined();
      expect(persisted.gsi1sk).toBe('SECTION#HOMEROOM#G6A');
    });

    it('throws NotFoundException when a co-teacher does not exist', async () => {
      mockIdentityClient.validateStaffExists.mockResolvedValue(false);

      await expect(service.designateHomeroom(homeroomDto, mockContext))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(mockDynamoDBClient.putItem).not.toHaveBeenCalled();
    });
  });

  describe('getSection', () => {
    it('should return a section by ID', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(makeMockSection());

      const result = await service.getSection('section-001', 'school-001', mockContext);

      expect(result.sectionId).toBe('section-001');
      expect(result.sectionNumber).toBe('001');
    });

    it('should throw NotFoundException if section does not exist', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(service.getSection('nonexistent', 'school-001', mockContext))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ------------------------------------------
  // listSections
  // ------------------------------------------
  describe('listSections', () => {
    it('should return a dense paginated list with an authoritative total', async () => {
      mockDynamoDBClient.queryGSIFilled.mockResolvedValue({
        items: [
          makeMockSection({ sectionId: 's1', sectionNumber: '001' }),
          makeMockSection({ sectionId: 's2', sectionNumber: '002' }),
        ],
        hasMore: false,
        lastEvaluatedKey: undefined,
      });
      mockDynamoDBClient.countGSI.mockResolvedValue(2);

      const result = await service.listSections('school-001', mockContext);

      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(false);
      expect(result.total).toBe(2);
    });

    it('should pass courseId filter to the dense query', async () => {
      mockDynamoDBClient.queryGSIFilled.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.countGSI.mockResolvedValue(0);

      await service.listSections('school-001', mockContext, 50, undefined, {
        courseId: 'course-001',
      });

      expect(mockDynamoDBClient.queryGSIFilled).toHaveBeenCalledWith(
        expect.anything(),
        'GSI1',
        expect.any(String),
        'SECTION#',
        'begins_with',
        expect.stringContaining('courseId = :courseId'),
        expect.objectContaining({ ':courseId': 'course-001' }),
        undefined,
        50,
        true,
        undefined,
      );
    });

    it('should pass teacherId filter to the dense query', async () => {
      mockDynamoDBClient.queryGSIFilled.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.countGSI.mockResolvedValue(0);

      await service.listSections('school-001', mockContext, 50, undefined, {
        teacherId: 'teacher-001',
      });

      expect(mockDynamoDBClient.queryGSIFilled).toHaveBeenCalledWith(
        expect.anything(),
        'GSI1',
        expect.any(String),
        'SECTION#',
        'begins_with',
        expect.stringContaining('primaryTeacherId = :teacherId'),
        expect.objectContaining({ ':teacherId': 'teacher-001' }),
        undefined,
        50,
        true,
        undefined,
      );
    });
  });

  // ------------------------------------------
  // updateSection
  // ------------------------------------------
  describe('updateSection', () => {
    it('should update a section successfully', async () => {
      const existing = makeMockSection();
      const updated = makeMockSection({
        sectionName: 'Morning Section',
        version: 2,
      });

      mockDynamoDBClient.getItem.mockResolvedValue(existing);
      mockDynamoDBClient.updateItem.mockResolvedValue(updated);

      const dto: UpdateSectionDto = { sectionName: 'Morning Section' };
      const result = await service.updateSection('section-001', 'school-001', dto, mockContext);

      expect(result.sectionName).toBe('Morning Section');
      expect(mockDynamoDBClient.updateItem).toHaveBeenCalledWith(
        expect.anything(),
        'tenant-001',
        'SECTION#school-001#section-001',
        expect.stringContaining('SET'),
        expect.objectContaining({ ':sectionName': 'Morning Section' }),
        'version = :currentVersion',
      );
      expect(mockEventsService.publishSectionUpdated).toHaveBeenCalled();
    });

    it('should throw NotFoundException if section does not exist', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      const dto: UpdateSectionDto = { sectionName: 'New Name' };
      await expect(service.updateSection('nonexistent', 'school-001', dto, mockContext))
        .rejects.toThrow(NotFoundException);
    });

    it('should validate new teacher if primaryTeacherId changed', async () => {
      const existing = makeMockSection();
      mockDynamoDBClient.getItem.mockResolvedValue(existing);
      // updateSection resolves the new teacher via getStaff inside try/catch and
      // throws NotFound on failure (validateStaffExists is co-teacher only).
      mockIdentityClient.getStaff.mockRejectedValueOnce(new Error('not found'));

      const dto: UpdateSectionDto = { primaryTeacherId: 'new-teacher' };
      await expect(service.updateSection('section-001', 'school-001', dto, mockContext))
        .rejects.toThrow(NotFoundException);
    });

    it('should not validate teacher if unchanged', async () => {
      const existing = makeMockSection();
      const updated = makeMockSection({ maxEnrollment: 35, version: 2 });

      mockDynamoDBClient.getItem.mockResolvedValue(existing);
      mockDynamoDBClient.updateItem.mockResolvedValue(updated);

      const dto: UpdateSectionDto = { maxEnrollment: 35 };
      await service.updateSection('section-001', 'school-001', dto, mockContext);

      expect(mockIdentityClient.validateStaffExists).not.toHaveBeenCalled();
    });

    it('should check uniqueness if sectionNumber changed', async () => {
      const existing = makeMockSection();
      mockDynamoDBClient.getItem.mockResolvedValue(existing);
      mockDynamoDBClient.queryGSI.mockResolvedValue({
        items: [makeMockSection({ sectionNumber: '002' })],
        hasMore: false,
      });

      const dto: UpdateSectionDto = { sectionNumber: '002' };
      await expect(service.updateSection('section-001', 'school-001', dto, mockContext))
        .rejects.toThrow(ConflictException);
    });

    it('should update GSI1SK when sectionNumber changes', async () => {
      const existing = makeMockSection();
      const updated = makeMockSection({ sectionNumber: '003', version: 2 });

      mockDynamoDBClient.getItem.mockResolvedValue(existing);
      mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.updateItem.mockResolvedValue(updated);

      const dto: UpdateSectionDto = { sectionNumber: '003' };
      await service.updateSection('section-001', 'school-001', dto, mockContext);

      expect(mockDynamoDBClient.updateItem).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.any(String),
        expect.stringContaining('gsi1sk = :gsi1sk'),
        expect.objectContaining({ ':gsi1sk': 'SECTION#course-001#003' }),
        expect.any(String),
      );
    });
  });

  // ------------------------------------------
  // deleteSection
  // ------------------------------------------
  describe('deleteSection', () => {
    it('should soft-delete a section with no enrolled students', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(makeMockSection());
      mockDynamoDBClient.updateItem.mockResolvedValue(undefined);

      await service.deleteSection('section-001', 'school-001', mockContext);

      expect(mockDynamoDBClient.updateItem).toHaveBeenCalledWith(
        expect.anything(),
        'tenant-001',
        'SECTION#school-001#section-001',
        expect.stringContaining('isActive = :isActive'),
        expect.objectContaining({ ':isActive': false }),
      );
      expect(mockEventsService.publishSectionDeleted).toHaveBeenCalledWith(
        'tenant-001',
        'section-001',
        'course-001',
        'school-001',
      );
    });

    it('should throw NotFoundException if section does not exist', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(service.deleteSection('nonexistent', 'school-001', mockContext))
        .rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if section has enrolled students', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(
        makeMockSection({ currentEnrollment: 15 }),
      );

      await expect(service.deleteSection('section-001', 'school-001', mockContext))
        .rejects.toThrow(BadRequestException);

      expect(mockDynamoDBClient.updateItem).not.toHaveBeenCalled();
    });

    it('should not block on event publishing failure', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(makeMockSection());
      mockDynamoDBClient.updateItem.mockResolvedValue(undefined);
      mockEventsService.publishSectionDeleted.mockRejectedValue(new Error('EventBridge down'));

      await expect(service.deleteSection('section-001', 'school-001', mockContext))
        .resolves.toBeUndefined();
    });
  });
});
