import {
  Controller,
  Get, Post,
  Body, Param, Query, Res,
  UseGuards, Req,
  ForbiddenException,
  ConflictException,
  PayloadTooLargeException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Readable } from 'stream';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { IdentityClientService } from '../common/services/identity-client.service';
import { RecordManualPaymentDtoZ, InitiatePaymentDtoZ, VoidPaymentDtoZ, CreateRefundDtoZ } from '../common/dto/zod-dtos';
import { buildRequestContext } from '../common/entities/base.entity';
import { ZodValidationPipe } from 'nestjs-zod';
import { Idempotent } from '../common/interceptors/idempotent.interceptor';
import { FinanceJobsService } from '../bulk-ops/finance-jobs.service';
import { BulkReceiptPdfExportWorker } from '../bulk-ops/workers/bulk-receipt-pdf-export.worker';
import { ActiveExportAlreadyRunningError } from '../bulk-ops/active-export-already-running.error';
import { BULK_EXPORT_CAPS } from '../bulk-ops/bulk-export-caps';
import {
  bulkReceiptPdfExportSchema,
  type BulkReceiptPdfExportDto,
} from '@aibrains/shared-types';
import type { Payment, Receipt, InitiatePaymentResponse, VerifyPaymentResponse } from '@aibrains/shared-types';

@Controller('finance')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly identityClient: IdentityClientService,
    // Sprint G.3 — bulk receipt PDF export deps. Same trio as the F.4
    // invoice endpoint (financeJobsService for the atomic job+sentinel
    // create; BulkReceiptPdfExportWorker for the setImmediate dispatch).
    // Injected here rather than in a separate bulk-ops controller so
    // the receipt export lives next to the single-receipt endpoint,
    // matching the invoice-side layout at invoices.controller.ts.
    private readonly financeJobsService: FinanceJobsService,
    private readonly bulkReceiptPdfExportWorker: BulkReceiptPdfExportWorker,
  ) {}

  // =========================================================================
  // MANUAL PAYMENT (cash, bank_transfer, cheque)
  // =========================================================================

  @Post('schools/:schoolId/payments/manual')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'create', schoolIdParam: 'schoolId' })
  async recordManualPayment(
    @Param('schoolId') schoolId: string,
    @Body() dto: RecordManualPaymentDtoZ,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<Payment> {
    const context = buildRequestContext(tenant, req, schoolId);

    // Block Parent/Student from recording manual payments (prevents fraud)
    if (tenant.globalRole !== 'TenantAdmin') {
      const roleResult = await this.identityClient.getUserRole(tenant.userId, schoolId, context);
      const role = roleResult?.role;
      if (role === 'Parent' || role === 'Student') {
        throw new ForbiddenException('Manual payment recording requires admin access');
      }
    }

    return this.paymentsService.recordManualPayment(schoolId, dto, context);
  }

  // =========================================================================
  // GATEWAY PAYMENT INITIATION & VERIFICATION
  // =========================================================================

  @Post('schools/:schoolId/payments/initiate')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'create', schoolIdParam: 'schoolId' })
  async initiatePayment(
    @Param('schoolId') schoolId: string,
    @Body() dto: InitiatePaymentDtoZ,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<InitiatePaymentResponse> {
    const context = buildRequestContext(tenant, req, schoolId);

    // Enforce student ownership: parents can only pay their own children's invoices
    if (tenant.globalRole !== 'TenantAdmin') {
      const invoice = await this.paymentsService.getInvoiceForOwnershipCheck(
        schoolId, dto.invoiceId, context,
      );
      await this.identityClient.enforceStudentOwnership(invoice.studentId, schoolId, context);
    }

    return this.paymentsService.initiatePayment(schoolId, dto, context);
  }

  @Get('payments/verify/:sessionId')
  async verifyPayment(
    @Param('sessionId') sessionId: string,
    @Query() callbackData: Record<string, string>,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<VerifyPaymentResponse> {
    const context = buildRequestContext(tenant, req);

    // Ownership check: resolve schoolId + studentId from session, then enforce
    const sessionCtx = await this.paymentsService.resolveSessionContext(sessionId, context);
    await this.identityClient.enforceStudentOwnership(
      sessionCtx.studentId,
      sessionCtx.schoolId,
      context,
    );

    return this.paymentsService.verifyPayment(sessionId, callbackData, context);
  }

  // =========================================================================
  // LIST PAYMENTS
  // =========================================================================

  @Get('schools/:schoolId/payments')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async listSchoolPayments(
    @Param('schoolId') schoolId: string,
    @Query('status') status: string,
    @Query('gateway') gateway: string,
    @Query('gradeLevel') gradeLevel: string,
    @Query('limit') limit: string,
    @Query('cursor') cursor: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<{ items: Payment[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    const context = buildRequestContext(tenant, req, schoolId);

    // Sprint B.2 — gradeLevel filter routes to GSI14. Mirror of
    // invoices.controller#list. Sparse on the index — payments without
    // a snapshot gradeLevel never appear here (operator UI gates the
    // "Unknown" bucket via a separate path, post-Sprint-B fast-follow).
    if (gradeLevel && gradeLevel.trim()) {
      return this.paymentsService.listBySchoolAndGrade(schoolId, gradeLevel, context, {
        status, gateway,
        limit: limit ? parseInt(limit, 10) : 50,
        cursor,
      });
    }

    return this.paymentsService.listBySchool(schoolId, context, {
      status, gateway,
      limit: limit ? parseInt(limit, 10) : 50,
      cursor,
    });
  }

  @Get('schools/:schoolId/payments/export')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async exportPaymentsCsv(
    @Param('schoolId') schoolId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const context = buildRequestContext(tenant, req, schoolId);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="payments.csv"');

    const stream = Readable.from(this.paymentsService.streamPaymentsCsvRows(schoolId, context));
    stream.pipe(res);
  }

  @Get('schools/:schoolId/invoices/:invoiceId/payments')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async listInvoicePayments(
    @Param('schoolId') schoolId: string,
    @Param('invoiceId') invoiceId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<Payment[]> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.paymentsService.listByInvoice(schoolId, invoiceId, context);
  }

  // =========================================================================
  // GET PAYMENT & RECEIPT
  // =========================================================================

  @Get('payments/:paymentId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async getPayment(
    @Param('paymentId') paymentId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<Payment> {
    const context = buildRequestContext(tenant, req, schoolId);
    const payment = await this.paymentsService.get(schoolId, paymentId, context);

    // Entity-level ownership enforcement
    if (payment.studentAccountId) {
      await this.identityClient.enforceStudentOwnership(payment.studentAccountId, schoolId, context);
    }

    return payment;
  }

  @Get('payments/:paymentId/receipt')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async getReceipt(
    @Param('paymentId') paymentId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<Receipt> {
    const context = buildRequestContext(tenant, req, schoolId);
    const receipt = await this.paymentsService.getReceipt(schoolId, paymentId, context);

    // Entity-level ownership enforcement
    if (receipt.studentId) {
      await this.identityClient.enforceStudentOwnership(receipt.studentId, schoolId, context);
    }

    return receipt;
  }

  /**
   * Render the payment receipt as a PDF. Sprint C.1.6 — second
   * user-visible PDF endpoint (mirror of C.1.5 invoice PDF).
   *
   * Permission: reuses `billing:view` (no new key).
   * Ownership: enforced before render via `enforceStudentOwnership`
   * using the JSON receipt's studentId (Payment carries studentId
   * directly; we fetch the receipt JSON first which also validates the
   * payment exists + is completed).
   *
   * Response: binary `application/pdf` blob with `Content-Disposition:
   * inline` and a filename built from the receiptNumber (e.g.
   * `RCP-12345678.pdf`).
   */
  @Get('payments/:paymentId/receipt/pdf')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async getReceiptPdf(
    @Param('paymentId') paymentId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const context = buildRequestContext(tenant, req, schoolId);

    // Ownership check BEFORE the render — mirror of the existing
    // `getReceipt` JSON pattern at line ~189. We use `getReceipt()` here
    // (which also validates payment exists + is completed) rather than
    // duplicating the entity load; the service.getReceiptPdf will load
    // entities again separately. Slight redundancy accepted for V1 —
    // both calls hit DDB on the same partition (cheap).
    const receipt = await this.paymentsService.getReceipt(schoolId, paymentId, context);
    if (receipt.studentId) {
      await this.identityClient.enforceStudentOwnership(receipt.studentId, schoolId, context);
    }

    const buffer = await this.paymentsService.getReceiptPdf(schoolId, paymentId, context);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${receipt.receiptNumber}.pdf"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, no-store',
    });
    res.send(buffer);
  }

  /**
   * Sprint G.3 — bulk RECEIPT PDF export (mirror of F.4 invoice endpoint).
   *
   * `POST /finance/schools/:schoolId/payments/bulk-pdf-export`
   *
   * Operator selects N payments via row-select on the payment list
   * (Sprint G.1 frontend) → hits Download PDF (ZIP) → this endpoint
   * atomically creates a FinanceJob row + MVP.5 active-export sentinel,
   * dispatches the BulkReceiptPdfExportWorker (G.2) via setImmediate,
   * and returns 202 with jobId. Frontend polls
   * GET /finance/jobs/:jobId at 2s cadence via the same drawer +
   * useFinanceJob hook already used for invoice exports (Sprint G.4).
   *
   * Error envelope (operator-facing):
   *   409 ACTIVE_EXPORT_ALREADY_RUNNING — sentinel collision (MVP.5).
   *     Body carries `runningJobId`. Sentinel is jobType-agnostic per
   *     D1+D8 — one bulk export at a time per school, invoice OR receipt.
   *   413 PAYLOAD_TOO_LARGE — paymentIds.length > BULK_EXPORT_CAPS.zip.
   *   501 NOT_IMPLEMENTED — format='merged_pdf' (deferred to Sprint H.3).
   *
   * Idempotency: `@Idempotent()` decorator → double-submit with same
   * Idempotency-Key header returns the original 202 body verbatim.
   *
   * Three-way route registration (CLAUDE.md §434-460):
   *   1. This controller method (Nest) — DONE
   *   2. `tenant-api-prod.json` (API GW) — REQUIRED, see Sprint G PR
   *   3. `nginx.template` — no change needed; `^/finance` covers
   */
  @Post('schools/:schoolId/payments/bulk-pdf-export')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  @Idempotent()
  async bulkReceiptPdfExport(
    @Param('schoolId') schoolId: string,
    @Body(new ZodValidationPipe(bulkReceiptPdfExportSchema)) dto: BulkReceiptPdfExportDto,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ jobId: string; message: string }> {
    // Sprint H.3 — merged_pdf now supported (was 501 in G.3). Per-format caps
    // apply: 2000 zip / 1000 merged_pdf. Zod schema deliberately has NO
    // `.max(N)` so this envelope is reachable (F.4 P2 review lesson).
    const cap = BULK_EXPORT_CAPS[dto.format];
    if (dto.paymentIds.length > cap) {
      throw new PayloadTooLargeException({
        code: 'PAYLOAD_TOO_LARGE',
        message: `paymentIds count ${dto.paymentIds.length} exceeds the ${cap} cap for ${dto.format} exports.`,
        limit: cap,
        requested: dto.paymentIds.length,
      });
    }

    const context = buildRequestContext(tenant, req, schoolId);

    // MVP.5 atomic create + active-export sentinel. The sentinel is
    // JOBTYPE-AGNOSTIC per D1+D8 — the SAME sentinel row blocks a
    // second bulk-invoice-pdf-export AND a bulk-receipt-pdf-export at
    // the school level. Operator's mental model: "one bulk export at
    // a time per school", regardless of flavor.
    const idempotencyKey = (req.headers['idempotency-key'] || req.headers['Idempotency-Key']) as
      | string
      | undefined;
    let job;
    try {
      job = await this.financeJobsService.create(
        {
          schoolId,
          operatorId: context.userId,
          jobType: 'bulk_receipt_pdf_export',
          requested: dto.paymentIds.length,
          outputFormat: dto.format,
          idempotencyKey,
        },
        context,
        {
          singleActiveExportGuard: {
            schoolId,
            jobType: 'bulk_receipt_pdf_export',
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

    // Dispatch worker on the next event-loop tick — same pattern as
    // F.4. The setImmediate lets the 202 fully flush BEFORE the CPU-
    // heavy render pipeline starts.
    setImmediate(() => {
      this.bulkReceiptPdfExportWorker
        .run(job.jobId, { schoolId, paymentIds: dto.paymentIds, format: dto.format }, context)
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `BulkReceiptPdfExportWorker.run unhandled: jobId=${job.jobId} ${msg}`,
          );
        });
    });

    res.status(HttpStatus.ACCEPTED);
    return {
      jobId: job.jobId,
      message: 'Large exports run in the background and may take a few minutes.',
    };
  }

  // =========================================================================
  // VOID & REFUND
  // =========================================================================

  @Post('schools/:schoolId/payments/:paymentId/void')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'manage', schoolIdParam: 'schoolId' })
  async voidPayment(
    @Param('schoolId') schoolId: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: VoidPaymentDtoZ,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<Payment> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.paymentsService.voidPayment(schoolId, paymentId, dto.reason, context);
  }

  @Post('schools/:schoolId/payments/:paymentId/refund')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'manage', schoolIdParam: 'schoolId' })
  async refundPayment(
    @Param('schoolId') schoolId: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: CreateRefundDtoZ,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<Payment> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.paymentsService.refund(schoolId, paymentId, dto, context);
  }

  // =========================================================================
  // RECONCILIATION
  // =========================================================================

  @Post('schools/:schoolId/payments/:paymentId/reconcile')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'manage', schoolIdParam: 'schoolId' })
  async reconcilePayment(
    @Param('schoolId') schoolId: string,
    @Param('paymentId') paymentId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<{ status: string; action: string }> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.paymentsService.reconcilePayment(schoolId, paymentId, context);
  }
}
