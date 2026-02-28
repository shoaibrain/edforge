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
  ],
  providers: [DynamoDBClientService, IdentityClientService, FinanceEventsService],
  exports: [DynamoDBClientService, IdentityClientService, FinanceEventsService],
})
export class FinanceModule {}
