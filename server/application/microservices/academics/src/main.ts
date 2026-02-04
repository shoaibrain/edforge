/**
 * Academics Service Entry Point
 * 
 * Consolidated academic domain service providing:
 * - Student management (CRUD, search, filters)
 * - Enrollment lifecycle (enroll, withdraw, transfer)
 * - Attendance tracking (daily, bulk, summaries)
 * - Grades and assessments (future)
 * - Curriculum and scheduling (future)
 */

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AcademicsModule } from './academics.module';
import { StructuredLogger, correlationMiddleware } from '@app/logger';
import { GlobalExceptionFilter } from '@app/exceptions';
import { HealthService } from '@app/health';
import * as compression from 'compression';

async function bootstrap() {
  // Use structured logger for CloudWatch-compatible JSON logging
  const logger = new StructuredLogger('academics-service');
  
  const app = await NestFactory.create(AcademicsModule, {
    logger,
  });

  // Enable compression
  app.use(compression());

  // Add correlation ID middleware for distributed tracing
  app.use(correlationMiddleware);

  // Global exception filter for consistent error responses
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

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
    {
      name: 'identity-service',
      type: 'http',
      endpoint: process.env.IDENTITY_SERVICE_URL 
        ? `${process.env.IDENTITY_SERVICE_URL}/health/live` 
        : undefined,
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
      'X-School-Id',
      'X-Correlation-Id',
      'X-Request-Id',
    ],
    exposedHeaders: ['X-Correlation-Id'],
  });

  // Note: No API prefix - routes match API Gateway paths directly
  // e.g., /academics/students, /academics/enrollments, /academics/attendance

  const port = process.env.PORT || 3010;
  await app.listen(port);

  logger.log(`Academics Service running on port ${port}`);
  logger.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.log(`DynamoDB Table: ${process.env.TABLE_NAME || 'edforge-academics'}`);
  logger.log(`Identity Service: ${process.env.IDENTITY_SERVICE_URL || 'not configured'}`);
  logger.log(`EventBus: ${process.env.EVENT_BUS_NAME || 'not configured'}`);
  logger.log(`Health endpoints: /health, /health/ready, /health/live`);
}

bootstrap();
