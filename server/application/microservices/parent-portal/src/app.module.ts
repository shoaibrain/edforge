/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Parent Portal Service - Main Application Module
 * 
 * ARCHITECTURE:
 * - Parent Engagement bounded context
 * - Shared DynamoDB table with School Service
 * - JWT-based authentication
 * - Tenant isolation via partition key
 */

import { Module, Controller, Get } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ParentModule } from './parent/parent.module';
import { DynamoDBClientService } from './common/dynamodb-client.service';
import { AuthModule } from '@app/auth';
import { ClientFactoryModule } from '@app/client-factory';

@Controller('parents')
class HealthController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'parent-portal-service',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      modules: ['parent']
    };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    ClientFactoryModule,
    ParentModule,
  ],
  controllers: [HealthController],
  providers: [DynamoDBClientService],
  exports: [DynamoDBClientService],
})
export class AppModule {}

