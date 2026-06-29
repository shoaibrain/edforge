/**
 * BulkOperationsModule — Sprint D.4 + Sprint E.4 update
 *
 * Houses the async bulk-ops job framework:
 *   - `BulkOpsController` — GET /finance/jobs/:jobId (Sprint D.3)
 *   - `FinanceJobsService` — entity owner + lifecycle transitions
 *   - `BulkInvoiceGenerateWorker` — Sprint E.4 worker for async POST
 *     /invoices/bulk-generate (>25 students or `?async=true`). Exported
 *     so the invoices controller can inject it for the setImmediate
 *     handoff after returning 202.
 *   - `PerSchoolLock` — Sprint E.2 in-memory per-school semaphore. ECS-
 *     task-scoped singleton (Nest default); two jobs for the same
 *     schoolId serialize through it.
 *
 * Sprint F + G will add the PDF-export workers; this module stays the
 * canonical home for all bulk-ops infrastructure.
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
 *   - FinanceJobsService     — owned by this module; entity lifecycle.
 *   - FinanceAuditService    — injected by FinanceJobsService AND by
 *                              BulkInvoiceGenerateWorker for transition
 *                              audit emissions.
 *   - DynamoDBClientService  — backs every DDB call in this module.
 *   - IdentityClientService  — injected by BulkOpsController for the
 *                              404-not-403 school-scope check AND by
 *                              the worker for cached schoolName resolution.
 *   - TenantSettingsService  — worker fetches tenant currency once per job.
 *   - InvoicesService        — worker calls
 *                              invoicesService.generateForBulkWorker per
 *                              student. Provided LOCALLY here (mirror of
 *                              InvoicesModule's local provision), so the
 *                              full InvoicesService dep chain (fee-structures,
 *                              student-accounts, sequence, events, tenant-
 *                              settings, identity, dynamodb) must also be
 *                              locally provided.
 *   - FeeStructuresService   — pre-flight fee-structure fetch + per-student
 *                              generate path. Also a transitive dep of
 *                              InvoicesService.
 *   - StudentAccountsService — transitive dep of InvoicesService.generate*.
 *   - SequenceService        — worker calls incrementSequenceBy once per job.
 *   - FinanceEventsService   — transitive dep of InvoicesService for the
 *                              InvoiceGenerated domain event.
 *   - BulkInvoiceGenerateWorker — owned by this module; injected by
 *                              InvoicesController via the exported.
 *   - PerSchoolLock          — owned by this module; ECS-task singleton.
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '@app/auth';
import { HttpClientModule } from '@app/http-client';
import { BulkOpsController } from './bulk-ops.controller';
import { FinanceJobsService } from './finance-jobs.service';
import { FinanceAuditService } from '../common/services/finance-audit.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { TenantSettingsService } from '../common/services/tenant-settings.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { InvoicesService } from '../invoices/invoices.service';
import { FeeStructuresService } from '../fee-structures/fee-structures.service';
import { StudentAccountsService } from '../student-accounts/student-accounts.service';
import { SequenceService } from '../common/services/sequence.service';
import { BulkInvoiceGenerateWorker } from './workers/bulk-invoice-generate.worker';
import { PerSchoolLock } from './util/per-school-lock';

@Module({
  imports: [AuthModule, HttpClientModule],
  controllers: [BulkOpsController],
  providers: [
    FinanceJobsService,
    FinanceAuditService,
    DynamoDBClientService,
    IdentityClientService,
    TenantSettingsService,
    FinanceEventsService,
    InvoicesService,
    FeeStructuresService,
    StudentAccountsService,
    SequenceService,
    BulkInvoiceGenerateWorker,
    PerSchoolLock,
  ],
  exports: [FinanceJobsService, BulkInvoiceGenerateWorker, PerSchoolLock],
})
export class BulkOperationsModule {}
