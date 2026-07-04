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
import { FinanceMetricsService } from '../common/services/finance-metrics.service';
import { FeeStructuresService } from '../fee-structures/fee-structures.service';
import { StudentAccountsService } from '../student-accounts/student-accounts.service';
import { PermissionGuard } from '../common/guards/permission.guard';
import { OverdueDetectionService } from '../common/services/overdue-detection.service';
import { BillingReconciliationService } from '../common/services/billing-reconciliation.service';
import { RecurringBillingService } from '../common/services/recurring-billing.service';
import { PdfLogoOptimizerService } from '../common/services/pdf-logo-optimizer.service';
import { AgreementResolverService } from '../agreements/agreement-resolver.service';
import { BulkOperationsModule } from '../bulk-ops/bulk-ops.module';

@Module({
  // Sprint E.3 — InvoicesController injects FinanceJobsService +
  // BulkInvoiceGenerateWorker for the async branch on POST /bulk-generate.
  // BulkOperationsModule exports both so a single import covers it.
  imports: [AuthModule, HttpClientModule, BulkOperationsModule],
  controllers: [InvoicesController],
  providers: [
    InvoicesService,
    FeeStructuresService,
    StudentAccountsService,
    SequenceService,
    FinanceMetricsService,
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
    // EPIC-FB FB-3.3 — InvoicesService injects AgreementResolverService
    // (trailing ctor param) for the settled-semantics generation hook.
    // Locally provided (its only dep, DynamoDBClientService, already is);
    // module-wiring.spec.ts pins this for every module that locally
    // provides InvoicesService.
    AgreementResolverService,
    PermissionGuard,
    OverdueDetectionService,
    BillingReconciliationService,
    RecurringBillingService,
    // Plan §5d — PdfLogoOptimizerService is injected by InvoicesService.getPdf.
    PdfLogoOptimizerService,
  ],
  exports: [InvoicesService],
})
export class InvoicesModule {}
