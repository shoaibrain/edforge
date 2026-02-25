/**
 * Attendance Module
 */

import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { PermissionGuard } from '../common/guards/permission.guard';
import { DataScopeService } from '../common/services/data-scope.service';
import { AuthModule } from '@app/auth';
import { HttpClientModule } from '@app/http-client';

@Module({
  imports: [AuthModule, HttpClientModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, DynamoDBClientService, AcademicsEventsService, IdentityClientService, PermissionGuard, DataScopeService],
  exports: [AttendanceService],
})
export class AttendanceModule {}

