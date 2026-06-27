import { Module } from '@nestjs/common';
import { AuthModule } from '@app/auth';
import { HttpClientModule } from '@app/http-client';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { TenantSettingsService } from '../common/services/tenant-settings.service';
import { FinanceAuditService } from '../common/services/finance-audit.service';
import { SequenceService } from '../common/services/sequence.service';
import { FeeStructuresService } from '../fee-structures/fee-structures.service';
import { StudentAccountsService } from '../student-accounts/student-accounts.service';
import { PermissionGuard } from '../common/guards/permission.guard';
import { OverdueDetectionService } from '../common/services/overdue-detection.service';
import { BillingReconciliationService } from '../common/services/billing-reconciliation.service';
import { RecurringBillingService } from '../common/services/recurring-billing.service';

@Module({
  imports: [AuthModule, HttpClientModule],
  controllers: [InvoicesController],
  providers: [
    InvoicesService,
    FeeStructuresService,
    StudentAccountsService,
    SequenceService,
    DynamoDBClientService,
    FinanceEventsService,
    IdentityClientService,
    TenantSettingsService,
    // Pilot Onboarding Hardening PD.1.4 + Phase E hotfix — StudentAccountsService
    // (locally provided here, not imported via StudentAccountsModule) injects
    // FinanceAuditService at constructor index [2]. Without this provider
    // declaration the InvoicesModule context cannot construct
    // StudentAccountsService, and Nest bootstrap dies with:
    //   "Nest can't resolve dependencies of the StudentAccountsService
    //    (DynamoDBClientService, IdentityClientService, ?). Please make
    //    sure that the argument FinanceAuditService at index [2] is
    //    available in the InvoicesModule context."
    // Module-wiring invariant fix: this module locally provides
    // StudentAccountsService instead of importing StudentAccountsModule,
    // so it must also locally provide every constructor dep that
    // StudentAccountsService injects. CLAUDE.md memory
    // `feedback_module_wiring_invariant` is the exact pattern.
    FinanceAuditService,
    PermissionGuard,
    OverdueDetectionService,
    BillingReconciliationService,
    RecurringBillingService,
  ],
  exports: [InvoicesService],
})
export class InvoicesModule {}
