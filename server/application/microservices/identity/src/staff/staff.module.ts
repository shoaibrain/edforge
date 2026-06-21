/**
 * Staff Module - Identity Service
 *
 * Provides staff management functionality with Ed-Fi alignment.
 * Imports IemisModule (Sprint 4 S4.7) so StaffAssignmentService can emit
 * `staff.assignment.{created,edited,deleted}` IEMIS audit events.
 */

import { Module, forwardRef } from '@nestjs/common';
import { StaffService } from './staff.service';
import { StaffAssignmentService } from './staff-assignment.service';
import { StaffEmploymentHistoryService } from './staff-employment-history.service';
import { StaffController, SchoolStaffController, StaffAssignmentController } from './staff.controller';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { StaffReadGuard } from '../common/guards/staff-read.guard';
import { UsersModule } from '../users/users.module';
import { RolesModule } from '../roles/roles.module';
import { IdentityAnalyticsEventsModule } from '../common/services/identity-analytics-events.module';
import { IemisModule } from '../iemis/iemis.module';

@Module({
  imports: [forwardRef(() => UsersModule), RolesModule, IdentityAnalyticsEventsModule, IemisModule],
  controllers: [StaffController, SchoolStaffController, StaffAssignmentController],
  providers: [StaffService, StaffAssignmentService, StaffEmploymentHistoryService, DynamoDBClientService, IdentityEventsService, StaffReadGuard],
  exports: [StaffService, StaffAssignmentService, StaffEmploymentHistoryService],
})
export class StaffModule {}
