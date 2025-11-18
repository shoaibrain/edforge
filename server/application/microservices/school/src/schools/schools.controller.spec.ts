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
      deleteSchool: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SchoolsController],
      providers: [
        {
          provide: SchoolsService,
          useValue: mockSchoolsService
        },
        {
          provide: AcademicYearService,
          useValue: {
            createAcademicYear: jest.fn(),
            getAcademicYears: jest.fn()
          }
        }
      ]
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<SchoolsController>(SchoolsController);
    schoolsService = module.get(SchoolsService) as jest.Mocked<SchoolsService>;
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createSchool', () => {
    it('should create a school', async () => {
      const createDto = {
        schoolName: 'Test School',
        address: {
          street: '123 Test St',
          city: 'Test City',
          state: 'TS',
          zipCode: '12345',
          country: 'USA'
        },
        phone: '555-1234',
        email: 'test@school.com'
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

