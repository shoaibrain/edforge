import { Module } from '@nestjs/common';
import { AuthModule } from '@app/auth';
import { FinanceAuditController } from './audit.controller';
import { FinanceAuditService } from '../common/services/finance-audit.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { PermissionGuard } from '../common/guards/permission.guard';

/**
 * AuditModule — Sprint 0.3
 *
 * Houses the finance bulk-export audit read endpoint + the writer
 * service. The writer is also exported so Sprints F/G's bulk-export
 * workers can inject it without re-importing.
 *
 * Per CLAUDE.md memory `feedback_module_wiring_invariant`: providers
 * declared here MUST be reflected in `__tests__/module-wiring.spec.ts`
 * in the same PR. Root FinanceModule does not propagate provider
 * exports transitively.
 *
 * Phase E hotfix (2026-06-27 PD.2 prod rolling deploy incident #2):
 * `IdentityClientService` is added because `PermissionGuard`'s
 * constructor injects it. Pre-fix the module provided
 * `[FinanceAuditService, DynamoDBClientService, PermissionGuard]`
 * but Nest could not instantiate PermissionGuard inside
 * FinanceAuditModule's context because IdentityClientService wasn't
 * locally provided. Same exact bug class as the InvoicesModule +
 * PaymentsModule fix in the same commit chain.
 *
 * Why this didn't crash on the Sprint 0.3 deploy: unclear; suspected
 * Nest provider-resolution ordering interaction with sibling-module
 * provider duplication. Reliable repro now: the post-PD finance
 * container crash-loops on bootstrap until this dep is declared.
 */
@Module({
  imports: [AuthModule],
  controllers: [FinanceAuditController],
  providers: [FinanceAuditService, DynamoDBClientService, IdentityClientService, PermissionGuard],
  exports: [FinanceAuditService],
})
export class FinanceAuditModule {}
