import { INestApplication } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import { correlationMiddleware } from '@app/logger';
import { GlobalExceptionFilter } from '@app/exceptions';
import { HealthService } from '@app/health';
import type { AppRuntime } from '@app/common-utils';
import * as compression from 'compression';

export interface ConfigureAppOptions {
  runtime: AppRuntime;
}

/**
 * Everything the finance app needs between `NestFactory.create()` and
 * serving requests, shared by the HTTP entry (`main.ts`) and the Lambda
 * entry (`lambda.ts`).
 *
 * `compression()` and the shutdown hooks are HTTP-runtime only: API Gateway
 * compresses responses itself, and a Lambda execution environment has no
 * SIGTERM-driven shutdown to hook.
 */
export function configureApp(app: INestApplication, { runtime }: ConfigureAppOptions): INestApplication {
  if (runtime === 'http') {
    app.use(compression());
  }
  app.use(correlationMiddleware);
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(new ZodValidationPipe());

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

  if (runtime === 'http') {
    app.enableShutdownHooks();
  }

  return app;
}
