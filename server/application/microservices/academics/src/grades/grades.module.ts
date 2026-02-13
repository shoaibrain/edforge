/**
 * Grades Module
 *
 * Provides grading functionality: grading policies, grade recording,
 * grade calculation, and GPA computation.
 */

import { Module, forwardRef } from '@nestjs/common';
import { GradingPolicyController } from './grading-policy.controller';
import { GradingPolicyService } from './grading-policy.service';
import { GradesService } from './grades.service';
import { GradesController } from './grades.controller';
import { GpaCalculatorService } from './gpa-calculator.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { HttpClientModule } from '@app/http-client';
import { AuthModule } from '@app/auth';
import { SectionsModule } from '../sections/sections.module';

@Module({
  imports: [
    AuthModule,
    HttpClientModule,
    forwardRef(() => SectionsModule),
  ],
  controllers: [GradingPolicyController, GradesController],
  providers: [
    GradingPolicyService,
    GradesService,
    GpaCalculatorService,
    DynamoDBClientService,
    AcademicsEventsService,
  ],
  exports: [GradingPolicyService, GradesService, GpaCalculatorService],
})
export class GradesModule {}
