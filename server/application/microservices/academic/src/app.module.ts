/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Academic Service - Main Application Module
 * 
 * ARCHITECTURE:
 * - 4 independent modules: Classroom, Assignment, Grading, Attendance
 * - Shared DynamoDB table with School Service
 * - JWT-based authentication
 * - Tenant isolation via partition key
 */

import { Module, Controller, Get } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClassroomModule } from './classroom/classroom.module';
import { AssignmentModule } from './assignment/assignment.module';
import { GradingModule } from './grading/grading.module';
import { AttendanceModule } from './attendance/attendance.module';
import { StreamModule } from './stream/stream.module';

@Controller('academic')
class HealthController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'academic-service',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      modules: ['classroom', 'assignment', 'grading', 'attendance', 'stream']
    };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ClassroomModule,
    AssignmentModule,
    GradingModule,
    AttendanceModule,
    StreamModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

