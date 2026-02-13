/**
 * Attendance Module
 */

import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { AuthModule } from '@app/auth';

@Module({
  imports: [AuthModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, DynamoDBClientService, AcademicsEventsService],
  exports: [AttendanceService],
})
export class AttendanceModule {}

