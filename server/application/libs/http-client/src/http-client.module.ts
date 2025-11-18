import { Module, Global } from '@nestjs/common';
import { HttpClientService } from './http-client.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { RetryStrategyService } from './retry-strategy.service';

@Global()
@Module({
  providers: [
    CircuitBreakerService,
    RetryStrategyService,
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

