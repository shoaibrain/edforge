/**
 * Exams Module — Sprint A.3
 *
 * Provides term-end exam subsystem (Exam + ExamCourse + ExamScore) with
 * state machine + bulk score handling. Depends on:
 *   - Identity service (school validation via IdentityClientService)
 *   - TenantMetadataReader (archetype lookup for examType narrowing)
 *   - DDB single-table client (academics partition)
 *   - AcademicsEventsService (event emission)
 *
 * @see docs/pilot-greenlight/a3-sprint-plan.md §3 Phase 2
 */

import { Module } from '@nestjs/common';
import { HttpClientModule } from '@app/http-client';
import { AuthModule } from '@app/auth';
import { ExamsController } from './exams.controller';
import { ExamCoursesController } from './exam-courses.controller';
import { ExamScoresController } from './exam-scores.controller';
import { ExamsService } from './exams.service';
import { ExamCoursesService } from './exam-courses.service';
import { ExamScoresService } from './exam-scores.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { TenantMetadataReaderService } from '../common/services/tenant-metadata-reader.service';
import { PermissionGuard } from '../common/guards/permission.guard';

@Module({
  imports: [AuthModule, HttpClientModule],
  controllers: [ExamsController, ExamCoursesController, ExamScoresController],
  providers: [
    ExamsService,
    ExamCoursesService,
    ExamScoresService,
    DynamoDBClientService,
    AcademicsEventsService,
    IdentityClientService,
    TenantMetadataReaderService,
    PermissionGuard,
  ],
  exports: [ExamsService, ExamCoursesService, ExamScoresService],
})
export class ExamsModule {}
