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
    PermissionGuard,
    PaymentSweepService,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
