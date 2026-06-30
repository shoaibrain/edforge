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
import { FinanceMetricsService } from '../common/services/finance-metrics.service';
import { BulkInvoiceGenerateWorker } from './workers/bulk-invoice-generate.worker';
import { BulkInvoicePdfExportWorker } from './workers/bulk-invoice-pdf-export.worker';
import { PerSchoolLock } from './util/per-school-lock';
import { PdfRenderConcurrencyBucket } from './util/pdf-render-concurrency-bucket';
import { StaleFinanceJobSweeper } from './stale-finance-job-sweeper.service';
import { S3Service } from '../common/services/s3.service';

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
    // #344 + #345 — hot-path CW metric emitter consumed by
    // SequenceService.incrementSequenceBy + BulkInvoiceGenerateWorker
    // per-stage timing. Locally provided to match the existing
    // "every module declares its full dep tree" pattern (see
    // module-wiring.spec.ts §574).
    FinanceMetricsService,
    BulkInvoiceGenerateWorker,
    PerSchoolLock,
    // Sprint §5d MVP.3 — on-boot sweeper for stale `running` finance
    // jobs orphaned by task replacement. Implements
    // OnApplicationBootstrap; runs once per process start. See
    // stale-finance-job-sweeper.service.ts for rationale.
    StaleFinanceJobSweeper,
    // Sprint F.2 — S3Service for bulk-PDF-export putZip + presignGet.
    // Locally provided so F.3 worker can inject it (mirror of the
    // every-feature-module-declares-its-deps invariant).
    S3Service,
    // Sprint F.3 + §5d MVP.5 S5 — process-wide PDF-render concurrency
    // bucket. Singleton by Nest DI; F.3 worker (and future G.2/H.3
    // workers) share the SAME instance, which is the source of the
    // "process-wide cap, NOT per-job" property.
    PdfRenderConcurrencyBucket,
    // Sprint F.3 — bulk-invoice-PDF-export worker. Constructor deps:
    // FinanceJobsService, FinanceAuditService, InvoicesService,
    // IdentityClientService, S3Service, PerSchoolLock,
    // PdfRenderConcurrencyBucket, FinanceMetricsService (optional).
    // All locally provided above.
    BulkInvoicePdfExportWorker,
  ],
  exports: [
    FinanceJobsService,
    BulkInvoiceGenerateWorker,
    PerSchoolLock,
    // Exported so F.4 controller (future) can inject for the
    // setImmediate handoff after returning 202.
    BulkInvoicePdfExportWorker,
  ],
})
export class BulkOperationsModule {}
