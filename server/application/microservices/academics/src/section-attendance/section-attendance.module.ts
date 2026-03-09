/**
 * Section Attendance Module (Ed-Fi: StudentSectionAttendanceEvent)
 */

import { Module } from '@nestjs/common';
import { SectionAttendanceController } from './section-attendance.controller';
import { SectionAttendanceService } from './section-attendance.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { PermissionGuard } from '../common/guards/permission.guard';
import { DataScopeService } from '../common/services/data-scope.service';
import { SchoolAttendancDerivationService } from '../common/services/school-attendance-derivation.service';
import { AuthModule } from '@app/auth';
import { HttpClientModule } from '@app/http-client';

@Module({
  imports: [AuthModule, HttpClientModule],
  controllers: [SectionAttendanceController],
  providers: [
    SectionAttendanceService,
    DynamoDBClientService,
    AcademicsEventsService,
    IdentityClientService,
    PermissionGuard,
    DataScopeService,
    SchoolAttendancDerivationService,
  ],
  exports: [SectionAttendanceService],
})
export class SectionAttendanceModule {}
