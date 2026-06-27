/**
 * Section Enrollment Service Unit Tests
 *
 * Tests student enrollment in course sections, including:
 * enroll/drop lifecycle, capacity enforcement, roster queries,
 * and student section listing.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { SectionEnrollmentService } from './section-enrollment.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { DataScopeService } from '../common/services/data-scope.service';
import { RequestContext } from '../common/entities/base.entity';
import { CourseSection } from '../common/entities/course.entity';
import { SectionEnrollment } from '../common/entities/section-enrollment.entity';

// ============================================
// Mocks
// ============================================

const mockDynamoDBClient = {
  getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
  getTableName: jest.fn().mockReturnValue('edforge-academics-basic'),
  getItem: jest.fn(),
  putItem: jest.fn(),
  updateItem: jest.fn(),
  deleteItem: jest.fn(),
  query: jest.fn(),
  queryGSI: jest.fn(),
  transactWrite: jest.fn().mockResolvedValue(undefined),
  batchGetItems: jest.fn(),
};

const mockEventsService = {
  publishStudentSectionEnrolled: jest.fn().mockResolvedValue(undefined),
  publishStudentSectionDropped: jest.fn().mockResolvedValue(undefined),
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

function makeMockSection(overrides: Partial<CourseSection> = {}): CourseSection {
  return {
    tenantId: 'tenant-001',
    entityKey: 'SECTION#school-001#section-001',
    entityType: 'SECTION',
    sectionId: 'section-001',
    courseId: 'course-001',
    courseCode: 'MATH101',
    courseName: 'Algebra 1',
    schoolId: 'school-001',
    academicYearId: 'year-001',
    sectionNumber: '001',
    primaryTeacherId: 'teacher-001',
    maxEnrollment: 30,
    currentEnrollment: 10,
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

function makeMockEnrollment(overrides: Partial<SectionEnrollment> = {}): SectionEnrollment {
  return {
    tenantId: 'tenant-001',
    entityKey: 'SEC_ENROLL#school-001#section-001#student-001',
    entityType: 'SEC_ENROLL',
    studentId: 'student-001',
    sectionId: 'section-001',
    courseId: 'course-001',
    schoolId: 'school-001',
    academicYearId: 'year-001',
    studentName: 'John Doe',
    courseCode: 'MATH101',
    courseName: 'Algebra 1',
    sectionNumber: '001',
    isActive: true,
    enrolledAt: '2025-01-15T00:00:00.000Z',
    enrolledBy: 'admin-user-001',
    createdAt: '2025-01-15T00:00:00.000Z',
    createdBy: 'admin-user-001',
    updatedAt: '2025-01-15T00:00:00.000Z',
    updatedBy: 'admin-user-001',
    version: 1,
    gsi1pk: 'TENANT#tenant-001#SCHOOL#school-001',
    gsi1sk: 'SEC_ENROLL#section-001#JOHN DOE',
    gsi2pk: 'student-001',
    gsi2sk: 'SEC_ENROLL#year-001#MATH101',
    ...overrides,
  };
}

// ============================================
// Tests
// ============================================

describe('SectionEnrollmentService', () => {
  let service: SectionEnrollmentService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SectionEnrollmentService,
        { provide: DynamoDBClientService, useValue: mockDynamoDBClient },
        { provide: AcademicsEventsService, useValue: mockEventsService },
        { provide: DataScopeService, useValue: mockDataScopeService },
      ],
    }).compile();

    service = module.get<SectionEnrollmentService>(SectionEnrollmentService);
  });

  // ------------------------------------------
  // enrollStudent
  // ------------------------------------------
  describe('enrollStudent', () => {
    const activeStudent = {
      entityType: 'STUDENT',
      firstName: 'Alice',
      lastName: 'Wonder',
      status: 'active',
      studentNumber: 'S001',
      currentGradeLevel: '9',
    };
    const activeAnnualEnrollment = { entityType: 'ENROLLMENT', status: 'active' };

    beforeEach(() => {
      // enrollStudent reads section -> student -> annual enrollment, then writes
      // atomically via transactWrite (Put enrollment + Update section counter).
      mockDynamoDBClient.getItem
        .mockResolvedValueOnce(makeMockSection())        // section
        .mockResolvedValueOnce(activeStudent)            // student (SP4-3)
        .mockResolvedValueOnce(activeAnnualEnrollment);  // annual enrollment (SP5-1)
    });

    it('should enroll a student successfully', async () => {
      const result = await service.enrollStudent('section-001', 'school-001', 'student-001', mockContext);

      expect(result).toBeDefined();
      expect(result.studentId).toBe('student-001');
      expect(result.sectionId).toBe('section-001');
      expect(result.enrolledAt).toBeDefined();
      expect(result.enrolledBy).toBe('admin-user-001');

      // Insert enrollment + increment section counter happen atomically.
      expect(mockDynamoDBClient.transactWrite).toHaveBeenCalledTimes(1);
      const items = mockDynamoDBClient.transactWrite.mock.calls[0][1];
      expect(items[0].Put.Item.studentId).toBe('student-001');
      expect(items[0].Put.Item.sectionId).toBe('section-001');
      expect(items[1].Update.UpdateExpression).toContain('currentEnrollment = currentEnrollment + :inc');
      expect(items[1].Update.ExpressionAttributeValues[':inc']).toBe(1);
    });

    it('should throw NotFoundException if section does not exist', async () => {
      mockDynamoDBClient.getItem.mockReset();
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(
        service.enrollStudent('nonexistent', 'school-001', 'student-001', mockContext),
      ).rejects.toThrow(NotFoundException);

      expect(mockDynamoDBClient.putItem).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if section is inactive', async () => {
      mockDynamoDBClient.getItem.mockReset();
      mockDynamoDBClient.getItem.mockResolvedValue(makeMockSection({ isActive: false }));

      await expect(
        service.enrollStudent('section-001', 'school-001', 'student-001', mockContext),
      ).rejects.toThrow(BadRequestException);

      expect(mockDynamoDBClient.putItem).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if section is at capacity', async () => {
      mockDynamoDBClient.getItem.mockReset();
      mockDynamoDBClient.getItem.mockResolvedValue(
        makeMockSection({ maxEnrollment: 30, currentEnrollment: 30 }),
      );

      await expect(
        service.enrollStudent('section-001', 'school-001', 'student-001', mockContext),
      ).rejects.toThrow(BadRequestException);

      expect(mockDynamoDBClient.putItem).not.toHaveBeenCalled();
    });

    it('should throw ConflictException if student is already enrolled', async () => {
      // The conditional Put inside the transaction fails -> TransactionCanceled
      // with reasons[0] = ConditionalCheckFailed -> ConflictException.
      const txErr: any = new Error('transaction cancelled');
      txErr.name = 'TransactionCanceledException';
      txErr.CancellationReasons = [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }];
      mockDynamoDBClient.transactWrite.mockRejectedValueOnce(txErr);

      await expect(
        service.enrollStudent('section-001', 'school-001', 'student-001', mockContext),
      ).rejects.toThrow(ConflictException);
    });

    it('allows re-enrollment via the Put condition (attribute_not_exists OR isActive=false)', async () => {
      const result = await service.enrollStudent('section-001', 'school-001', 'student-001', mockContext);

      expect(result.studentId).toBe('student-001');
      const items = mockDynamoDBClient.transactWrite.mock.calls[0][1];
      // The Put condition permits inserting over a previously-dropped row.
      expect(items[0].Put.ConditionExpression).toContain('isActive = :false');
    });

    it('should populate denormalized fields from section data', async () => {
      await service.enrollStudent('section-001', 'school-001', 'student-001', mockContext);

      // The enrollment entity (inside the transaction Put) carries denormalized
      // section data.
      const putItem = mockDynamoDBClient.transactWrite.mock.calls[0][1][0].Put.Item;
      expect(putItem.courseId).toBe('course-001');
      expect(putItem.courseCode).toBe('MATH101');
      expect(putItem.courseName).toBe('Algebra 1');
      expect(putItem.sectionNumber).toBe('001');
      expect(putItem.academicYearId).toBe('year-001');
    });
  });

  // ------------------------------------------
  // dropStudent
  // ------------------------------------------
  describe('dropStudent', () => {
    beforeEach(() => {
      mockDynamoDBClient.getItem.mockResolvedValue(makeMockEnrollment());
      mockDynamoDBClient.updateItem.mockResolvedValue(undefined);
    });

    it('should drop a student from a section', async () => {
      await service.dropStudent('section-001', 'school-001', 'student-001', mockContext);

      expect(mockDynamoDBClient.transactWrite).toHaveBeenCalledTimes(1);
      const items = mockDynamoDBClient.transactWrite.mock.calls[0][1];
      // soft-delete the enrollment
      expect(items[0].Update.Key.entityKey).toBe('SEC_ENROLL#school-001#section-001#student-001');
      expect(items[0].Update.ExpressionAttributeValues[':isActive']).toBe(false);
      expect(items[0].Update.ExpressionAttributeValues[':droppedBy']).toBe('admin-user-001');
      expect(items[0].Update.ExpressionAttributeValues[':dropReason']).toBe('dropped');
      // decrement the section counter
      expect(items[1].Update.Key.entityKey).toBe('SECTION#school-001#section-001');
      expect(items[1].Update.UpdateExpression).toContain('currentEnrollment = currentEnrollment - :dec');
      expect(items[1].Update.ExpressionAttributeValues[':dec']).toBe(1);
    });

    it('should accept a custom drop reason', async () => {
      await service.dropStudent('section-001', 'school-001', 'student-001', mockContext, 'schedule_change');

      const items = mockDynamoDBClient.transactWrite.mock.calls[0][1];
      expect(items[0].Update.ExpressionAttributeValues[':dropReason']).toBe('schedule_change');
    });

    it('should throw NotFoundException if enrollment does not exist', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(
        service.dropStudent('section-001', 'school-001', 'student-001', mockContext),
      ).rejects.toThrow(NotFoundException);

      expect(mockDynamoDBClient.updateItem).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if enrollment is already inactive', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(
        makeMockEnrollment({ isActive: false }),
      );

      await expect(
        service.dropStudent('section-001', 'school-001', 'student-001', mockContext),
      ).rejects.toThrow(NotFoundException);

      expect(mockDynamoDBClient.updateItem).not.toHaveBeenCalled();
    });

    it('drops via a single read + a 2-leg transaction (soft-delete + counter decrement)', async () => {
      await service.dropStudent('section-001', 'school-001', 'student-001', mockContext);

      const items = mockDynamoDBClient.transactWrite.mock.calls[0][1];
      expect(items).toHaveLength(2);
      expect(mockDynamoDBClient.getItem).toHaveBeenCalledTimes(1);
    });

    it('maps a concurrent-race TransactionCanceledException to Conflict (not an unhandled 500)', async () => {
      const txErr: any = new Error('cancelled');
      txErr.name = 'TransactionCanceledException';
      // The enrollment soft-delete leg (index 0) lost a concurrency race.
      txErr.CancellationReasons = [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }];
      mockDynamoDBClient.transactWrite.mockRejectedValueOnce(txErr);

      await expect(
        service.dropStudent('section-001', 'school-001', 'student-001', mockContext),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ------------------------------------------
  // getSectionRoster
  // ------------------------------------------
  describe('getSectionRoster', () => {
    it('should return the section roster with enrolled students', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(makeMockSection());
      mockDynamoDBClient.queryGSI.mockResolvedValue({
        items: [
          makeMockEnrollment({ studentId: 'student-001', studentName: 'Alice' }),
          makeMockEnrollment({ studentId: 'student-002', studentName: 'Bob' }),
        ],
        hasMore: false,
      });

      const result = await service.getSectionRoster('section-001', 'school-001', mockContext);

      expect(result.sectionId).toBe('section-001');
      expect(result.courseName).toBe('Algebra 1');
      expect(result.sectionNumber).toBe('001');
      expect(result.students).toHaveLength(2);
      expect(result.totalCount).toBe(2);
      expect(result.students[0].studentId).toBe('student-001');
      expect(result.students[1].studentId).toBe('student-002');
    });

    it('should return empty roster for section with no students', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(makeMockSection());
      mockDynamoDBClient.queryGSI.mockResolvedValue({
        items: [],
        hasMore: false,
      });

      const result = await service.getSectionRoster('section-001', 'school-001', mockContext);

      expect(result.students).toHaveLength(0);
      expect(result.totalCount).toBe(0);
    });

    it('should throw NotFoundException if section does not exist', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(
        service.getSectionRoster('nonexistent', 'school-001', mockContext),
      ).rejects.toThrow(NotFoundException);
    });

    it('should query GSI1 with correct key pattern for section enrollments', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(makeMockSection());
      mockDynamoDBClient.queryGSI.mockResolvedValue({
        items: [],
        hasMore: false,
      });

      await service.getSectionRoster('section-001', 'school-001', mockContext);

      expect(mockDynamoDBClient.queryGSI).toHaveBeenCalledWith(
        expect.anything(),
        'GSI1',
        'TENANT#tenant-001#SCHOOL#school-001',
        'SEC_ENROLL#section-001#',
        'begins_with',
        'isActive = :isActive',
        { ':isActive': true },
        undefined,
        500,
      );
    });

  });

  // ------------------------------------------
  // getStudentSections
  // ------------------------------------------
  describe('getStudentSections', () => {
    it('should return all sections a student is enrolled in for an academic year', async () => {
      mockDynamoDBClient.queryGSI.mockResolvedValue({
        items: [
          makeMockEnrollment({
            sectionId: 'section-001',
            courseCode: 'MATH101',
          }),
          makeMockEnrollment({
            sectionId: 'section-002',
            courseCode: 'ENG101',
            studentId: 'student-001',
          }),
        ],
        hasMore: false,
      });

      const result = await service.getStudentSections('student-001', 'year-001', mockContext);

      expect(result).toHaveLength(2);
      expect(result[0].sectionId).toBe('section-001');
      expect(result[1].sectionId).toBe('section-002');
    });

    it('should return empty array if student has no section enrollments', async () => {
      mockDynamoDBClient.queryGSI.mockResolvedValue({
        items: [],
        hasMore: false,
      });

      const result = await service.getStudentSections('student-001', 'year-001', mockContext);

      expect(result).toHaveLength(0);
    });

    it('should query GSI2 with student ID and academic year', async () => {
      mockDynamoDBClient.queryGSI.mockResolvedValue({
        items: [],
        hasMore: false,
      });

      await service.getStudentSections('student-001', 'year-001', mockContext);

      expect(mockDynamoDBClient.queryGSI).toHaveBeenCalledWith(
        expect.anything(),
        'GSI2',
        'student-001',
        'SEC_ENROLL#year-001#',
        'begins_with',
        'isActive = :isActive',
        { ':isActive': true },
        undefined,
        100,
      );
    });
  });
});
