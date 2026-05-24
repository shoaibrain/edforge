/**
 * PromotionRulesModule — Sprint D.2.1 + D.2.2 + D.2.3
 *
 * **Module-wiring discipline (per [[feedback_module_wiring_invariant]]):**
 * Every academics module that uses `PermissionGuard` MUST also declare
 * `IdentityClientService` in providers (root-module exports do NOT
 * propagate). The academics module-wiring spec
 * (`__tests__/module-wiring.spec.ts`) is extended in the SAME PR to
 * register this module — closes the trap that bit A.4 PR #161.
 */

import { Module } from '@nestjs/common';
import { PromotionRulesController } from './promotion-rules.controller';
import { PromotionRulesService } from './promotion-rules.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { PermissionGuard } from '../common/guards/permission.guard';
import { DataScopeService } from '../common/services/data-scope.service';
import { HttpClientModule } from '@app/http-client';
import { AuthModule } from '@app/auth';

@Module({
  imports: [AuthModule, HttpClientModule],
  controllers: [PromotionRulesController],
  providers: [
    PromotionRulesService,
    DynamoDBClientService,
    AcademicsEventsService,
    // PermissionGuard injects IdentityClientService — must be declared here
    // (not inherited from root). See module-wiring.spec.ts.
    IdentityClientService,
    PermissionGuard,
    DataScopeService,
  ],
  exports: [PromotionRulesService],
})
export class PromotionRulesModule {}
