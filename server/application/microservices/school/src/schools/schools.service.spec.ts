import { Test, TestingModule } from '@nestjs/testing';
import { SchoolsService } from './schools.service';
import { ClientFactoryService } from '@app/client-factory';
import { ValidationService } from './services/validation.service';
import { EventService } from './services/event.service';
import { AcademicYearService } from './services/academic-year.service';
import { createMockRequestContext } from '../../test/helpers/mock-request-context';
import { createMockDynamoDBClient } from '../../test/helpers/mock-dynamodb';
import { createTestSchool } from '../../test/helpers/test-data-factory';

describe('SchoolsService', () => {
  let service: SchoolsService;
  let mockDynamoDB: ReturnType<typeof createMockDynamoDBClient>;

  let mockValidationService: jest.Mocked<ValidationService>;
  let mockEventService: jest.Mocked<EventService>;
  let mockAcademicYearService: jest.Mocked<AcademicYearService>;

  beforeEach(async () => {
    mockDynamoDB = createMockDynamoDBClient();
    
    // Create proper mocks
    mockValidationService = {
      validateSchool: jest.fn().mockResolvedValue(undefined),
      validateSchoolCreation: jest.fn().mockResolvedValue(undefined)
    } as any;

    mockEventService = {
      publishEvent: jest.fn().mockResolvedValue(undefined)
    } as any;

    mockAcademicYearService = {
      getAcademicYears: jest.fn().mockResolvedValue([]),
      getHolidays: jest.fn().mockResolvedValue([])
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: SchoolsService,
          useFactory: (
            clientFac: ClientFactoryService,
            validationService: ValidationService,
            eventService: EventService,
            academicYearService: AcademicYearService,
            cache: any
          ) => {
            return new SchoolsService(clientFac, validationService, eventService, academicYearService, cache);
          },
          inject: [ClientFactoryService, ValidationService, EventService, AcademicYearService, 'ICacheService']
        },
        {
          provide: ClientFactoryService,
          useValue: {
            getClient: jest.fn().mockResolvedValue(mockDynamoDB.client)
          }
        },
        {
          provide: ValidationService,
          useValue: mockValidationService
        },
        {
          provide: EventService,
          useValue: mockEventService
        },
        {
          provide: AcademicYearService,
          useValue: mockAcademicYearService
        },
        {
          provide: 'ICacheService',
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue(undefined),
            delete: jest.fn().mockResolvedValue(undefined),
            clear: jest.fn().mockResolvedValue(undefined)
          }
        }
      ]
    }).compile();

    service = module.get<SchoolsService>(SchoolsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createSchool', () => {
    it('should create a school successfully', async () => {
      const context = createMockRequestContext();
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
      mockDynamoDB.mockSend.mockResolvedValueOnce({});

      const result = await service.createSchool(
        context.tenantId,
        createDto,
        context
      );

      expect(result).toBeDefined();
      expect(result.schoolName).toBe(createDto.schoolName);
      expect(mockDynamoDB.mockSend).toHaveBeenCalled();
    });
  });
});

