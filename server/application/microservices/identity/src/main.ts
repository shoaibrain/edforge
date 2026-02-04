/**
 * Identity Service Entry Point
 * 
 * Provides:
 * - Authentication (login, logout, refresh)
 * - User management (CRUD, preferences)
 * - ABAC role assignment (per school)
 * - Session management (TTL-based)
 * - School and tenant management
 * - Academic year configuration
 * 
 * Validation is handled by Zod schemas from @edforge/shared-types
 */

import { NestFactory } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { IdentityModule } from './identity.module';
import { StructuredLogger, correlationMiddleware } from '@app/logger';
import { GlobalExceptionFilter } from '@app/exceptions';
import { HealthService } from '@app/health';
import * as compression from 'compression';

async function bootstrap() {
  // Use structured logger for CloudWatch-compatible JSON logging
  const logger = new StructuredLogger('identity-service');
  
  const app = await NestFactory.create(IdentityModule, {
    logger,
  });

  // Enable compression
  app.use(compression());

  // Add correlation ID middleware for distributed tracing
  app.use(correlationMiddleware);

  // Global exception filter for consistent error responses
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Global validation pipe - Zod handles all DTO validation
  // DTOs are created with createZodDto() from nestjs-zod using schemas from @edforge/shared-types
  app.useGlobalPipes(new ZodValidationPipe());

  // Register health check dependencies
  const healthService = app.get(HealthService);
  healthService.registerDependencies([
    {
      name: 'dynamodb',
      type: 'dynamodb',
      tableName: process.env.TABLE_NAME,
    },
    {
      name: 'eventbridge',
      type: 'eventbridge',
      eventBusName: process.env.EVENT_BUS_NAME,
    },
  ]);

  // CORS configuration
  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type', 
      'Authorization', 
      'X-Tenant-Id',
      'X-Correlation-Id',
      'X-Request-Id',
    ],
    exposedHeaders: ['X-Correlation-Id'],
  });

  // Note: No API prefix - routes match API Gateway paths directly
  // e.g., /users, /auth, /schools, /tenants

  const port = process.env.PORT || 3010;
  await app.listen(port);

  logger.log(`Identity Service running on port ${port}`);
  logger.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.log(`DynamoDB Table: ${process.env.TABLE_NAME || 'edforge-identity'}`);
  logger.log(`EventBus: ${process.env.EVENT_BUS_NAME || 'not configured'}`);
  logger.log(`Health endpoints: /health, /health/ready, /health/live`);
}

bootstrap();
