import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { HttpClientService, RequestContext } from './http-client.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { RetryStrategyService } from './retry-strategy.service';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('HttpClientService', () => {
  let service: HttpClientService;
  let circuitBreaker: CircuitBreakerService;
  let retryStrategy: RetryStrategyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CircuitBreakerService,
        RetryStrategyService,
        {
          provide: HttpClientService,
          useFactory: (cb: CircuitBreakerService, rs: RetryStrategyService) => {
            return new HttpClientService(cb, rs, { baseURL: 'http://test-service' });
          },
          inject: [CircuitBreakerService, RetryStrategyService]
        }
      ]
    }).compile();

    service = module.get<HttpClientService>(HttpClientService);
    circuitBreaker = module.get<CircuitBreakerService>(CircuitBreakerService);
    retryStrategy = module.get<RetryStrategyService>(RetryStrategyService);

    // Reset mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('get', () => {
    it('should make GET request', async () => {
      const mockResponse = { data: { id: '1' }, status: 200 };
      mockedAxios.create.mockReturnValue({
        request: jest.fn().mockResolvedValue(mockResponse)
      } as any);

      const context: RequestContext = {
        tenantId: 'tenant-1',
        userId: 'user-1',
        jwtToken: 'token-123'
      };

      const result = await service.get('/test', {}, context);
      expect(result).toEqual(mockResponse);
    });
  });

  describe('post', () => {
    it('should make POST request with data', async () => {
      const mockResponse = { data: { id: '1' }, status: 201 };
      mockedAxios.create.mockReturnValue({
        request: jest.fn().mockResolvedValue(mockResponse)
      } as any);

      const context: RequestContext = {
        tenantId: 'tenant-1',
        userId: 'user-1',
        jwtToken: 'token-123'
      };

      const result = await service.post('/test', { name: 'test' }, {}, context);
      expect(result).toEqual(mockResponse);
    });
  });

  describe('circuit breaker integration', () => {
    it('should reject requests when circuit is open', async () => {
      const serviceKey = 'test-service';
      
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        circuitBreaker.recordFailure(serviceKey);
      }

      await expect(service.get('http://test-service/test')).rejects.toMatchObject({
        isCircuitBreakerOpen: true
      });
    });
  });

  describe('headers', () => {
    it('should include JWT token in headers', async () => {
      const mockRequest = jest.fn().mockResolvedValue({ data: {}, status: 200 });
      mockedAxios.create.mockReturnValue({
        request: mockRequest
      } as any);

      const context: RequestContext = {
        tenantId: 'tenant-1',
        userId: 'user-1',
        jwtToken: 'token-123'
      };

      await service.get('/test', {}, context);
      
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer token-123',
            'X-Tenant-Id': 'tenant-1',
            'X-User-Id': 'user-1'
          })
        })
      );
    });
  });
});

