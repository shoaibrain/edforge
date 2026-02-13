/**
 * Courses Module
 *
 * Provides course catalog management functionality.
 * Depends on Identity service for school validation.
 */

import { Module } from '@nestjs/common';
import { CoursesController } from './courses.controller';
import { CourseOfferingController } from './course-offering.controller';
import { CoursesService } from './courses.service';
import { CourseOfferingService } from './course-offering.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { HttpClientModule } from '@app/http-client';
import { AuthModule } from '@app/auth';

@Module({
  imports: [AuthModule, HttpClientModule],
  controllers: [CoursesController, CourseOfferingController],
  providers: [
    CoursesService,
    CourseOfferingService,
    DynamoDBClientService,
    AcademicsEventsService,
    IdentityClientService,
  ],
  exports: [CoursesService, CourseOfferingService],
})
export class CoursesModule {}
