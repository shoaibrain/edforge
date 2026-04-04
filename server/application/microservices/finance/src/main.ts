/**
 * Finance Service Entry Point
 *
 * Financial domain service providing:
 * - Fee structure management (CRUD)
 * - Invoice generation & lifecycle
 * - Payment processing (manual + gateway)
 * - Student billing accounts & ledger
 * - Payment gateway configuration
 * - Receipt generation
 */

import { NestFactory } from '@nestjs/core';
import { FinanceModule } from './finance.module';
import { ZodValidationPipe } from 'nestjs-zod';
import { StructuredLogger, correlationMiddleware } from '@app/logger';
import { GlobalExceptionFilter } from '@app/exceptions';
import { HealthService } from '@app/health';
import * as compression from 'compression';

async function bootstrap() {
  const logger = new StructuredLogger('finance-service');

  const app = await NestFactory.create(FinanceModule, { logger });

  app.use(compression());
  app.use(correlationMiddleware);
  app.useGlobalFilters(new GlobalExceptionFilter());
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
    {
      name: 'identity-service',
      type: 'http',
      endpoint: process.env.IDENTITY_SERVICE_URL
        ? `${process.env.IDENTITY_SERVICE_URL}/health/live`
        : undefined,
    },
  ]);

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

  app.enableShutdownHooks();

  const port = process.env.PORT || 3010;
  await app.listen(port);

  logger.log(`Finance Service running on port ${port}`);
  logger.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.log(`DynamoDB Table: ${process.env.TABLE_NAME || 'edforge-finance'}`);
  logger.log(`Identity Service: ${process.env.IDENTITY_SERVICE_URL || 'not configured'}`);
  logger.log(`EventBus: ${process.env.EVENT_BUS_NAME || 'not configured'}`);
  logger.log(`Health endpoints: /health, /health/ready, /health/live`);
}

bootstrap();
