/**
 * Academic Years Module - Academic year management for Identity Service
 */

import { Module, forwardRef } from '@nestjs/common';
import { AcademicYearsController } from './academic-years.controller';
import { AcademicYearsService } from './academic-years.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { CalendarModule } from '../schools/calendar.module';

@Module({
  imports: [
    forwardRef(() => CalendarModule),  // AcademicSessionService for grading period validation
  ],
  controllers: [AcademicYearsController],
  providers: [AcademicYearsService, DynamoDBClientService],
  exports: [AcademicYearsService],
})
export class AcademicYearsModule {}

