import { Module, Global } from '@nestjs/common';
import { HttpClientService } from './http-client.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { RetryStrategyService } from './retry-strategy.service';

@Global()
@Module({
  providers: [
    // CircuitBreakerService takes an optional config parameter
    // Use factory to instantiate with default config
    {
      provide: CircuitBreakerService,
      useFactory: () => new CircuitBreakerService(),
    },
    // RetryStrategyService has no constructor dependencies
    RetryStrategyService,
    // HttpClientService depends on CircuitBreaker and RetryStrategy
    {
      provide: HttpClientService,
      useFactory: (circuitBreaker: CircuitBreakerService, retryStrategy: RetryStrategyService) => {
        return new HttpClientService(circuitBreaker, retryStrategy);
      },
      inject: [CircuitBreakerService, RetryStrategyService]
    }
  ],
  exports: [HttpClientService, CircuitBreakerService, RetryStrategyService]
})
export class HttpClientModule {}
