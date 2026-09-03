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
import { AcademicsModule } from './academics.module';
import { StructuredLogger } from '@app/logger';
import { configureApp } from './app-setup';

async function bootstrap() {
  const logger = new StructuredLogger('academics-service');
  const app = await NestFactory.create(AcademicsModule, { logger });
  configureApp(app, { runtime: 'http' });

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
