/**
 * PromotionModule — Sprint D.2 (Phase 2 + Phase 3)
 *
 * Phase 2 shipped the D.2.4 pure-function evaluator behind a thin Nest
 * wrapper. Phase 3 adds:
 *   - D.2.5 batch evaluation service (operator-review path)
 *   - D.2.6 cross-year commit service (chunked TransactWriteItems)
 *   - PromotionBatchController exposing both endpoints
 *
 * **Module-wiring (per [[feedback-module-wiring-invariant]]):**
 * PromotionBatchController uses PermissionGuard, so this module must
 * also declare `IdentityClientService` (the guard's dep) in providers.
 * Root-module exports do NOT propagate to child modules.
 *
 * The Phase 3 services also depend on:
 *   - PromotionRulesService (already declared in PromotionRulesModule;
 *     forward-import so the DI graph resolves)
 *   - AttendanceService (for D.2.5 attendance scoring — forward-import)
 *
 * @see docs/pilot-greenlight/d2-sprint-plan.md §4 D.2.4 + D.2.5 + D.2.6
 */

import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '@app/auth';
import { HttpClientModule } from '@app/http-client';
import { PromotionEvaluatorService } from './promotion-evaluator.service';
import { PromotionBatchService } from './promotion-batch.service';
import { PromotionCommitService } from './promotion-commit.service';
import { PromotionBatchController } from './promotion-batch.controller';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { PermissionGuard } from '../common/guards/permission.guard';
import { DataScopeService } from '../common/services/data-scope.service';
import { PromotionRulesModule } from '../promotion-rules/promotion-rules.module';
import { AttendanceModule } from '../attendance/attendance.module';

@Module({
  imports: [
    AuthModule,
    HttpClientModule,
    forwardRef(() => PromotionRulesModule),
    forwardRef(() => AttendanceModule),
  ],
  controllers: [PromotionBatchController],
  providers: [
    PromotionEvaluatorService,
    PromotionBatchService,
    PromotionCommitService,
    DynamoDBClientService,
    AcademicsEventsService,
    // PermissionGuard injects IdentityClientService; both required.
    IdentityClientService,
    PermissionGuard,
    DataScopeService,
  ],
  exports: [PromotionEvaluatorService, PromotionBatchService, PromotionCommitService],
})
export class PromotionModule {}
