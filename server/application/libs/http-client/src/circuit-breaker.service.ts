import { Injectable, Logger } from '@nestjs/common';

export enum CircuitState {
  CLOSED = 'CLOSED',     // Normal operation, requests pass through
  OPEN = 'OPEN',         // Circuit open, requests fail fast
  HALF_OPEN = 'HALF_OPEN' // Testing recovery, allow one request
}

export interface CircuitBreakerConfig {
  failureThreshold: number;      // Number of failures before opening circuit
  successThreshold: number;      // Number of successes in half-open to close circuit
  timeout: number;               // Time in milliseconds before attempting recovery
  resetTimeout: number;          // Time in milliseconds before attempting recovery
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,           // 5 failures
  successThreshold: 1,            // 1 success to close
  timeout: 60000,                // 60 seconds
  resetTimeout: 30000             // 30 seconds
};

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
}

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly circuits: Map<string, CircuitBreakerState> = new Map();
  private readonly config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  }

  /**
   * Get or create circuit breaker state for a service
   */
  private getCircuitState(serviceKey: string): CircuitBreakerState {
    if (!this.circuits.has(serviceKey)) {
      this.circuits.set(serviceKey, {
        state: CircuitState.CLOSED,
        failures: 0,
        successes: 0,
        lastFailureTime: null,
        lastSuccessTime: null
      });
    }
    return this.circuits.get(serviceKey)!;
  }

  /**
   * Get current circuit state
   */
  getState(serviceKey: string): CircuitState {
    const state = this.getCircuitState(serviceKey);
    this.updateState(serviceKey, state);
    return state.state;
  }

  /**
   * Update circuit state based on timeouts
   */
  private updateState(serviceKey: string, state: CircuitBreakerState): void {
    const now = Date.now();

    // If circuit is OPEN and timeout has passed, move to HALF_OPEN
    if (state.state === CircuitState.OPEN && state.lastFailureTime) {
      const timeSinceFailure = now - state.lastFailureTime;
      if (timeSinceFailure >= this.config.resetTimeout) {
        this.logger.log(`Circuit breaker for ${serviceKey} moving to HALF_OPEN state`);
        state.state = CircuitState.HALF_OPEN;
        state.failures = 0;
        state.successes = 0;
      }
    }

    // Reset failure count if timeout has passed (for CLOSED state)
    if (state.state === CircuitState.CLOSED && state.lastFailureTime) {
      const timeSinceFailure = now - state.lastFailureTime;
      if (timeSinceFailure >= this.config.timeout) {
        this.logger.log(`Resetting failure count for ${serviceKey} (timeout passed)`);
        state.failures = 0;
      }
    }
  }

  /**
   * Record a successful request
   */
  recordSuccess(serviceKey: string): void {
    const state = this.getCircuitState(serviceKey);
    this.updateState(serviceKey, state);

    if (state.state === CircuitState.HALF_OPEN) {
      state.successes++;
      if (state.successes >= this.config.successThreshold) {
        this.logger.log(`Circuit breaker for ${serviceKey} closing (recovery successful)`);
        state.state = CircuitState.CLOSED;
        state.failures = 0;
        state.successes = 0;
      }
    } else if (state.state === CircuitState.CLOSED) {
      // Reset failure count on success
      state.failures = 0;
    }

    state.lastSuccessTime = Date.now();
  }

  /**
   * Record a failed request
   */
  recordFailure(serviceKey: string): void {
    const state = this.getCircuitState(serviceKey);
    this.updateState(serviceKey, state);

    state.failures++;
    state.lastFailureTime = Date.now();

    if (state.state === CircuitState.HALF_OPEN) {
      // If we fail in half-open, immediately open the circuit
      this.logger.warn(`Circuit breaker for ${serviceKey} opening (failure in HALF_OPEN state)`);
      state.state = CircuitState.OPEN;
      state.successes = 0;
    } else if (state.state === CircuitState.CLOSED) {
      // Check if we've exceeded the failure threshold
      if (state.failures >= this.config.failureThreshold) {
        this.logger.warn(`Circuit breaker for ${serviceKey} opening (${state.failures} failures >= ${this.config.failureThreshold})`);
        state.state = CircuitState.OPEN;
      }
    }
  }

  /**
   * Check if request should be allowed
   */
  isRequestAllowed(serviceKey: string): boolean {
    const state = this.getCircuitState(serviceKey);
    this.updateState(serviceKey, state);

    if (state.state === CircuitState.OPEN) {
      this.logger.warn(`Circuit breaker for ${serviceKey} is OPEN, request rejected`);
      return false;
    }

    return true;
  }

  /**
   * Reset circuit breaker for a service
   */
  reset(serviceKey: string): void {
    this.logger.log(`Resetting circuit breaker for ${serviceKey}`);
    this.circuits.delete(serviceKey);
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    this.logger.log('Resetting all circuit breakers');
    this.circuits.clear();
  }
}

