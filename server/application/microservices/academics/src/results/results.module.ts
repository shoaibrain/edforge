/**
 * Results Module — Sprint A.4
 *
 * Provides per-student per-term ResultCard subsystem:
 *   - Term-aggregation pure function (A.4.1) — consumed by the
 *     result-batch Lambda (Phase 3) and the cross-year regression spec.
 *   - ResultCardsService — operator-facing CRUD + publish state machine.
 *   - ResultCardsController — REST endpoints.
 *
 * **Depends on:**
 *   - DDB single-table client (academics partition)
 *   - AcademicsEventsService (event emission incl. `result.published`)
 *
 * **Does NOT depend on:**
 *   - IdentityClientService (ResultCards are pure-academics; no school
 *     re-validation needed — Lambda generation already validated)
 *   - TenantMetadataReader (archetype-blind per invariant 12)
 *
 * Memory `feedback_module_wiring_invariant`: this module MUST be
 * imported in `academics.module.ts` for DI to wire. Post-deploy ECS log
 * sanity (look for `ResultsModule dependencies initialized`) is the
 * gate per R-A4.3 since academics has no module-wiring.spec.ts yet
 * (Sprint 0.3 scope).
 *
 * @see docs/pilot-greenlight/a4-sprint-plan.md §3 Phase 2
 */

import { Module } from '@nestjs/common';
import { HttpClientModule } from '@app/http-client';
import { AuthModule } from '@app/auth';
import { ResultCardsController } from './result-cards.controller';
import { ResultCardsService } from './result-cards.service';
import { TermAggregationService } from './term-aggregation.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { PermissionGuard } from '../common/guards/permission.guard';

@Module({
  imports: [AuthModule, HttpClientModule],
  controllers: [ResultCardsController],
  providers: [
    ResultCardsService,
    TermAggregationService,
    DynamoDBClientService,
    AcademicsEventsService,
    PermissionGuard,
  ],
  exports: [ResultCardsService, TermAggregationService],
})
export class ResultsModule {}
