/**
 * BulkOperationsModule — Sprint D.4
 *
 * Houses the async bulk-ops job framework:
 *   - `BulkOpsController` — GET /finance/jobs/:jobId (Sprint D.3)
 *   - `FinanceJobsService` — entity owner + lifecycle transitions
 *
 * Sprint E will add the resolver service + per-school semaphore + the
 * BulkInvoiceGenerateWorker (async POST /invoices/bulk-generate path);
 * Sprints F + G add the PDF-export workers. This module is the framework
 * foundation only — no worker yet.
 *
 * Per CLAUDE.md memory `feedback_module_wiring_invariant`: every NestJS
 * module that consumes shared services MUST (a) declare those providers
 * in its OWN module + (b) be registered in
 * `__tests__/module-wiring.spec.ts` in the SAME PR. The wiring spec is
 * the only static gate that catches a missing local provider — `nest
 * build` passes when DI is broken, and ECS `services-stable` returns
 * HEALTHY even when the container crash-loops on Nest bootstrap.
 *
 * Provider list rationale:
 *   - FinanceJobsService     — owned by this module; the entity-lifecycle
 *                              service for FinanceJob rows.
 *   - FinanceAuditService    — injected by FinanceJobsService for
 *                              transition audit emissions; declared
 *                              locally so Nest can resolve it in this
 *                              module's context. (Root-module exports
 *                              don't propagate — CLAUDE.md §574-583.)
 *   - DynamoDBClientService  — backs both services above.
 *   - IdentityClientService  — injected by BulkOpsController for the
 *                              school-scope check (the 404-not-403
 *                              gate). NOT injected by PermissionGuard
 *                              here because this module's only route
 *                              uses JwtAuthGuard + manual scope check
 *                              instead of PermissionGuard (see
 *                              bulk-ops.controller.ts for the rationale).
 *
 * No PermissionGuard in the provider list — same reason: the GET
 * endpoint deliberately doesn't go through PermissionGuard because
 * PermissionGuard requires a request-scope schoolId, and we want the
 * jobId to be the only URL parameter so it's not enumerable across
 * schools.
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '@app/auth';
import { BulkOpsController } from './bulk-ops.controller';
import { FinanceJobsService } from './finance-jobs.service';
import { FinanceAuditService } from '../common/services/finance-audit.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityClientService } from '../common/services/identity-client.service';

@Module({
  imports: [AuthModule],
  controllers: [BulkOpsController],
  providers: [
    FinanceJobsService,
    FinanceAuditService,
    DynamoDBClientService,
    IdentityClientService,
  ],
  exports: [FinanceJobsService],
})
export class BulkOperationsModule {}
