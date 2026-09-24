import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { runWithLogContext } from '@app/logger';
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
      // Breaker keys are host + owning service since cost-redesign C2.6.
      const serviceKey = 'test-service/identity';

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

// Cost-redesign C2.6 — service-to-service calls now cross API-B, whose
// authorizer needs the operator's JWT on every request, including the
// x-internal-api-key calls that used to travel Service Connect only.
describe('HttpClientService — internal-key calls still carry the operator JWT (C2.6)', () => {
  let service: HttpClientService;
  let axiosInstance: { get: jest.Mock; post: jest.Mock };

  beforeEach(() => {
    service = new HttpClientService(new CircuitBreakerService(), new RetryStrategyService());
    axiosInstance = (service as any).axiosInstance;
    axiosInstance.get = jest.fn().mockResolvedValue({ data: [], status: 200, statusText: 'OK', headers: {}, config: {} as any });
    axiosInstance.post = jest.fn().mockResolvedValue({ data: {}, status: 202, statusText: 'Accepted', headers: {}, config: {} as any });
  });

  const context: RequestContext = { tenantId: 'tenant-1', userId: 'user-1', jwtToken: 'jwt-abc', userRole: 'TenantAdmin' };

  it('sends both x-internal-api-key and Authorization: Bearer <jwt> on a GET', async () => {
    await service.get('https://api-b.example/prod/internal/schools/s1/academic-years', { headers: { 'x-internal-api-key': 'shared-secret' } }, context);
    expect(axiosInstance.get).toHaveBeenCalledWith(
      'https://api-b.example/prod/internal/schools/s1/academic-years',
      expect.objectContaining({ headers: expect.objectContaining({ 'x-internal-api-key': 'shared-secret', Authorization: 'Bearer jwt-abc', 'X-Tenant-Id': 'tenant-1' }) }),
    );
  });

  it('sends both on a POST (the enrollment webhooks)', async () => {
    await service.post('https://api-b.example/prod/internal/webhooks/enrollment-completed', { studentId: 'x' }, { headers: { 'x-internal-api-key': 'shared-secret' } }, context);
    expect(axiosInstance.post).toHaveBeenCalledWith(
      'https://api-b.example/prod/internal/webhooks/enrollment-completed',
      { studentId: 'x' },
      expect.objectContaining({ headers: expect.objectContaining({ 'x-internal-api-key': 'shared-secret', Authorization: 'Bearer jwt-abc' }) }),
    );
  });
});

describe('HttpClientService — circuit-breaker key and timeout under API-B (C2.6 review fixes)', () => {
  const key = (url: string) => (new HttpClientService(new CircuitBreakerService(), new RetryStrategyService()) as any).getServiceKey(url);

  it('keys the breaker per owning service when the three siblings share the API-B host', () => {
    const b = 'https://abc123.execute-api.ap-south-1.amazonaws.com/prod';
    expect(key(`${b}/schools/s1`)).toBe('abc123.execute-api.ap-south-1.amazonaws.com/identity');
    expect(key(`${b}/users/u1/roles/permissions/check`)).toBe('abc123.execute-api.ap-south-1.amazonaws.com/identity');
    expect(key(`${b}/internal/schools/s1/academic-years`)).toBe('abc123.execute-api.ap-south-1.amazonaws.com/identity');
    expect(key(`${b}/academics/students/x`)).toBe('abc123.execute-api.ap-south-1.amazonaws.com/academics');
    expect(key(`${b}/finance/schools/s1/invoices`)).toBe('abc123.execute-api.ap-south-1.amazonaws.com/finance');
    expect(key(`${b}/internal/webhooks/enrollment-completed`)).toBe('abc123.execute-api.ap-south-1.amazonaws.com/finance');
  });

  it('keeps distinct keys per Cloud Map host on ECS', () => {
    expect(key('http://identity-api.basic.sc:3010/schools/s1')).toBe('identity-api.basic.sc/identity');
    expect(key('http://finance-api.basic.sc:3010/internal/webhooks/student-withdrawn')).toBe('finance-api.basic.sc/finance');
  });

  it('defaults the timeout to 5 s on ECS and 10 s under Lambda', () => {
    const saved = process.env.EDFORGE_RUNTIME;
    try {
      delete process.env.EDFORGE_RUNTIME;
      expect((new HttpClientService(new CircuitBreakerService(), new RetryStrategyService()) as any).defaultTimeout).toBe(5000);
      process.env.EDFORGE_RUNTIME = 'lambda';
      expect((new HttpClientService(new CircuitBreakerService(), new RetryStrategyService()) as any).defaultTimeout).toBe(10000);
      expect((new HttpClientService(new CircuitBreakerService(), new RetryStrategyService(), { timeout: 700 }) as any).defaultTimeout).toBe(700);
    } finally {
      if (saved === undefined) delete process.env.EDFORGE_RUNTIME; else process.env.EDFORGE_RUNTIME = saved;
    }
  });
});

// LILI-BUG #506 G1 — buildHeaders forwarded Authorization/X-Tenant-Id/X-User-Id/
// X-User-Role but not X-Correlation-Id, so the callee minted a fresh id and the
// academics -> finance enrollment webhook could not be traced end to end.
describe('HttpClientService — X-Correlation-Id forwarding (#506 G1)', () => {
  let service: HttpClientService;
  let axiosInstance: { get: jest.Mock };

  const headersOf = (mock: jest.Mock): Record<string, string> => mock.mock.calls[0][1].headers;

  const context: RequestContext = { tenantId: 'tenant-1', userId: 'user-1', jwtToken: 'jwt-abc' };

  beforeEach(() => {
    service = new HttpClientService(new CircuitBreakerService(), new RetryStrategyService());
    axiosInstance = (service as any).axiosInstance;
    axiosInstance.get = jest.fn().mockResolvedValue({ data: {}, status: 200, statusText: 'OK', headers: {}, config: {} as any });
  });

  it('forwards the id supplied explicitly on the request context', async () => {
    await service.get('/test', {}, { ...context, correlationId: 'corr-explicit' });
    expect(headersOf(axiosInstance.get)['X-Correlation-Id']).toBe('corr-explicit');
  });

  it('falls back to the AsyncLocalStorage store so existing callers need no change', async () => {
    await runWithLogContext({ correlationId: 'corr-from-als', tenantId: 'tenant-1' }, () =>
      service.get('/test', {}, context),
    );
    expect(headersOf(axiosInstance.get)['X-Correlation-Id']).toBe('corr-from-als');
  });

  it('prefers the explicit context id over the ambient store', async () => {
    await runWithLogContext({ correlationId: 'corr-from-als' }, () =>
      service.get('/test', {}, { ...context, correlationId: 'corr-explicit' }),
    );
    expect(headersOf(axiosInstance.get)['X-Correlation-Id']).toBe('corr-explicit');
  });

  it('carries the id on a contextless call — the esewa/khalti gateway shape', async () => {
    await runWithLogContext({ correlationId: 'corr-from-als' }, () => service.get('https://gateway.example/verify'));
    expect(headersOf(axiosInstance.get)['X-Correlation-Id']).toBe('corr-from-als');
  });

  it('omits the header entirely when neither source has one — worker and scheduled invocations', async () => {
    await service.get('/test', {}, context);
    const headers = headersOf(axiosInstance.get);
    expect(headers).not.toHaveProperty('X-Correlation-Id');
    expect(headers).toMatchObject({ Authorization: 'Bearer jwt-abc', 'X-Tenant-Id': 'tenant-1', 'X-User-Id': 'user-1' });
  });
});
