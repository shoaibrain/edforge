/**
 * Finance Service Root Module
 *
 * Financial domain service: fee structures, invoicing, payments,
 * student billing accounts, payment gateway configuration, receipts.
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpClientModule } from '@app/http-client';
import { HealthModule } from '@app/health';
import { DynamoDBClientService } from './common/services/dynamodb-client.service';
import { IdentityClientService } from './common/services/identity-client.service';
import { FinanceEventsService } from './common/services/finance-events.service';
import { FeeStructuresModule } from './fee-structures/fee-structures.module';
import { StudentAccountsModule } from './student-accounts/student-accounts.module';
import { InvoicesModule } from './invoices/invoices.module';
import { PaymentsModule } from './payments/payments.module';
import { PaymentGatewaysModule } from './payment-gateways/payment-gateways.module';
import { EnrollmentWebhookModule } from './webhooks/enrollment-webhook.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DiscountRulesModule } from './discount-rules/discount-rules.module';
import { CreditNotesModule } from './credit-notes/credit-notes.module';
import { RefundsModule } from './refunds/refunds.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    HealthModule,
    HttpClientModule,
    FeeStructuresModule,
    StudentAccountsModule,
    InvoicesModule,
    PaymentsModule,
    PaymentGatewaysModule,
    EnrollmentWebhookModule,
    DashboardModule,
    DiscountRulesModule,
    CreditNotesModule,
    RefundsModule,
  ],
  providers: [DynamoDBClientService, IdentityClientService, FinanceEventsService],
  exports: [DynamoDBClientService, IdentityClientService, FinanceEventsService],
})
export class FinanceModule {}
