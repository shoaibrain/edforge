/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Analytics Service - Main Application Module
 * 
 * ARCHITECTURE:
 * - Read-only analytics service (CQRS read model)
 * - Consumes events from EventBridge
 * - Data Lake: EventBridge → Kinesis Firehose → S3 → Athena
 * - Real-time dashboards via cached queries
 * - No write operations (eventual consistency)
 */

import { Module, Controller, Get } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuthModule } from '@app/auth';
import { ClientFactoryModule } from '@app/client-factory';

@Controller('analytics')
class HealthController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'analytics-service',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      modules: ['analytics']
    };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    ClientFactoryModule,
    AnalyticsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

