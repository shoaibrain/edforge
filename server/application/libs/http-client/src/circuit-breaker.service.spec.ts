import { Test, TestingModule } from '@nestjs/testing';
import { CircuitBreakerService, CircuitState } from './circuit-breaker.service';

describe('CircuitBreakerService', () => {
  let service: CircuitBreakerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CircuitBreakerService]
    }).compile();

    service = module.get<CircuitBreakerService>(CircuitBreakerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getState', () => {
    it('should return CLOSED by default', () => {
      expect(service.getState('test-service')).toBe(CircuitState.CLOSED);
    });
  });

  describe('recordSuccess', () => {
    it('should reset failures on success in CLOSED state', () => {
      const serviceKey = 'test-service';
      service.recordFailure(serviceKey);
      service.recordFailure(serviceKey);
      service.recordSuccess(serviceKey);
      
      // Should still be CLOSED
      expect(service.getState(serviceKey)).toBe(CircuitState.CLOSED);
    });

    it('should close circuit after success threshold in HALF_OPEN state', () => {
      const serviceKey = 'test-service';
      
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        service.recordFailure(serviceKey);
      }
      expect(service.getState(serviceKey)).toBe(CircuitState.OPEN);

      // Manually set to HALF_OPEN (simulating timeout)
      (service as any).circuits.get(serviceKey).state = CircuitState.HALF_OPEN;
      
      // Record success
      service.recordSuccess(serviceKey);
      expect(service.getState(serviceKey)).toBe(CircuitState.CLOSED);
    });
  });

  describe('recordFailure', () => {
    it('should open circuit after failure threshold', () => {
      const serviceKey = 'test-service';
      
      for (let i = 0; i < 5; i++) {
        service.recordFailure(serviceKey);
      }
      
      expect(service.getState(serviceKey)).toBe(CircuitState.OPEN);
    });

    it('should open circuit immediately on failure in HALF_OPEN state', () => {
      const serviceKey = 'test-service';
      
      // Manually set to HALF_OPEN
      (service as any).circuits.set(serviceKey, {
        state: CircuitState.HALF_OPEN,
        failures: 0,
        successes: 0,
        lastFailureTime: null,
        lastSuccessTime: null
      });
      
      service.recordFailure(serviceKey);
      expect(service.getState(serviceKey)).toBe(CircuitState.OPEN);
    });
  });

  describe('isRequestAllowed', () => {
    it('should allow requests when circuit is CLOSED', () => {
      expect(service.isRequestAllowed('test-service')).toBe(true);
    });

    it('should reject requests when circuit is OPEN', () => {
      const serviceKey = 'test-service';
      
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        service.recordFailure(serviceKey);
      }
      
      expect(service.isRequestAllowed(serviceKey)).toBe(false);
    });
  });

  describe('reset', () => {
    it('should reset circuit breaker state', () => {
      const serviceKey = 'test-service';
      service.recordFailure(serviceKey);
      service.reset(serviceKey);
      
      expect(service.getState(serviceKey)).toBe(CircuitState.CLOSED);
    });
  });
});

