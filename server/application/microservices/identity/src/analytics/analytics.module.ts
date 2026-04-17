/**
 * Layer 7 — AnalyticsModule
 *
 * Wires the read-path controller and service into the identity service.
 * Uses the existing @app/auth JwtAuthGuard + TenantCredentials plumbing.
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '@app/auth';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';

@Module({
  imports: [AuthModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, DynamoDBClientService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
