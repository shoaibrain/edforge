import { Test, TestingModule } from '@nestjs/testing';
import { SchoolsController } from './schools.controller';
import { SchoolsService } from './schools.service';
import { AcademicYearService } from './services/academic-year.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { createMockRequestContext } from '../../test/helpers/mock-request-context';
import { createTestSchool } from '../../test/helpers/test-data-factory';

describe('SchoolsController', () => {
  let controller: SchoolsController;
  let schoolsService: jest.Mocked<SchoolsService>;

  beforeEach(async () => {
    const mockSchoolsService = {
      createSchool: jest.fn(),
      getSchools: jest.fn(),
      getSchool: jest.fn(),
      updateSchool: jest.fn(),
      deleteSchool: jest.fn(),
      exportSchoolConfiguration: jest.fn()
    };

    const mockAcademicYearService = {
      createAcademicYear: jest.fn(),
      getAcademicYears: jest.fn()
    };

    // Manually construct controller to ensure dependencies are injected
    controller = new SchoolsController(
      mockSchoolsService as any,
      mockAcademicYearService as any
    );
    schoolsService = mockSchoolsService as any;
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createSchool', () => {
    it('should create a school', async () => {
      const createDto = {
        schoolName: 'Test School',
        schoolCode: 'TEST-001',
        schoolType: 'elementary' as const,
        contactInfo: {
          primaryEmail: 'test@school.com',
          primaryPhone: '+1-555-1234'
        },
        address: {
          street: '123 Test St',
          city: 'Test City',
          state: 'TS',
          postalCode: '12345',
          country: 'US',
          timezone: 'America/New_York'
        },
        maxStudentCapacity: 500,
        gradeRange: {
          lowestGrade: 'K',
          highestGrade: '5'
        }
      };

      const mockSchool = createTestSchool(createDto);
      schoolsService.createSchool.mockResolvedValue(mockSchool);

      const mockReq = {
        user: { userId: 'test-user', 'custom:userRole': 'admin' },
        ip: '127.0.0.1',
        headers: { 'user-agent': 'jest-test' },
        connection: { remoteAddress: '127.0.0.1' }
      };
      const mockTenant = { tenantId: 'test-tenant-123' };

      const result = await controller.createSchool(createDto, mockTenant, mockReq);

      expect(result).toEqual(mockSchool);
      expect(schoolsService.createSchool).toHaveBeenCalledWith(
        'test-tenant-123',
        createDto,
        expect.objectContaining({
          tenantId: 'test-tenant-123',
          userId: 'test-user'
        })
      );
    });
  });
});

