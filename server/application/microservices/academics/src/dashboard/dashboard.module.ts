/**
 * Dashboard Module
 *
 * Aggregated overview endpoint for the Academics dashboard.
 * Combines enrollment summary, active sections count, and
 * today's attendance into a single API call.
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '@app/auth';
import { HttpClientModule } from '@app/http-client';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { DataScopeService } from '../common/services/data-scope.service';
import { PermissionGuard } from '../common/guards/permission.guard';

@Module({
  imports: [AuthModule, HttpClientModule],
  controllers: [DashboardController],
  providers: [
    DashboardService,
    DynamoDBClientService,
    IdentityClientService,
    DataScopeService,
    PermissionGuard,
  ],
  exports: [DashboardService],
})
export class DashboardModule {}
