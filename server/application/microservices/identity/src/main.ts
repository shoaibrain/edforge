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
 * Validation is handled by Zod schemas from @aibrains/shared-types
 */

import { NestFactory } from '@nestjs/core';
import { IdentityModule } from './identity.module';
import { StructuredLogger } from '@app/logger';
import { configureApp } from './app-setup';

async function bootstrap() {
  const logger = new StructuredLogger('identity-service');
  const app = await NestFactory.create(IdentityModule, { logger });
  configureApp(app, { runtime: 'http' });

  const port = process.env.PORT || 3010;
  await app.listen(port);
  logger.log(`Identity Service running on port ${port}`);
  logger.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.log(`DynamoDB Table: ${process.env.TABLE_NAME || 'edforge-identity'}`);
  logger.log(`EventBus: ${process.env.EVENT_BUS_NAME || 'not configured'}`);
  logger.log(`Health endpoints: /health, /health/ready, /health/live`);
}

bootstrap();
