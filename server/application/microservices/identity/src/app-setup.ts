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
 * Everything the identity app needs between `NestFactory.create()` and
 * serving requests, shared by the HTTP entry (`main.ts`) and the Lambda
 * entry (`lambda.ts`).
 *
 * `compression()` is only registered for the HTTP runtime: behind API
 * Gateway the stage compresses responses itself, and a gzip body from the
 * function would have to be base64-encoded through the proxy contract.
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
  ]);

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

  return app;
}
