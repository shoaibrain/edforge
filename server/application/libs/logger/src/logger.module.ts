/**
 * Logger Module
 * 
 * Provides structured JSON logging service for all microservices.
 */

import { Module, Global } from '@nestjs/common';
import { StructuredLogger } from './logger.service';

@Global()
@Module({
  providers: [
    {
      provide: StructuredLogger,
      useFactory: () => {
        const serviceName = process.env.SERVICE_NAME || 'edforge-service';
        return new StructuredLogger(serviceName);
      },
    },
  ],
  exports: [StructuredLogger],
})
export class LoggerModule {}

