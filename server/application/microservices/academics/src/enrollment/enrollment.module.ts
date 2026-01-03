/**
 * Enrollment Module
 */

import { Module } from '@nestjs/common';
import { EnrollmentController } from './enrollment.controller';
import { EnrollmentService } from './enrollment.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AuthModule } from '@app/auth';

@Module({
  imports: [AuthModule],
  controllers: [EnrollmentController],
  providers: [EnrollmentService, DynamoDBClientService],
  exports: [EnrollmentService],
})
export class EnrollmentModule {}

