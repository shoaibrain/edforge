/**
 * Education Organizations Module - Identity Service
 *
 * Provides CRUD for SEA, LEA, ESC and hierarchy assembly.
 */

import { Module } from '@nestjs/common';
import { EducationOrganizationsController } from './education-organizations.controller';
import { EducationOrganizationsService } from './education-organizations.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { AuthModule } from '@app/auth';

@Module({
  imports: [AuthModule],
  controllers: [EducationOrganizationsController],
  providers: [EducationOrganizationsService, DynamoDBClientService, IdentityEventsService],
  exports: [EducationOrganizationsService],
})
export class EducationOrganizationsModule {}
