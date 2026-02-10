/**
 * Enrollment Module
 */

import { Module } from '@nestjs/common';
import { EnrollmentController } from './enrollment.controller';
import { EnrollmentService } from './enrollment.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { AuthModule } from '@app/auth';
import { HttpClientModule } from '@app/http-client';

@Module({
  imports: [AuthModule, HttpClientModule],
  controllers: [EnrollmentController],
  providers: [EnrollmentService, DynamoDBClientService, IdentityClientService],
  exports: [EnrollmentService],
})
export class EnrollmentModule {}

