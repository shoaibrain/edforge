import { Test, TestingModule } from '@nestjs/testing';
import { SchoolsService } from './schools.service';
import { ClientFactoryService } from '@app/client-factory';
import { ValidationService } from './services/validation.service';
import { EventService } from './services/event.service';
import { createMockRequestContext } from '../../test/helpers/mock-request-context';
import { createMockDynamoDBClient } from '../../test/helpers/mock-dynamodb';
import { createTestSchool } from '../../test/helpers/test-data-factory';

describe('SchoolsService', () => {
  let service: SchoolsService;
  let mockDynamoDB: ReturnType<typeof createMockDynamoDBClient>;

  beforeEach(async () => {
    mockDynamoDB = createMockDynamoDBClient();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchoolsService,
        {
          provide: ClientFactoryService,
          useValue: {
            getClient: jest.fn().mockResolvedValue(mockDynamoDB.client)
          }
        },
        {
          provide: ValidationService,
          useValue: {
            validateSchool: jest.fn().mockResolvedValue(undefined)
          }
        },
        {
          provide: EventService,
          useValue: {
            publishEvent: jest.fn().mockResolvedValue(undefined)
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

