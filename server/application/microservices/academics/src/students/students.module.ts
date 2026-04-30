/**
 * Students Module
 * 
 * Provides student management functionality with event publishing
 * for cross-service communication.
 * 
 * ARCHITECTURE: Uses IdentityClientService for school validation
 */

import { Module, forwardRef } from '@nestjs/common';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';
import { StudentIdService } from './student-id.service';
import { IemisImportJobsService } from './iemis-import-jobs.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { DataScopeService } from '../common/services/data-scope.service';
import { IemisAuditLogger } from '../common/services/iemis-audit-logger.service';
import { PermissionGuard } from '../common/guards/permission.guard';
import { HttpClientModule } from '@app/http-client';
import { AuthModule } from '@app/auth';
import { EnrollmentModule } from '../enrollment/enrollment.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { SectionsModule } from '../sections/sections.module';
import { GradesModule } from '../grades/grades.module';

@Module({
  imports: [
    AuthModule,
    HttpClientModule,
    forwardRef(() => EnrollmentModule),
    forwardRef(() => AttendanceModule),
    forwardRef(() => SectionsModule),
    forwardRef(() => GradesModule),
  ],
  controllers: [StudentsController],
  providers: [
    StudentsService,
    StudentIdService,
    IemisImportJobsService,
    DynamoDBClientService,
    AcademicsEventsService,
    IdentityClientService,
    DataScopeService,
    PermissionGuard,
    IemisAuditLogger,
  ],
  exports: [StudentsService, StudentIdService, IemisImportJobsService],
})
export class StudentsModule {}
