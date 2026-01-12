/**
 * Credentials Module - Identity Service
 * 
 * Provides staff credential/certification management with Ed-Fi alignment.
 */

import { Module } from '@nestjs/common';
import { CredentialsService } from './credentials.service';
import { CredentialsController, ExpiringCredentialsController } from './credentials.controller';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';

@Module({
  controllers: [CredentialsController, ExpiringCredentialsController],
  providers: [CredentialsService, DynamoDBClientService, IdentityEventsService],
  exports: [CredentialsService],
})
export class CredentialsModule {}
