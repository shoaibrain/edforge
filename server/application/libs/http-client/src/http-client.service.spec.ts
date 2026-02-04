import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { HttpClientService, RequestContext } from './http-client.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { RetryStrategyService } from './retry-strategy.service';

// Mock axios properly
jest.mock('axios', () => {
  const mockAxiosInstance = {
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() }
    },
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    patch: jest.fn(),
    request: jest.fn()
  };
  
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => mockAxiosInstance),
      ...mockAxiosInstance
    },
    create: jest.fn(() => mockAxiosInstance)
  };
});

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('HttpClientService', () => {
  let service: HttpClientService;
  let circuitBreaker: CircuitBreakerService;
  let retryStrategy: RetryStrategyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: CircuitBreakerService,
          useFactory: () => new CircuitBreakerService(),
        },
        {
          provide: RetryStrategyService,
          useFactory: () => new RetryStrategyService(),
        },
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
      const mockResponse = { data: { id: '1' }, status: 200, statusText: 'OK', headers: {}, config: {} as any };
      
      // Get the axios instance created by the service and mock its get method
      const axiosInstance = (service as any).axiosInstance;
      axiosInstance.get = jest.fn().mockResolvedValue(mockResponse);

      const context: RequestContext = {
        tenantId: 'tenant-1',
        userId: 'user-1',
        jwtToken: 'token-123'
      };

      const result = await service.get('/test', {}, context);
      expect(result).toEqual(mockResponse);
      expect(axiosInstance.get).toHaveBeenCalled();
    });
  });

  describe('post', () => {
    it('should make POST request with data', async () => {
      const mockResponse = { data: { id: '1' }, status: 201, statusText: 'Created', headers: {}, config: {} as any };
      
      // Get the axios instance created by the service and mock its post method
      const axiosInstance = (service as any).axiosInstance;
      axiosInstance.post = jest.fn().mockResolvedValue(mockResponse);

      const context: RequestContext = {
        tenantId: 'tenant-1',
        userId: 'user-1',
        jwtToken: 'token-123'
      };

      const result = await service.post('/test', { name: 'test' }, {}, context);
      expect(result).toEqual(mockResponse);
      expect(axiosInstance.post).toHaveBeenCalled();
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
      const mockResponse = { data: {}, status: 200, statusText: 'OK', headers: {}, config: {} as any };
      
      // Get the axios instance created by the service and mock its get method
      const axiosInstance = (service as any).axiosInstance;
      const mockGet = jest.fn().mockResolvedValue(mockResponse);
      axiosInstance.get = mockGet;

      const context: RequestContext = {
        tenantId: 'tenant-1',
        userId: 'user-1',
        jwtToken: 'token-123'
      };

      await service.get('/test', {}, context);
      
      expect(mockGet).toHaveBeenCalledWith(
        '/test',
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
