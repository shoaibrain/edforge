/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Enrollment Service - Main Application Module
 * 
 * ARCHITECTURE:
 * - Single microservice handling: Students, Enrollments
 * - Shared DynamoDB table with School and Academic Services
 * - JWT-based authentication
 * - Tenant isolation via partition key
 * 
 * NOTE: 
 * - Staff management has been moved to staff-service
 * - Parent management has been moved to parent-portal-service
 * - Finance operations should be called via finance-service HTTP API (TODO: Phase 4)
 */

import { Module, Controller, Get } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StudentModule } from './student/student.module';
import { EnrollmentModule } from './enrollment/enrollment.module';
import { DynamoDBClientService } from './common/dynamodb-client.service';
import { AuthModule } from '@app/auth';
import { ClientFactoryModule } from '@app/client-factory';

@Controller('enrollment')
class HealthController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'enrollment-service',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      modules: ['student', 'enrollment']
    };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    ClientFactoryModule,
    StudentModule,
    EnrollmentModule,
  ],
  controllers: [HealthController],
  providers: [DynamoDBClientService],
  exports: [DynamoDBClientService],
})
export class AppModule {}

