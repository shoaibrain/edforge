/**
 * Courses Service Unit Tests
 *
 * Tests CRUD operations, validation logic, and event publishing
 * for the course catalog management service.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { CoursesService } from './courses.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { RequestContext } from '../common/entities/base.entity';
import { Course } from '../common/entities/course.entity';
import { CreateCourseDto, UpdateCourseDto } from '@aibrains/shared-types';

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
  batchGetItems: jest.fn(),
};

const mockEventsService = {
  publishCourseCreated: jest.fn().mockResolvedValue(undefined),
  publishCourseUpdated: jest.fn().mockResolvedValue(undefined),
  publishCourseDeleted: jest.fn().mockResolvedValue(undefined),
};

const mockIdentityClient = {
  getSchool: jest.fn(),
  validateSchoolExists: jest.fn(),
  getCurrentAcademicYear: jest.fn(),
  getAcademicYears: jest.fn(),
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

const mockCreateDto: CreateCourseDto = {
  courseCode: 'MATH101',
  courseName: 'Algebra 1',
  schoolId: 'school-001',
  gradeLevels: ['9', '10'],
  credits: 1,
  subjectArea: 'mathematics',
  courseType: 'required',
  typicalDuration: 'year',
  description: 'Introduction to algebraic concepts',
};

function makeMockCourseEntity(overrides: Partial<Course> = {}): Course {
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
    description: 'Introduction to algebraic concepts',
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

// ============================================
// Tests
// ============================================

describe('CoursesService', () => {
  let service: CoursesService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoursesService,
        { provide: DynamoDBClientService, useValue: mockDynamoDBClient },
        { provide: AcademicsEventsService, useValue: mockEventsService },
        { provide: IdentityClientService, useValue: mockIdentityClient },
      ],
    }).compile();

    service = module.get<CoursesService>(CoursesService);
    // Mock the lazy TenantMetadataReader so no real DDB call is made; default
    // to no archetype (curriculum default unset) — GB2.4 tests override this.
    (service as any)._tenantMetadataReader = {
      getTenantMetadata: jest.fn().mockResolvedValue({ archetype: undefined }),
    };
  });

  // ------------------------------------------
  // createCourse
  // ------------------------------------------
  describe('createCourse', () => {
    it('should create a course successfully', async () => {
      mockIdentityClient.validateSchoolExists.mockResolvedValue(true);
      mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const result = await service.createCourse(mockCreateDto, mockContext);

      expect(result).toBeDefined();
      expect(result.courseCode).toBe('MATH101');
      expect(result.courseName).toBe('Algebra 1');
      expect(result.schoolId).toBe('school-001');
      expect(result.isActive).toBe(true);

      expect(mockIdentityClient.validateSchoolExists).toHaveBeenCalledWith(
        'school-001',
        expect.objectContaining({ tenantId: 'tenant-001' }),
      );
      expect(mockDynamoDBClient.putItem).toHaveBeenCalledTimes(1);
      expect(mockEventsService.publishCourseCreated).toHaveBeenCalled();
    });

    // GB2.4 — curriculum default from the governance profile.
    describe('curriculumRef defaulting from archetype (GB2.4)', () => {
      const setArchetype = (archetype: string | undefined) => {
        (service as any)._tenantMetadataReader = {
          getTenantMetadata: jest.fn().mockResolvedValue({ archetype }),
        };
      };
      const persistedCurriculumRef = () =>
        (mockDynamoDBClient.putItem.mock.calls[0][1] as Course).curriculumRef;

      beforeEach(() => {
        mockIdentityClient.validateSchoolExists.mockResolvedValue(true);
        mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [], hasMore: false });
        mockDynamoDBClient.putItem.mockResolvedValue(undefined);
      });

      it('PABSON + omitted curriculumRef → CDC_NCF_2076', async () => {
        setArchetype('PABSON');
        await service.createCourse(mockCreateDto, mockContext);
        expect(persistedCurriculumRef()).toBe('CDC_NCF_2076');
      });

      it('GENERIC + omitted curriculumRef → CCSS', async () => {
        setArchetype('GENERIC');
        await service.createCourse(mockCreateDto, mockContext);
        expect(persistedCurriculumRef()).toBe('CCSS');
      });

      it('an explicit curriculumRef wins over the archetype default', async () => {
        setArchetype('PABSON');
        await service.createCourse(
          { ...mockCreateDto, curriculumRef: 'CCSS' } as CreateCourseDto,
          mockContext,
        );
        expect(persistedCurriculumRef()).toBe('CCSS');
      });

      it('unresolvable archetype leaves curriculumRef unset', async () => {
        setArchetype(undefined);
        await service.createCourse(mockCreateDto, mockContext);
        expect(persistedCurriculumRef()).toBeUndefined();
      });
    });

    it('should throw NotFoundException if school does not exist', async () => {
      mockIdentityClient.validateSchoolExists.mockResolvedValue(false);

      await expect(service.createCourse(mockCreateDto, mockContext))
        .rejects.toThrow(NotFoundException);

      expect(mockDynamoDBClient.putItem).not.toHaveBeenCalled();
    });

    it('should throw ConflictException if course code already exists in school', async () => {
      mockIdentityClient.validateSchoolExists.mockResolvedValue(true);
      mockDynamoDBClient.queryGSI.mockResolvedValue({
        items: [makeMockCourseEntity()],
        hasMore: false,
      });

      await expect(service.createCourse(mockCreateDto, mockContext))
        .rejects.toThrow(ConflictException);

      expect(mockDynamoDBClient.putItem).not.toHaveBeenCalled();
    });

    it('should validate prerequisites if provided', async () => {
      const dtoWithPrereqs: CreateCourseDto = {
        ...mockCreateDto,
        courseCode: 'MATH201',
        courseName: 'Algebra 2',
        prerequisites: ['prereq-course-001'],
      };

      mockIdentityClient.validateSchoolExists.mockResolvedValue(true);
      mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.batchGetItems.mockResolvedValue([
        makeMockCourseEntity({ courseId: 'prereq-course-001' }),
      ]);
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const result = await service.createCourse(dtoWithPrereqs, mockContext);

      expect(result.prerequisites).toEqual(['prereq-course-001']);
      expect(mockDynamoDBClient.batchGetItems).toHaveBeenCalled();
    });

    it('should throw BadRequestException if a prerequisite does not exist', async () => {
      const dtoWithBadPrereqs: CreateCourseDto = {
        ...mockCreateDto,
        prerequisites: ['nonexistent-course'],
      };

      mockIdentityClient.validateSchoolExists.mockResolvedValue(true);
      mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.batchGetItems.mockResolvedValue([]);

      await expect(service.createCourse(dtoWithBadPrereqs, mockContext))
        .rejects.toThrow(BadRequestException);
    });

    it('should not block on event publishing failure', async () => {
      mockIdentityClient.validateSchoolExists.mockResolvedValue(true);
      mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);
      mockEventsService.publishCourseCreated.mockRejectedValue(new Error('EventBridge down'));

      const result = await service.createCourse(mockCreateDto, mockContext);

      expect(result).toBeDefined();
      expect(result.courseCode).toBe('MATH101');
    });
  });

  // ------------------------------------------
  // getCourse
  // ------------------------------------------
  describe('getCourse', () => {
    it('should return a course by ID', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(makeMockCourseEntity());

      const result = await service.getCourse('course-001', 'school-001', mockContext);

      expect(result.courseId).toBe('course-001');
      expect(result.courseName).toBe('Algebra 1');
    });

    it('should throw NotFoundException if course does not exist', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(service.getCourse('nonexistent', 'school-001', mockContext))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ------------------------------------------
  // listCourses
  // ------------------------------------------
  describe('listCourses', () => {
    it('should return paginated list of courses', async () => {
      const courses = [
        makeMockCourseEntity({ courseId: 'c1', courseCode: 'MATH101' }),
        makeMockCourseEntity({ courseId: 'c2', courseCode: 'ENG101', courseName: 'English 1', subjectArea: 'english_language_arts' }),
      ];
      mockDynamoDBClient.queryGSI.mockResolvedValue({
        items: courses,
        hasMore: false,
        lastEvaluatedKey: undefined,
      });

      const result = await service.listCourses('school-001', mockContext);

      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(false);
    });

    it('should pass filter expressions for subjectArea', async () => {
      mockDynamoDBClient.queryGSI.mockResolvedValue({
        items: [],
        hasMore: false,
        lastEvaluatedKey: undefined,
      });

      await service.listCourses('school-001', mockContext, 50, undefined, {
        subjectArea: 'mathematics',
      });

      expect(mockDynamoDBClient.queryGSI).toHaveBeenCalledWith(
        expect.anything(),
        'GSI1',
        expect.any(String),
        'COURSE#',
        'begins_with',
        expect.stringContaining('subjectArea = :subjectArea'),
        expect.objectContaining({ ':subjectArea': 'mathematics' }),
        undefined,
        50,
      );
    });

    it('should pass search term filter', async () => {
      mockDynamoDBClient.queryGSI.mockResolvedValue({
        items: [],
        hasMore: false,
        lastEvaluatedKey: undefined,
      });

      await service.listCourses('school-001', mockContext, 50, undefined, {
        searchTerm: 'algebra',
      });

      expect(mockDynamoDBClient.queryGSI).toHaveBeenCalledWith(
        expect.anything(),
        'GSI1',
        expect.any(String),
        'COURSE#',
        'begins_with',
        expect.stringContaining('contains(courseName, :search)'),
        expect.objectContaining({ ':search': 'algebra' }),
        undefined,
        50,
      );
    });
  });

  // ------------------------------------------
  // updateCourse
  // ------------------------------------------
  describe('updateCourse', () => {
    it('should update a course successfully', async () => {
      const existing = makeMockCourseEntity();
      const updated = makeMockCourseEntity({
        courseName: 'Algebra 1 Honors',
        updatedAt: '2025-06-01T00:00:00.000Z',
        version: 2,
      });

      mockDynamoDBClient.getItem.mockResolvedValue(existing);
      mockDynamoDBClient.updateItem.mockResolvedValue(updated);

      const dto: UpdateCourseDto = { courseName: 'Algebra 1 Honors' };
      const result = await service.updateCourse('course-001', 'school-001', dto, mockContext);

      expect(result.courseName).toBe('Algebra 1 Honors');
      expect(mockDynamoDBClient.updateItem).toHaveBeenCalledWith(
        expect.anything(),
        'tenant-001',
        'COURSE#school-001#course-001',
        expect.stringContaining('SET'),
        expect.objectContaining({ ':courseName': 'Algebra 1 Honors' }),
        'version = :currentVersion',
        undefined,
      );
      expect(mockEventsService.publishCourseUpdated).toHaveBeenCalled();
    });

    it('should throw NotFoundException if course does not exist', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      const dto: UpdateCourseDto = { courseName: 'New Name' };
      await expect(service.updateCourse('nonexistent', 'school-001', dto, mockContext))
        .rejects.toThrow(NotFoundException);
    });

    it('should reject self-referencing prerequisites', async () => {
      const existing = makeMockCourseEntity();
      mockDynamoDBClient.getItem.mockResolvedValue(existing);

      const dto: UpdateCourseDto = { prerequisites: ['course-001'] };
      await expect(service.updateCourse('course-001', 'school-001', dto, mockContext))
        .rejects.toThrow(BadRequestException);
    });

    it('should validate updated prerequisites exist', async () => {
      const existing = makeMockCourseEntity();
      mockDynamoDBClient.getItem.mockResolvedValue(existing);
      mockDynamoDBClient.batchGetItems.mockResolvedValue([]);

      const dto: UpdateCourseDto = { prerequisites: ['missing-course'] };
      await expect(service.updateCourse('course-001', 'school-001', dto, mockContext))
        .rejects.toThrow(BadRequestException);
    });

    it('should update GSI1SK when courseName changes', async () => {
      const existing = makeMockCourseEntity();
      const updated = makeMockCourseEntity({ courseName: 'Pre-Algebra', version: 2 });

      mockDynamoDBClient.getItem.mockResolvedValue(existing);
      mockDynamoDBClient.updateItem.mockResolvedValue(updated);

      const dto: UpdateCourseDto = { courseName: 'Pre-Algebra' };
      await service.updateCourse('course-001', 'school-001', dto, mockContext);

      expect(mockDynamoDBClient.updateItem).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.any(String),
        expect.stringContaining('gsi1sk = :gsi1sk'),
        expect.objectContaining({ ':gsi1sk': 'COURSE#general#PRE-ALGEBRA' }),
        expect.any(String),
        undefined,
      );
    });
  });

  // ------------------------------------------
  // deleteCourse
  // ------------------------------------------
  describe('deleteCourse', () => {
    it('should soft-delete a course by setting isActive=false', async () => {
      const existing = makeMockCourseEntity();
      mockDynamoDBClient.getItem.mockResolvedValue(existing);
      mockDynamoDBClient.updateItem.mockResolvedValue(undefined);

      await service.deleteCourse('course-001', 'school-001', mockContext);

      expect(mockDynamoDBClient.updateItem).toHaveBeenCalledWith(
        expect.anything(),
        'tenant-001',
        'COURSE#school-001#course-001',
        expect.stringContaining('isActive = :isActive'),
        expect.objectContaining({ ':isActive': false }),
      );
      expect(mockEventsService.publishCourseDeleted).toHaveBeenCalledWith(
        'tenant-001',
        'course-001',
        'school-001',
      );
    });

    it('should throw NotFoundException if course does not exist', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(service.deleteCourse('nonexistent', 'school-001', mockContext))
        .rejects.toThrow(NotFoundException);

      expect(mockDynamoDBClient.updateItem).not.toHaveBeenCalled();
    });

    it('should not block on event publishing failure', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(makeMockCourseEntity());
      mockDynamoDBClient.updateItem.mockResolvedValue(undefined);
      mockEventsService.publishCourseDeleted.mockRejectedValue(new Error('EventBridge down'));

      await expect(service.deleteCourse('course-001', 'school-001', mockContext))
        .resolves.toBeUndefined();
    });
  });

  // ------------------------------------------
  // Sprint A.2 — Course extension fields (A.2.1 + A.2.2)
  // ------------------------------------------
  describe('A.2 Course extension fields', () => {
    it('createCourse persists academicSubject, stateSubjectCode, curriculumRef when provided', async () => {
      const dtoWithExtension: CreateCourseDto = {
        ...mockCreateDto,
        courseCode: 'NCF-MATH-G68',
        courseName: 'C. Mathematics',
        academicSubject: 'mathematics',
        stateSubjectCode: '006',
        curriculumRef: 'CDC_NCF_2076',
      };

      mockIdentityClient.validateSchoolExists.mockResolvedValue(true);
      mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const result = await service.createCourse(dtoWithExtension, mockContext);

      expect(result.academicSubject).toBe('mathematics');
      expect(result.stateSubjectCode).toBe('006');
      expect(result.curriculumRef).toBe('CDC_NCF_2076');

      // Verify the entity persisted to DDB carried all 3 fields
      const persistedEntity = mockDynamoDBClient.putItem.mock.calls[0][1];
      expect(persistedEntity.academicSubject).toBe('mathematics');
      expect(persistedEntity.stateSubjectCode).toBe('006');
      expect(persistedEntity.curriculumRef).toBe('CDC_NCF_2076');
    });

    it('createCourse remains back-compat when new fields are omitted (legacy DTO shape)', async () => {
      // mockCreateDto deliberately has no A.2 fields — proves V1 back-compat.
      mockIdentityClient.validateSchoolExists.mockResolvedValue(true);
      mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const result = await service.createCourse(mockCreateDto, mockContext);

      expect(result).toBeDefined();
      expect(result.academicSubject).toBeUndefined();
      expect(result.stateSubjectCode).toBeUndefined();
      expect(result.curriculumRef).toBeUndefined();
      // subjectArea (existing Ed-Fi rollup) still present.
      expect(result.subjectArea).toBe('mathematics');
    });

    it('updateCourse PATCH-ing extension fields populates them on legacy rows', async () => {
      const legacyEntity = makeMockCourseEntity();
      expect(legacyEntity.academicSubject).toBeUndefined();
      expect(legacyEntity.curriculumRef).toBeUndefined();

      mockDynamoDBClient.getItem.mockResolvedValue(legacyEntity);
      mockDynamoDBClient.updateItem.mockResolvedValue(
        makeMockCourseEntity({
          academicSubject: 'mathematics',
          curriculumRef: 'CDC_NCF_2076',
          stateSubjectCode: '006',
          version: 2,
        }),
      );

      const patchDto: UpdateCourseDto = {
        academicSubject: 'mathematics',
        curriculumRef: 'CDC_NCF_2076',
        stateSubjectCode: '006',
      };

      const result = await service.updateCourse(
        'course-001',
        'school-001',
        patchDto,
        mockContext,
      );

      // updateItem received the new fields in the SET expression
      const updateCall = mockDynamoDBClient.updateItem.mock.calls[0];
      const setExpr = updateCall[3] as string;
      const exprValues = updateCall[4] as Record<string, unknown>;

      expect(setExpr).toContain('academicSubject = :academicSubject');
      expect(setExpr).toContain('curriculumRef = :curriculumRef');
      expect(setExpr).toContain('stateSubjectCode = :stateSubjectCode');
      expect(exprValues[':academicSubject']).toBe('mathematics');
      expect(exprValues[':curriculumRef']).toBe('CDC_NCF_2076');
      expect(exprValues[':stateSubjectCode']).toBe('006');

      expect(result.academicSubject).toBe('mathematics');
      expect(result.curriculumRef).toBe('CDC_NCF_2076');
      expect(result.stateSubjectCode).toBe('006');
    });

    it('updateCourse without extension fields preserves legacy rows unchanged on those fields', async () => {
      const existing = makeMockCourseEntity();
      mockDynamoDBClient.getItem.mockResolvedValue(existing);
      mockDynamoDBClient.updateItem.mockResolvedValue(
        makeMockCourseEntity({ courseName: 'Algebra 1 Honors', version: 2 }),
      );

      const patchDto: UpdateCourseDto = { courseName: 'Algebra 1 Honors' };

      await service.updateCourse('course-001', 'school-001', patchDto, mockContext);

      // SET expression should NOT mention the new fields when DTO omits them
      const updateCall = mockDynamoDBClient.updateItem.mock.calls[0];
      const setExpr = updateCall[3] as string;
      const exprValues = updateCall[4] as Record<string, unknown>;

      expect(setExpr).not.toContain('academicSubject');
      expect(setExpr).not.toContain('curriculumRef');
      expect(setExpr).not.toContain('stateSubjectCode');
      expect(exprValues[':academicSubject']).toBeUndefined();
      expect(exprValues[':curriculumRef']).toBeUndefined();
      expect(exprValues[':stateSubjectCode']).toBeUndefined();
    });
  });
});
