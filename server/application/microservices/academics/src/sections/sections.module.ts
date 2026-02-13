/**
 * Sections Module
 *
 * Provides course section management functionality.
 * Depends on Identity service for school and staff validation.
 */

import { Module } from '@nestjs/common';
import { SectionsController } from './sections.controller';
import { SectionsService } from './sections.service';
import { SectionEnrollmentService } from './section-enrollment.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { HttpClientModule } from '@app/http-client';
import { AuthModule } from '@app/auth';

@Module({
  imports: [AuthModule, HttpClientModule],
  controllers: [SectionsController],
  providers: [
    SectionsService,
    SectionEnrollmentService,
    DynamoDBClientService,
    AcademicsEventsService,
    IdentityClientService,
  ],
  exports: [SectionsService, SectionEnrollmentService],
})
export class SectionsModule {}
