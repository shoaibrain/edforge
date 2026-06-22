/**
 * Leave Module - Identity Service
 * 
 * Provides staff leave request management with approval workflow.
 */

import { Module } from '@nestjs/common';
import { LeaveService } from './leave.service';
import { LeaveController } from './leave.controller';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { StaffReadGuard } from '../common/guards/staff-read.guard';

@Module({
  controllers: [LeaveController],
  providers: [LeaveService, DynamoDBClientService, IdentityEventsService, StaffReadGuard],
  exports: [LeaveService],
})
export class LeaveModule {}
