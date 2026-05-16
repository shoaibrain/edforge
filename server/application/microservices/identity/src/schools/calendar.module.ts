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
import { ShiftResolverController } from './shift-resolver.controller';
import { CalendarService } from './calendar.service';
import { CalendarDateService } from './calendar-date.service';
import { AcademicSessionService } from './academic-session.service';
import { ShiftResolverService } from './shift-resolver.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { AuditedWriteService } from '../common/services/audited-write.service';
import { AcademicYearsModule } from '../academic-years/academic-years.module';

@Module({
  imports: [
    forwardRef(() => AcademicYearsModule),  // Need AcademicYearsService for year validation
  ],
  controllers: [
    CalendarController,
    CalendarDateController,
    AcademicSessionController,
    ShiftResolverController,
  ],
  providers: [
    CalendarService,
    CalendarDateService,
    AcademicSessionService,
    ShiftResolverService,
    DynamoDBClientService,
    IdentityEventsService,
    // Sprint S2.3 — CalendarDateService.generateCalendar emits a CALENDAR
    // audit row. Per the S0 retro hotfix lesson (PR #59): every consumer
    // of common services must declare them on its OWN module's providers;
    // root IdentityModule's exports do NOT propagate to child modules that
    // don't explicitly import IdentityModule.
    AuditedWriteService,
  ],
  exports: [
    CalendarService,
    CalendarDateService,
    AcademicSessionService,
  ],
})
export class CalendarModule {}
