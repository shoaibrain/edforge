/**
 * Master Schedule Module - Ed-Fi ClassPeriod + Location
 *
 * Provides ClassPeriod and Location management for school
 * master schedule infrastructure. These are school-owned entities
 * referenced by Sections and CourseOfferings in Academics.
 */

import { Module } from '@nestjs/common';
import { ClassPeriodController } from './class-period.controller';
import { LocationController } from './location.controller';
import { ClassPeriodService } from './class-period.service';
import { LocationService } from './location.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';

@Module({
  controllers: [
    ClassPeriodController,
    LocationController,
  ],
  providers: [
    ClassPeriodService,
    LocationService,
    DynamoDBClientService,
    IdentityEventsService,
  ],
  exports: [
    ClassPeriodService,
    LocationService,
  ],
})
export class MasterScheduleModule {}
