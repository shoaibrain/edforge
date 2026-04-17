/**
 * Tenants Module for Identity Service
 */

import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { AuthModule } from '@app/auth';

@Module({
  imports: [AuthModule],
  controllers: [TenantsController],
  // IdentityEventsService is a global singleton in identity (also provided in
  // identity.module.ts at the root level for legacy callers); declaring it
  // here as well makes the tenants module self-contained for testing and
  // future extraction.
  providers: [TenantsService, DynamoDBClientService, IdentityEventsService],
  exports: [TenantsService],
})
export class TenantsModule {}

