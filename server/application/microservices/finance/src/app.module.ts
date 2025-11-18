/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Finance Service - Main Application Module
 * 
 * ARCHITECTURE:
 * - Finance & Billing bounded context
 * - Dedicated DynamoDB table (PCI compliance)
 * - JWT-based authentication
 * - Tenant isolation via partition key
 */

import { Module, Controller, Get } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FinanceModule } from './finance/finance.module';
import { DynamoDBClientService } from './common/dynamodb-client.service';
import { AuthModule } from '@app/auth';
import { ClientFactoryModule } from '@app/client-factory';

@Controller('finance')
class HealthController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'finance-service',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      modules: ['finance']
    };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    ClientFactoryModule,
    FinanceModule,
  ],
  controllers: [HealthController],
  providers: [DynamoDBClientService],
  exports: [DynamoDBClientService],
})
export class AppModule {}

