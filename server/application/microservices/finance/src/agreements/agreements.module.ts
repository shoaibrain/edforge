/**
 * AgreementsModule — EPIC-FB Sprint FB-2.6
 *
 * **Module-wiring discipline (per [[feedback_module_wiring_invariant]]):**
 * every common service consumed here is declared LOCALLY (root-module
 * exports do NOT propagate), and this module is registered in
 * `__tests__/module-wiring.spec.ts` in the SAME PR.
 *
 * FeeStructuresService is provided locally (same conservative shape as
 * InvoicesModule/PaymentsModule providing StudentAccountsService) — the
 * activation open-invoice conflict check resolves un-stamped line-item fee
 * types via `getByIds`. Its full ctor dep set (DynamoDBClientService,
 * FinanceEventsService, IdentityClientService) is already declared below;
 * the wiring spec pins that invariant.
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '@app/auth';
import { HttpClientModule } from '@app/http-client';
import { AgreementsController, StudentAgreementsController } from './agreements.controller';
import { AgreementsService } from './agreements.service';
import { AgreementResolverService } from './agreement-resolver.service';
import { BillingAgreementsFlagGuard } from './billing-agreements-flag.guard';
import { FeeStructuresService } from '../fee-structures/fee-structures.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { PermissionGuard } from '../common/guards/permission.guard';

@Module({
  imports: [AuthModule, HttpClientModule],
  controllers: [AgreementsController, StudentAgreementsController],
  providers: [
    AgreementsService,
    AgreementResolverService,
    BillingAgreementsFlagGuard,
    FeeStructuresService,
    DynamoDBClientService,
    FinanceEventsService,
    // PermissionGuard injects IdentityClientService — must be declared here
    // (not inherited from root). See module-wiring.spec.ts.
    IdentityClientService,
    PermissionGuard,
  ],
  // AgreementResolverService is exported for Package E (FB-3.3/3.7/3.8 —
  // generation paths); AgreementsService for any future cross-module reads.
  exports: [AgreementsService, AgreementResolverService],
})
export class AgreementsModule {}
