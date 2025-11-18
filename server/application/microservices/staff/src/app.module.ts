/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Staff Service - Main Application Module
 * 
 * ARCHITECTURE:
 * - Staff Management bounded context
 * - Shared DynamoDB table with School Service
 * - JWT-based authentication
 * - Tenant isolation via partition key
 */

import { Module, Controller, Get } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StaffModule } from './staff/staff.module';
import { DynamoDBClientService } from './common/dynamodb-client.service';
import { AuthModule } from '@app/auth';
import { ClientFactoryModule } from '@app/client-factory';

@Controller('staff')
class HealthController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'staff-service',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      modules: ['staff']
    };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    ClientFactoryModule,
    StaffModule,
  ],
  controllers: [HealthController],
  providers: [DynamoDBClientService],
  exports: [DynamoDBClientService],
})
export class AppModule {}

