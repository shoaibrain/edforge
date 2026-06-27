import { Module } from '@nestjs/common';
import { AuthModule } from '@app/auth';
import { HttpClientModule } from '@app/http-client';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentGatewaysModule } from '../payment-gateways/payment-gateways.module';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { TenantSettingsService } from '../common/services/tenant-settings.service';
import { FinanceAuditService } from '../common/services/finance-audit.service';
import { SequenceService } from '../common/services/sequence.service';
import { InvoicesService } from '../invoices/invoices.service';
import { StudentAccountsService } from '../student-accounts/student-accounts.service';
import { FeeStructuresService } from '../fee-structures/fee-structures.service';
import { PermissionGuard } from '../common/guards/permission.guard';
import { PaymentSweepService } from '../common/services/payment-sweep.service';

@Module({
  imports: [AuthModule, HttpClientModule, PaymentGatewaysModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    InvoicesService,
    StudentAccountsService,
    FeeStructuresService,
    SequenceService,
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
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
