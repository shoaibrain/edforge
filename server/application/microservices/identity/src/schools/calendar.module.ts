/**
 * Calendar Module - Ed-Fi School Calendar Domain
 *
 * Provides Calendar, CalendarDate, and AcademicSession management.
 * Implements the Ed-Fi hierarchy: School → Calendar → CalendarDate
 * and Session/GradingPeriod temporal structure.
 */

import { Module, forwardRef } from '@nestjs/common';
import { CalendarController } from './calendar.controller';
import { CalendarDateController } from './calendar-date.controller';
import { AcademicSessionController } from './academic-session.controller';
import { CalendarService } from './calendar.service';
import { CalendarDateService } from './calendar-date.service';
import { AcademicSessionService } from './academic-session.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { AcademicYearsModule } from '../academic-years/academic-years.module';

@Module({
  imports: [
    forwardRef(() => AcademicYearsModule),  // Need AcademicYearsService for year validation
  ],
  controllers: [
    CalendarController,
    CalendarDateController,
    AcademicSessionController,
  ],
  providers: [
    CalendarService,
    CalendarDateService,
    AcademicSessionService,
    DynamoDBClientService,
    IdentityEventsService,
  ],
  exports: [
    CalendarService,
    CalendarDateService,
    AcademicSessionService,
  ],
})
export class CalendarModule {}
