import { Module } from '@nestjs/common';
import { AuthModule } from '@app/auth';
import { FinanceAuditController } from './audit.controller';
import { FinanceAuditService } from '../common/services/finance-audit.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { PermissionGuard } from '../common/guards/permission.guard';

/**
 * AuditModule — Sprint 0.3
 *
 * Houses the finance bulk-export audit read endpoint + the writer
 * service. The writer is also exported so Sprints F/G's bulk-export
 * workers can inject it without re-importing.
 *
 * Per CLAUDE.md §574-583 module-wiring invariant: providers
 * declared here MUST be reflected in `__tests__/module-wiring.spec.ts`
 * in the same PR. Root FinanceModule does not propagate provider
 * exports transitively.
 */
@Module({
  imports: [AuthModule],
  controllers: [FinanceAuditController],
  providers: [FinanceAuditService, DynamoDBClientService, PermissionGuard],
  exports: [FinanceAuditService],
})
export class FinanceAuditModule {}
