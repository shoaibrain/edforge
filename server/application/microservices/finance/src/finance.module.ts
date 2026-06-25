/**
 * Finance Service Root Module
 *
 * Financial domain service: fee structures, invoicing, payments,
 * student billing accounts, payment gateway configuration, receipts.
 */

import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { HttpClientModule } from '@app/http-client';
import { HealthModule } from '@app/health';
import { AnalyticsEventsModule, FeatureUsageInterceptor } from '@app/analytics-events';
import { DynamoDBClientService } from './common/services/dynamodb-client.service';
import { IdentityClientService } from './common/services/identity-client.service';
import { TenantSettingsService } from './common/services/tenant-settings.service';
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
import { FinanceAuditModule } from './audit/audit.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    AnalyticsEventsModule, // C0b — global FeatureUsage emit on non-GET requests
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
    FinanceAuditModule,
  ],
  providers: [
    DynamoDBClientService,
    IdentityClientService,
    TenantSettingsService,
    FinanceEventsService,
    // C0b (2026-04-16) — register the FeatureUsage interceptor so non-GET
    // finance actions (POST /payments/initiate, POST /invoices, PATCH /fee-
    // structures, etc.) emit `feature.usage` events tagged with the caller's
    // role. This is the primary signal source for parentPortalReach since the
    // parent portal's writes are all fee-payment flows on this service.
    { provide: APP_INTERCEPTOR, useClass: FeatureUsageInterceptor },
  ],
  exports: [DynamoDBClientService, IdentityClientService, TenantSettingsService, FinanceEventsService],
})
export class FinanceModule {}
