/**
 * Enrollment Webhook Module
 *
 * Handles enrollment lifecycle events for billing integration.
 */

import { Module } from '@nestjs/common';
import { HttpClientModule } from '@app/http-client';
import { EnrollmentWebhookController } from './enrollment-webhook.controller';
import { EnrollmentBillingService } from './enrollment-billing.service';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';
import { StudentAccountsModule } from '../student-accounts/student-accounts.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { FeeStructuresModule } from '../fee-structures/fee-structures.module';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { ProRateService } from '../common/services/pro-rate.service';

@Module({
  imports: [
    HttpClientModule,
    StudentAccountsModule,
    InvoicesModule,
    FeeStructuresModule,
  ],
  controllers: [EnrollmentWebhookController],
  providers: [
    EnrollmentBillingService,
    ProRateService,
    InternalApiKeyGuard,
    DynamoDBClientService,
    FinanceEventsService,
    IdentityClientService,
  ],
})
export class EnrollmentWebhookModule {}
