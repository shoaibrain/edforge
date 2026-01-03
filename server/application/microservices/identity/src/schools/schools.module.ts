/**
 * Schools Module for Identity Service
 * 
 * Provides school management, configuration, and department functionality
 * with event publishing for cross-service communication.
 */

import { Module } from '@nestjs/common';
import { SchoolsController } from './schools.controller';
import { SchoolsService } from './schools.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { AuthModule } from '@app/auth';

@Module({
  imports: [AuthModule],
  controllers: [SchoolsController],
  providers: [SchoolsService, DynamoDBClientService, IdentityEventsService],
  exports: [SchoolsService],
})
export class SchoolsModule {}
