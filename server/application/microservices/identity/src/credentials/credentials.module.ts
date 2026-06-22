/**
 * Credentials Module - Identity Service
 *
 * Provides staff credential/certification management with Ed-Fi alignment.
 * Imports IemisModule (Sprint 4 S4.7) so the credential CRUD paths can
 * emit `staff.credential.{created,edited,deleted}` IEMIS audit events
 * without re-instantiating the logger.
 */

import { Module } from '@nestjs/common';
import { CredentialsService } from './credentials.service';
import { CredentialsController, ExpiringCredentialsController } from './credentials.controller';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { StaffReadGuard } from '../common/guards/staff-read.guard';
import { IemisModule } from '../iemis/iemis.module';

@Module({
  imports: [IemisModule],
  controllers: [CredentialsController, ExpiringCredentialsController],
  providers: [CredentialsService, DynamoDBClientService, IdentityEventsService, StaffReadGuard],
  exports: [CredentialsService],
})
export class CredentialsModule {}
