import {
  Controller,
  Get, Post, Patch,
  Body, Param, Query, Res,
  UseGuards, Req,
  HttpStatus,
  Logger,
  ConflictException,
  ForbiddenException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Readable } from 'stream';
import { InvoicesService } from './invoices.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { IdentityClientService } from '../common/services/identity-client.service';
import { GenerateInvoiceDtoZ, BulkGenerateInvoiceDtoZ, UpdateInvoiceDtoZ } from '../common/dto/zod-dtos';
import { ZodValidationPipe } from 'nestjs-zod';
import { bulkPdfExportSchema, type BulkPdfExportDto } from '@aibrains/shared-types';
import { buildRequestContext } from '../common/entities/base.entity';
import type { Invoice } from '@aibrains/shared-types';
import type { InvoiceProvenanceDto } from './invoices.service';
import { FinanceJobsService } from '../bulk-ops/finance-jobs.service';
import { BulkInvoiceGenerateWorker } from '../bulk-ops/workers/bulk-invoice-generate.worker';
import { BulkInvoicePdfExportWorker } from '../bulk-ops/workers/bulk-invoice-pdf-export.worker';
import { ActiveExportAlreadyRunningError } from '../bulk-ops/active-export-already-running.error';
import { BULK_EXPORT_CAPS } from '../bulk-ops/bulk-export-caps';
import { Idempotent } from '../common/interceptors/idempotent.interceptor';

/**
 * Parse the BULK_SYNC_THRESHOLD env var. Returns a positive integer or
 * the default 25 (per Sprint E.3 contract). Bad values log a warning
 * and fall back to default — never throw, so a misconfig can't take
 * the route down.
 *
 * Read on every request rather than module-init so an operator can
 * tune the threshold via task-def env update without an ECS roll.
 * The parse is cheap (one regex on a short string).
 */
export const BULK_SYNC_THRESHOLD_DEFAULT = 25;
export function parseSyncThreshold(): number {
  const raw = process.env.BULK_SYNC_THRESHOLD?.trim();
  if (!raw) return BULK_SYNC_THRESHOLD_DEFAULT;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    console.warn(
      `Invalid BULK_SYNC_THRESHOLD="${raw}" (expected positive integer); ` +
        `using default=${BULK_SYNC_THRESHOLD_DEFAULT}`,
    );
    return BULK_SYNC_THRESHOLD_DEFAULT;
  }
  return parsed;
}

@Controller('finance/schools/:schoolId/invoices')
@UseGuards(JwtAuthGuard)
export class InvoicesController {
  private readonly logger = new Logger(InvoicesController.name);

  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly identityClient: IdentityClientService,
    private readonly financeJobsService: FinanceJobsService,
    private readonly bulkInvoiceGenerateWorker: BulkInvoiceGenerateWorker,
    private readonly bulkInvoicePdfExportWorker: BulkInvoicePdfExportWorker,
  ) {}

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'create', schoolIdParam: 'schoolId' })
  async generate(
    @Param('schoolId') schoolId: string,
    @Body() dto: GenerateInvoiceDtoZ,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<Invoice> {
    const context = buildRequestContext(tenant, req, schoolId);

    // EPIC-FB FB-3.4 — `overrideAgreement` is a pricing bypass and needs
    // billing:manage, not the route's static billing:create. The decorator
    // can't express a per-payload permission, so the escalated check runs
    // in-handler for the flag case only (TenantAdmin bypasses RBAC, same
    // as PermissionGuard).
    if (dto.overrideAgreement === true && tenant.globalRole !== 'TenantAdmin') {
      const check = await this.identityClient.checkPermission(
        tenant.userId,
        'billing',
        'manage',
        schoolId,
        context,
      );
      if (!check.allowed) {
        throw new ForbiddenException(
          'Permission denied: billing:manage is required for overrideAgreement',
        );
      }
    }

    return this.invoicesService.generate(schoolId, dto, context);
  }

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async list(
    @Param('schoolId') schoolId: string,
    @Query('status') status: string,
    @Query('studentId') studentId: string,
    @Query('academicYear') academicYear: string,
    @Query('gradeLevel') gradeLevel: string,
    // EPIC-FB FB-5.5 — 'agreement' | 'standard'; absent = today's behavior.
    @Query('billingSource') billingSourceRaw: string,
    @Query('limit') limit: string,
    @Query('cursor') cursor: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<{ items: Invoice[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    const context = buildRequestContext(tenant, req, schoolId);
    const billingSource = (billingSourceRaw || undefined) as
      | 'agreement'
      | 'standard'
      | undefined;

    // Parent/Student callers ONLY ever see their linked students' invoices,
    // regardless of which query params they pass. The gradeLevel/GSI14
    // branch below is staff-only — it queries school-wide by grade and
    // drops studentId entirely (reverify finding: ?studentId=<own-child>
    // &gradeLevel=X previously leaked every grade-X invoice school-wide
    // to a parent who owned any one student).
    const scopedStudentId = studentId;
    if (tenant.globalRole !== 'TenantAdmin') {
      const roleResult = await this.identityClient.getUserRole(tenant.userId, schoolId, context);
      const role = roleResult?.role;

      if (role === 'Parent' || role === 'Student') {
        if (scopedStudentId) {
          await this.identityClient.enforceStudentOwnership(scopedStudentId, schoolId, context);
          return this.invoicesService.listForStudents(schoolId, [scopedStudentId], context, {
            status, academicYear, billingSource,
            limit: limit ? parseInt(limit, 10) : 50,
            cursor,
          });
        }
        const linkedStudentIds = await this.identityClient.getLinkedStudentIds(
          tenant.userId, schoolId, context,
        );
        if (linkedStudentIds.length === 0) {
          return { items: [], hasMore: false };
        }
        // Query per-student via GSI2 and merge results
        return this.invoicesService.listForStudents(schoolId, linkedStudentIds, context, {
          status, academicYear, billingSource,
          limit: limit ? parseInt(limit, 10) : 50,
          cursor,
        });
      }

      if (scopedStudentId) {
        await this.identityClient.enforceStudentOwnership(scopedStudentId, schoolId, context);
      }
    }

    // Sprint B.1 — gradeLevel filter routes to the dedicated GSI14
    // path, which is O(matching rows) rather than the school-wide
    // GSI1 scan + post-filter the default list() does. Staff-only by
    // construction (parent-scoped callers returned above). gradeLevel
    // wins over studentId here; the GSI14 query does not compose a
    // studentId filter (no current caller passes both).
    if (gradeLevel && gradeLevel.trim()) {
      return this.invoicesService.listBySchoolAndGrade(schoolId, gradeLevel, context, {
        status, academicYear, billingSource,
        limit: limit ? parseInt(limit, 10) : 50,
        cursor,
      });
    }

    return this.invoicesService.list(schoolId, context, {
      status, studentId: scopedStudentId, academicYear, billingSource,
      limit: limit ? parseInt(limit, 10) : 50,
      cursor,
    });
  }

  // Static routes MUST be defined before dynamic :id routes in NestJS

  /**
   * Bulk Ops Sprint C.6 — read-only preview backing the wizard
   * confirmation step. Resolves the studentIds[] for the same payload
   * shape as bulk-generate, then counts existing-active-invoice
   * duplicates. No DDB writes; no Idempotency-Key needed.
   *
   * Query params mirror the bulk-generate DTO discriminator:
   *   ?selectionMode=students&studentIds=a,b,c  (legacy flat shape also accepted)
   *   ?selectionMode=grades&gradeLevels=4,5     (or gradeLevels=ALL)
   *   ?feeStructureIds=fs1,fs2&billingPeriod=2026-04  (for duplicate detection)
   */
  @Get('bulk-preview')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async bulkPreview(
    @Param('schoolId') schoolId: string,
    @Query('selectionMode') selectionMode: string,
    @Query('studentIds') studentIdsCsv: string,
    @Query('gradeLevels') gradeLevelsCsv: string,
    @Query('feeStructureIds') feeStructureIdsCsv: string,
    @Query('billingPeriod') billingPeriod: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<{
    studentCount: number;
    eligibleCount: number;
    duplicateCount: number;
    estimatedDurationSec: number;
    // Sprint C Phase 1 — derivable segment counters for the wizard rail.
    // Each is optional (best-effort); undefined when the underlying query
    // fails OR (for studentsNotBilledThisPeriod) when no billingPeriod was
    // supplied — see InvoicesService.computePreviewSegmentCounters.
    studentsWithBalance?: number;
    studentsNotBilledThisPeriod?: number;
    studentsNewAdmission?: number;
    // EPIC-FB FB-3.7 — per-student agreement coverage of the requested
    // feeTypes ('agreement' = all covered, 'mixed' = some, 'standard' =
    // none / no agreement). Optional + best-effort: absent when
    // BILLING_AGREEMENTS_ENABLED='false' or resolution failed.
    students?: Array<{ studentId: string; billingSource: 'standard' | 'agreement' | 'mixed' }>;
  }> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.invoicesService.bulkPreview(schoolId, {
      selectionMode: selectionMode as 'students' | 'grades' | undefined,
      studentIds: studentIdsCsv ? studentIdsCsv.split(',').filter(Boolean) : undefined,
      gradeLevels: gradeLevelsCsv ? gradeLevelsCsv.split(',').filter(Boolean) : undefined,
      feeStructureIds: feeStructureIdsCsv ? feeStructureIdsCsv.split(',').filter(Boolean) : [],
      billingPeriod: billingPeriod || undefined,
    }, context);
  }

  /**
   * Sprint E.3 — bulk-generate with auto-async promotion.
   *
   * The route accepts the same `BulkGenerateInvoiceDto` shape as before.
   * Routing is:
   *
   *   1. Resolve the studentIds[] (via the same C.3 resolver).
   *   2. If `studentCount > SYNC_LIMIT (25)` OR the caller passed
   *      `?async=true`, route to the ASYNC path:
   *        - Create a FinanceJob row (status='queued').
   *        - Schedule the worker via `setImmediate` (background).
   *        - Return 202 + `{ jobId }` synchronously.
   *      The HTTP request returns immediately; the operator polls
   *      `GET /finance/jobs/:jobId` for progress.
   *   3. Otherwise (≤25 students, no `async=true`), execute the
   *      existing synchronous `generateBulk` path (unchanged shape).
   *
   * Idempotency: the route is `@Idempotent()`-decorated so a duplicate
   * submission with the same `Idempotency-Key` HTTP header replays the
   * original response (the 202 + jobId for async, or the sync result).
   * The interceptor stores the response body so the operator sees a
   * consistent jobId across retries.
   *
   * Pre-E.3 behavior: anything over 25 threw 413. Post-E.3: 25-boundary
   * studentCount silently promotes to async (returns 202 instead). The
   * existing 413 test in invoices.controller.bulkGenerate.spec.ts is
   * updated to assert the new 202 + jobId shape.
   */
  @Post('bulk-generate')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'create', schoolIdParam: 'schoolId' })
  @Idempotent()
  async bulkGenerate(
    @Param('schoolId') schoolId: string,
    @Body() dto: BulkGenerateInvoiceDtoZ,
    @Query('async') asyncFlag: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<
    | { generated: number; skipped: number; errors: string[]; resolvedStudentCount?: number }
    | { jobId: string; status: 'queued'; requested: number }
  > {
    const context = buildRequestContext(tenant, req, schoolId);
    // PR #341 review F6: threshold is now env-tunable via
    // BULK_SYNC_THRESHOLD (default 25) so operators can adjust the
    // sync/async cutoff without an ECS roll.
    const SYNC_LIMIT = parseSyncThreshold();

    // Resolve studentIds first — gives us the exact count for the sync/
    // async fork AND the `requested` value on the job row.
    const resolvedStudentIds = await this.invoicesService.resolveStudentIdsForBulkGenerate(
      schoolId,
      dto,
      context,
    );

    const forceAsync = asyncFlag === 'true';
    const shouldRunAsync = forceAsync || resolvedStudentIds.length > SYNC_LIMIT;

    if (!shouldRunAsync) {
      // Sync path — unchanged.
      return this.invoicesService.generateBulk(schoolId, dto, context);
    }

    // Async path — create job, schedule worker, return 202.
    const idempotencyKey = (req.headers['idempotency-key'] || req.headers['Idempotency-Key']) as
      | string
      | undefined;
    const job = await this.financeJobsService.create(
      {
        schoolId,
        operatorId: context.userId,
        jobType: 'bulk_invoice_generate',
        requested: resolvedStudentIds.length,
        idempotencyKey,
      },
      context,
    );

    // Kick off worker on the next event-loop tick. PR #341 review F6:
    // `setImmediate` yields to the libuv I/O cycle so the 202 response
    // is fully flushed to the client BEFORE the worker begins its
    // 1000+ DDB/HTTP operations. The prior `Promise.resolve().then(...)`
    // ran in the microtask queue ahead of I/O, breaking that ordering
    // contract on the Sprint E.3 spec line 441.
    //
    // setImmediate returns a timer handle (not a Promise), so the
    // worker's error handling must be attached explicitly via .catch.
    // The worker's outer try/catch + markFailed is the primary
    // safety net; this catch is defense-in-depth for the truly-
    // unexpected (e.g. lock acquisition itself threw).
    setImmediate(() => {
      this.bulkInvoiceGenerateWorker
        .run(
          job.jobId,
          { ...dto, schoolId, resolvedStudentIds },
          context,
        )
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `BulkInvoiceGenerateWorker.run unhandled: jobId=${job.jobId} ${msg}`,
          );
        });
    });

    res.status(HttpStatus.ACCEPTED);
    return { jobId: job.jobId, status: 'queued', requested: resolvedStudentIds.length };
  }

  /**
   * Sprint F.4 — bulk PDF export.
   *
   * `POST /finance/schools/:schoolId/invoices/bulk-pdf-export`
   *
   * Operator selects N invoices via the list filter + multi-select on
   * the frontend (Sprint F.5). Controller atomically creates a
   * `FinanceJob` row + the MVP.5 active-export sentinel (single
   * concurrent export per school), dispatches the F.3
   * `BulkInvoicePdfExportWorker` via `setImmediate`, and returns 202
   * with `jobId`. Frontend (F.5) polls `GET /finance/jobs/:jobId`.
   *
   * Error envelope (operator-facing):
   *   409 ACTIVE_EXPORT_ALREADY_RUNNING — sentinel collision (MVP.5).
   *     Body carries `runningJobId` so the frontend can deep-link.
   *   413 PAYLOAD_TOO_LARGE — invoiceIds.length > BULK_EXPORT_CAPS.zip.
   *   501 NOT_IMPLEMENTED — `format='merged_pdf'` (deferred to H.3).
   *
   * Idempotency: the route is `@Idempotent()`-decorated, so the
   * existing Sprint 0.2 interceptor handles double-submit. A second
   * POST with the same `Idempotency-Key` returns the original 202
   * body verbatim — operator sees the same jobId.
   *
   * Worker contract (per F.3): the worker is detached via
   * `setImmediate`. Its outer try/catch + markFailed handles its own
   * failure modes; the `.catch()` here is defense-in-depth for the
   * truly-unexpected (e.g. lock acquisition itself threw).
   *
   * Three-way route registration (CLAUDE.md §434-460):
   *   1. This controller method (Nest)
   *   2. `tenant-api-prod.json` (API GW) — REQUIRED, see F.4 PR
   *   3. `nginx.template` — no change needed; `^/finance` covers
   */
  @Post('bulk-pdf-export')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  @Idempotent()
  async bulkPdfExport(
    @Param('schoolId') schoolId: string,
    @Body(new ZodValidationPipe(bulkPdfExportSchema)) dto: BulkPdfExportDto,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ jobId: string; message: string }> {
    // Sprint H.3 — merged_pdf is now supported (was 501 in F.4). Per-format
    // caps: 2000 for zip (streams via archiver, bounded by process memory
    // via multipart upload buffer), 1000 for merged_pdf (pdf-lib holds the
    // full output in memory before upload).
    const cap = BULK_EXPORT_CAPS[dto.format];
    if (dto.invoiceIds.length > cap) {
      throw new PayloadTooLargeException({
        code: 'PAYLOAD_TOO_LARGE',
        message: `invoiceIds count ${dto.invoiceIds.length} exceeds the ${cap} cap for ${dto.format} exports.`,
        limit: cap,
        requested: dto.invoiceIds.length,
      });
    }

    const context = buildRequestContext(tenant, req, schoolId);

    // Round-3 B3 — bulk invoice export renders OTHER families' invoices by
    // id list; STAFF tooling only (parent UIs use student-scoped views).
    // Mirror of recordManualPayment's Parent/Student role probe.
    if (tenant.globalRole !== 'TenantAdmin') {
      const roleResult = await this.identityClient.getUserRole(tenant.userId, schoolId, context);
      const role = roleResult?.role;
      if (role === 'Parent' || role === 'Student') {
        throw new ForbiddenException('Bulk invoice export requires staff access');
      }
    }

    // MVP.5 atomic create + active-export sentinel. If a second
    // submission for the same school arrives while the first is still
    // running, the sentinel's `attribute_not_exists` ConditionExpression
    // fails the entire transaction → ActiveExportAlreadyRunningError →
    // 409 with `runningJobId`. The first job's state is untouched.
    const idempotencyKey = (req.headers['idempotency-key'] || req.headers['Idempotency-Key']) as
      | string
      | undefined;
    let job;
    try {
      job = await this.financeJobsService.create(
        {
          schoolId,
          operatorId: context.userId,
          jobType: 'bulk_invoice_pdf_export',
          requested: dto.invoiceIds.length,
          outputFormat: dto.format,
          idempotencyKey,
        },
        context,
        {
          singleActiveExportGuard: {
            schoolId,
            jobType: 'bulk_invoice_pdf_export',
          },
        },
      );
    } catch (err) {
      if (err instanceof ActiveExportAlreadyRunningError) {
        throw new ConflictException({
          code: 'ACTIVE_EXPORT_ALREADY_RUNNING',
          message:
            `A bulk export is already running for school ${err.schoolId}. ` +
            `Wait for it to finish or check job ${err.runningJobId}.`,
          runningJobId: err.runningJobId,
          schoolId: err.schoolId,
          jobType: err.jobType,
        });
      }
      throw err;
    }

    // Dispatch worker on the next event-loop tick. Same pattern as
    // E.3 bulk-generate — `setImmediate` yields to libuv I/O so the
    // 202 response is fully flushed BEFORE the worker starts its
    // multi-minute pipeline.
    setImmediate(() => {
      this.bulkInvoicePdfExportWorker
        .run(job.jobId, { schoolId, invoiceIds: dto.invoiceIds, format: dto.format }, context)
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `BulkInvoicePdfExportWorker.run unhandled: jobId=${job.jobId} ${msg}`,
          );
        });
    });

    res.status(HttpStatus.ACCEPTED);
    return {
      jobId: job.jobId,
      // Sprint §5d MVP.6 — operator copy backend-injected so a single
      // source-of-truth exists. F.5 frontend renders verbatim.
      message: 'Large exports run in the background and may take a few minutes.',
    };
  }

  @Post('bulk-issue')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'edit', schoolIdParam: 'schoolId' })
  async bulkIssue(
    @Param('schoolId') schoolId: string,
    @Body() dto: { invoiceIds: string[] },
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<{ issued: number; failed: number; errors: string[] }> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.invoicesService.bulkIssue(schoolId, dto.invoiceIds, context);
  }

  /**
   * EPIC-FB FB-0.3(a) — bulk-cancel stale draft invoices.
   *
   * `dryRun` defaults to TRUE — the destructive path requires an explicit
   * `dryRun: false`. Permission mirrors the sibling bulk mutation
   * (`bulk-issue` → `billing:edit`).
   *
   * API GW registration (`tenant-api-prod.json`) lands in the follow-up
   * routes package; nginx needs nothing (existing `/finance` prefix block).
   */
  @Post('bulk-cancel-drafts')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'edit', schoolIdParam: 'schoolId' })
  async bulkCancelDrafts(
    @Param('schoolId') schoolId: string,
    @Body() dto: { olderThanDays?: number; academicYear?: string; dryRun?: boolean },
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<{ matched: number; cancelled: number; dryRun: boolean; sample: string[] }> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.invoicesService.bulkCancelDrafts(
      schoolId,
      {
        olderThanDays: dto?.olderThanDays,
        academicYear: dto?.academicYear,
        dryRun: dto?.dryRun !== false,
      },
      context,
    );
  }

  @Get('export')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async exportCsv(
    @Param('schoolId') schoolId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const context = buildRequestContext(tenant, req, schoolId);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="invoices.csv"');

    const stream = Readable.from(this.invoicesService.streamInvoicesCsvRows(schoolId, context));
    stream.pipe(res);
  }

  // Dynamic :id routes below

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async get(
    @Param('schoolId') schoolId: string,
    @Param('id') invoiceId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<Invoice> {
    const context = buildRequestContext(tenant, req, schoolId);
    const invoice = await this.invoicesService.get(schoolId, invoiceId, context);

    // Entity-level ownership enforcement
    await this.identityClient.enforceStudentOwnership(invoice.studentId, schoolId, context);

    return invoice;
  }

  @Patch(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'edit', schoolIdParam: 'schoolId' })
  async update(
    @Param('schoolId') schoolId: string,
    @Param('id') invoiceId: string,
    @Body() dto: UpdateInvoiceDtoZ,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<Invoice> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.invoicesService.update(schoolId, invoiceId, dto, context);
  }

  @Post(':id/issue')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'edit', schoolIdParam: 'schoolId' })
  async issue(
    @Param('schoolId') schoolId: string,
    @Param('id') invoiceId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<Invoice> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.invoicesService.issue(schoolId, invoiceId, context);
  }

  /**
   * Render the invoice as a PDF. Sprint C.1.5 — the **first user-visible
   * PDF in prod**.
   *
   * Permission: reuses `billing:view` (no new key per the master plan).
   * Ownership: enforced via `enforceStudentOwnership` before render —
   * Students + Parents accessing their own invoices is fine; cross-student
   * leakage is blocked.
   *
   * Response: binary `application/pdf` blob with `Content-Disposition:
   * inline` (browsers render in-tab) and a filename built from the
   * invoiceNumber (operator-friendly when saved-as).
   *
   * Streaming vs buffer: V1 buffers — invoices are small (~5-20kB) and the
   * Buffer return shape is simpler. Future PR can stream if multi-page
   * invoices push past 500kB.
   */
  /**
   * EPIC-FB FB-5.4 — invoice provenance ("why") trace.
   *
   * `GET /finance/schools/:schoolId/invoices/:id/provenance`
   *
   * Permission: `billing:view` + the same entity-level ownership check as
   * `GET :id` — the trace exposes nothing the invoice detail's own line
   * items don't already show (agreement title appears in the line
   * description; negotiated amounts are the line amounts), plus resolved
   * referent names.
   *
   * The response carries an `overrides[]` array (BH-1.2/1.3) when the
   * operator bypassed an active agreement (`overrideAgreement: true`) on this
   * invoice — reconstructed from the queryable `finance.agreement.bypassed`
   * audit rows. Omitted when there are none or the audit query is
   * unavailable (best-effort; see the service JSDoc).
   *
   * Three-way route registration (CLAUDE.md): Nest (here) +
   * `tenant-api-prod.json` (orchestrator handles the API GW row after this
   * package); nginx needs nothing (existing `/finance` prefix block).
   */
  @Get(':id/provenance')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async getProvenance(
    @Param('schoolId') schoolId: string,
    @Param('id') invoiceId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<InvoiceProvenanceDto> {
    const context = buildRequestContext(tenant, req, schoolId);

    // Ownership check BEFORE the trace composition — mirror of `get(:id)`.
    const invoice = await this.invoicesService.get(schoolId, invoiceId, context);
    await this.identityClient.enforceStudentOwnership(invoice.studentId, schoolId, context);

    return this.invoicesService.getProvenance(schoolId, invoiceId, context);
  }

  @Get(':id/pdf')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async getPdf(
    @Param('schoolId') schoolId: string,
    @Param('id') invoiceId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const context = buildRequestContext(tenant, req, schoolId);

    // Ownership check BEFORE the render to avoid wasting render budget on a
    // 403-bound request. Mirror the existing pattern in `get(:id)` at
    // line ~149.
    const invoice = await this.invoicesService.get(schoolId, invoiceId, context);
    await this.identityClient.enforceStudentOwnership(invoice.studentId, schoolId, context);

    const buffer = await this.invoicesService.getPdf(schoolId, invoiceId, context);

    // `inline` so browsers render in-tab; the explicit filename gives a
    // sensible name if the user clicks "Save as". `Cache-Control: private,
    // no-store` keeps presigned-URL-bearing PDFs out of shared caches
    // (logo URL inside the PDF embed has a 10-min TTL — fine for this
    // single delivery, but we don't want intermediaries caching the bytes).
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${invoice.invoiceNumber}.pdf"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, no-store',
    });
    res.send(buffer);
  }
}
