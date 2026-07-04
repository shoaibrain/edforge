import { Module } from '@nestjs/common';
import { AuthModule } from '@app/auth';
import { HttpClientModule } from '@app/http-client';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentGatewaysModule } from '../payment-gateways/payment-gateways.module';
import { BulkOperationsModule } from '../bulk-ops/bulk-ops.module';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { TenantSettingsService } from '../common/services/tenant-settings.service';
import { FinanceAuditService } from '../common/services/finance-audit.service';
import { SequenceService } from '../common/services/sequence.service';
import { FinanceMetricsService } from '../common/services/finance-metrics.service';
import { InvoicesService } from '../invoices/invoices.service';
import { StudentAccountsService } from '../student-accounts/student-accounts.service';
import { FeeStructuresService } from '../fee-structures/fee-structures.service';
import { AgreementResolverService } from '../agreements/agreement-resolver.service';
import { PermissionGuard } from '../common/guards/permission.guard';
import { PaymentSweepService } from '../common/services/payment-sweep.service';
import { PdfLogoOptimizerService } from '../common/services/pdf-logo-optimizer.service';

@Module({
  // Sprint G.3 — import BulkOperationsModule so PaymentsController can
  // inject FinanceJobsService + BulkReceiptPdfExportWorker for the new
  // bulk-pdf-export/payments endpoint. Both are exported by
  // BulkOperationsModule; keeping the receipt endpoint next to the
  // single-receipt endpoint (in PaymentsController) rather than moving
  // to BulkOpsController mirrors the F.4 invoice-side layout where
  // bulkPdfExport lives in InvoicesController.
  imports: [AuthModule, HttpClientModule, PaymentGatewaysModule, BulkOperationsModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    InvoicesService,
    // EPIC-FB FB-3.3 — ctor dep of the locally-provided InvoicesService
    // (agreement generation hook). Pinned by module-wiring.spec.ts.
    AgreementResolverService,
    StudentAccountsService,
    FeeStructuresService,
    SequenceService,
    FinanceMetricsService,
    DynamoDBClientService,
    FinanceEventsService,
    IdentityClientService,
    TenantSettingsService,
    // Pilot Onboarding Hardening PD.1.4 + Phase E hotfix — same pattern
    // as InvoicesModule above. PaymentsModule locally provides
    // StudentAccountsService, which now injects FinanceAuditService at
    // constructor index [2]. Required to satisfy Nest DI; without this
    // the finance container crash-loops on Nest bootstrap.
    FinanceAuditService,
    PermissionGuard,
    PaymentSweepService,
    // Plan §5d — PdfLogoOptimizerService is injected by
    // PaymentsService.getReceiptPdf. Also injected by both bulk workers
    // (provided in bulk-ops.module.ts). Providing it here too keeps the
    // module-DI graph correct without an import cycle.
    PdfLogoOptimizerService,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
