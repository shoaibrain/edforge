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
import { StructuredLogger } from '@app/logger';
import { configureApp } from './app-setup';

async function bootstrap() {
  const logger = new StructuredLogger('finance-service');
  const app = await NestFactory.create(FinanceModule, { logger });
  configureApp(app, { runtime: 'http' });

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
