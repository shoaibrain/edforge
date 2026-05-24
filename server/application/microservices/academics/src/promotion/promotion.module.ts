/**
 * PromotionModule — Sprint D.2.4 (Phase 2 ship)
 *
 * Wraps the D.2.4 pure-function evaluator behind a Nest provider so D.2.5
 * (batch evaluation endpoint, Phase 3) can inject it. Intentionally
 * minimal in Phase 2 — D.2.5 + D.2.6 + D.2.9 + D.2.10 + D.2.11 land in
 * Phase 3 and expand this module's surface.
 *
 * **Module-wiring discipline:** PromotionEvaluatorService is pure (no DDB,
 * no events). This module therefore does NOT need PermissionGuard /
 * DynamoDBClientService / IdentityClientService — those land in Phase 3
 * with the batch + commit + handler services. The Phase 2 module-wiring
 * spec entry for PromotionModule reflects this minimal shape.
 */

import { Module } from '@nestjs/common';
import { PromotionEvaluatorService } from './promotion-evaluator.service';

@Module({
  providers: [PromotionEvaluatorService],
  exports: [PromotionEvaluatorService],
})
export class PromotionModule {}
