/**
 * Enrollment Module
 */

import { Module } from '@nestjs/common';
import { EnrollmentController } from './enrollment.controller';
import { EnrollmentService } from './enrollment.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { DataScopeService } from '../common/services/data-scope.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { PermissionGuard } from '../common/guards/permission.guard';
import { AuthModule } from '@app/auth';
import { HttpClientModule } from '@app/http-client';

@Module({
  imports: [AuthModule, HttpClientModule],
  controllers: [EnrollmentController],
  providers: [EnrollmentService, DynamoDBClientService, IdentityClientService, DataScopeService, AcademicsEventsService, PermissionGuard],
  exports: [EnrollmentService],
})
export class EnrollmentModule {}

