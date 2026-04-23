/**
 * IEMIS Module (Sprint 1)
 *
 * Tenant-wide compliance endpoints for Nepal IEMIS integration.
 * Controllers gated by `@RequireIemisPermission()` + `IemisPermissionGuard`.
 */

import { Module } from '@nestjs/common';
import { IemisController } from './iemis.controller';
import { IemisAuditLogger } from '../common/services/iemis-audit-logger.service';
import { IemisPermissionGuard } from '../common/guards/iemis-permission.guard';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AuthModule } from '@app/auth';

@Module({
  imports: [AuthModule],
  controllers: [IemisController],
  providers: [IemisAuditLogger, IemisPermissionGuard, DynamoDBClientService],
  exports: [IemisAuditLogger],
})
export class IemisModule {}
