/**
 * Courses Module
 *
 * Provides course catalog management functionality.
 * Depends on Identity service for school validation.
 */

import { Module } from '@nestjs/common';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { HttpClientModule } from '@app/http-client';
import { AuthModule } from '@app/auth';

@Module({
  imports: [AuthModule, HttpClientModule],
  controllers: [CoursesController],
  providers: [
    CoursesService,
    DynamoDBClientService,
    AcademicsEventsService,
    IdentityClientService,
  ],
  exports: [CoursesService],
})
export class CoursesModule {}
