import { Module } from '@nestjs/common';
import { AuthModule } from '@app/auth';
import { HttpClientModule } from '@app/http-client';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { TenantSettingsService } from '../common/services/tenant-settings.service';
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
    PermissionGuard,
    OverdueDetectionService,
    BillingReconciliationService,
    RecurringBillingService,
  ],
  exports: [InvoicesService],
})
export class InvoicesModule {}
