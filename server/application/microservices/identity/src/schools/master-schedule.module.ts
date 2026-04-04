/**
 * Master Schedule Module - Ed-Fi ClassPeriod + Location + BellSchedule
 *
 * Provides ClassPeriod, Location, and BellSchedule management for school
 * master schedule infrastructure. These are school-owned entities
 * referenced by Sections and CourseOfferings in Academics.
 */

import { Module } from '@nestjs/common';
import { ClassPeriodController } from './class-period.controller';
import { LocationController } from './location.controller';
import { BellScheduleController } from './bell-schedule.controller';
import { ClassPeriodService } from './class-period.service';
import { LocationService } from './location.service';
import { BellScheduleService } from './bell-schedule.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';

@Module({
  controllers: [
    ClassPeriodController,
    LocationController,
    BellScheduleController,
  ],
  providers: [
    ClassPeriodService,
    LocationService,
    BellScheduleService,
    DynamoDBClientService,
    IdentityEventsService,
  ],
  exports: [
    ClassPeriodService,
    LocationService,
    BellScheduleService,
  ],
})
export class MasterScheduleModule {}
