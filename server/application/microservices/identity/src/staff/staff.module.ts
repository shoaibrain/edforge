/**
 * Staff Module - Identity Service
 * 
 * Provides staff management functionality with Ed-Fi alignment.
 */

import { Module } from '@nestjs/common';
import { StaffService } from './staff.service';
import { StaffController, SchoolStaffController } from './staff.controller';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';

@Module({
  controllers: [StaffController, SchoolStaffController],
  providers: [StaffService, DynamoDBClientService, IdentityEventsService],
  exports: [StaffService],
})
export class StaffModule {}
