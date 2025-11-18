/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Attendance Service - Main Application Module
 * 
 * ARCHITECTURE:
 * - Attendance Management bounded context
 * - Shared DynamoDB table with School Service
 * - JWT-based authentication
 * - Tenant isolation via partition key
 */

import { Module, Controller, Get } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AttendanceModule } from './attendance/attendance.module';
import { DynamoDBClientService } from './common/dynamodb-client.service';
import { AuthModule } from '@app/auth';
import { ClientFactoryModule } from '@app/client-factory';

@Controller('attendance')
class HealthController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'attendance-service',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      modules: ['attendance']
    };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    ClientFactoryModule,
    AttendanceModule,
  ],
  controllers: [HealthController],
  providers: [DynamoDBClientService],
  exports: [DynamoDBClientService],
})
export class AppModule {}

