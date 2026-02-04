import { Module, Global } from '@nestjs/common';

/**
 * Common Utils Module
 * 
 * Provides shared utilities across all microservices:
 * - Retry utilities
 * - Error codes
 * - Base exception classes
 * 
 * This is a global module, so it can be imported once and used everywhere.
 */
@Global()
@Module({
  providers: [],
  exports: []
})
export class CommonUtilsModule {}

