/**
 * Academics Service Root Module
 * 
 * Consolidated academic domain service providing:
 * - Student management
 * - Enrollment lifecycle
 * - Attendance tracking
 * - Grades and assessments
 * - Curriculum and scheduling (future)
 */

import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { HttpClientModule } from '@app/http-client';
import { HealthModule } from '@app/health';
import { AnalyticsEventsModule, FeatureUsageInterceptor } from '@app/analytics-events';
import { StudentsModule } from './students/students.module';
import { EnrollmentModule } from './enrollment/enrollment.module';
import { AttendanceModule } from './attendance/attendance.module';
import { CoursesModule } from './courses/courses.module';
import { SectionsModule } from './sections/sections.module';
import { GradesModule } from './grades/grades.module';
import { ClassworkModule } from './classwork/classwork.module';
import { SectionAttendanceModule } from './section-attendance/section-attendance.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ExamsModule } from './exams/exams.module';
import { ResultsModule } from './results/results.module';
import { DynamoDBClientService } from './common/services/dynamodb-client.service';
import { IdentityClientService } from './common/services/identity-client.service';
import { AcademicsEventsService } from './common/services/academics-events.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    AnalyticsEventsModule, // C0b — global FeatureUsage emit on non-GET requests
    HealthModule,
    HttpClientModule,
    StudentsModule,
    EnrollmentModule,
    AttendanceModule,
    CoursesModule,
    SectionsModule,
    GradesModule,
    ClassworkModule,
    SectionAttendanceModule,
    DashboardModule,
    ExamsModule,
    ResultsModule,
  ],
  providers: [
    DynamoDBClientService,
    IdentityClientService,
    AcademicsEventsService,
    // C0b (2026-04-16) — register the FeatureUsage interceptor so non-GET
    // academic actions (POST /students, POST /attendance/bulk, PATCH /grades,
    // etc.) emit `feature.usage` events tagged with the caller's role. Until
    // now this fired only on identity routes, so parent/student writes here
    // were invisible to adoption metrics.
    { provide: APP_INTERCEPTOR, useClass: FeatureUsageInterceptor },
  ],
  exports: [DynamoDBClientService, IdentityClientService, AcademicsEventsService],
})
export class AcademicsModule {}

