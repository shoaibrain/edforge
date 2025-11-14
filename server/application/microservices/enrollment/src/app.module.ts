/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Enrollment Service - Main Application Module
 * 
 * ARCHITECTURE:
 * - Single microservice handling: Students, Enrollments, Staff, Parents, Finance
 * - Shared DynamoDB table with School and Academic Services
 * - JWT-based authentication
 * - Tenant isolation via partition key
 */

import { Module, Controller, Get } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StudentModule } from './student/student.module';
import { EnrollmentModule } from './enrollment/enrollment.module';
import { StaffModule } from './staff/staff.module';
import { ParentModule } from './parent/parent.module';
import { FinanceModule } from './finance/finance.module';
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
      modules: ['student', 'enrollment', 'staff', 'parent', 'finance']
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
    StaffModule,
    ParentModule,
    FinanceModule,
  ],
  controllers: [HealthController],
  providers: [DynamoDBClientService],
  exports: [DynamoDBClientService],
})
export class AppModule {}

