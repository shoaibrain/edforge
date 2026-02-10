/**
 * Staff Module - Identity Service
 * 
 * Provides staff management functionality with Ed-Fi alignment.
 */

import { Module, forwardRef } from '@nestjs/common';
import { StaffService } from './staff.service';
import { StaffAssignmentService } from './staff-assignment.service';
import { StaffEmploymentHistoryService } from './staff-employment-history.service';
import { StaffController, SchoolStaffController, StaffAssignmentController } from './staff.controller';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [forwardRef(() => UsersModule)],
  controllers: [StaffController, SchoolStaffController, StaffAssignmentController],
  providers: [StaffService, StaffAssignmentService, StaffEmploymentHistoryService, DynamoDBClientService, IdentityEventsService],
  exports: [StaffService, StaffAssignmentService, StaffEmploymentHistoryService],
})
export class StaffModule {}
