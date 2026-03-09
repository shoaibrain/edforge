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
import { ConfigModule } from '@nestjs/config';
import { HttpClientModule } from '@app/http-client';
import { HealthModule } from '@app/health';
import { StudentsModule } from './students/students.module';
import { EnrollmentModule } from './enrollment/enrollment.module';
import { AttendanceModule } from './attendance/attendance.module';
import { CoursesModule } from './courses/courses.module';
import { SectionsModule } from './sections/sections.module';
import { GradesModule } from './grades/grades.module';
import { ClassworkModule } from './classwork/classwork.module';
import { SectionAttendanceModule } from './section-attendance/section-attendance.module';
import { DynamoDBClientService } from './common/services/dynamodb-client.service';
import { IdentityClientService } from './common/services/identity-client.service';
import { AcademicsEventsService } from './common/services/academics-events.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
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
  ],
  providers: [DynamoDBClientService, IdentityClientService, AcademicsEventsService],
  exports: [DynamoDBClientService, IdentityClientService, AcademicsEventsService],
})
export class AcademicsModule {}

