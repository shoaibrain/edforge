import {
  Controller,
  Get, Post, Patch,
  Body, Param, Query, Res,
  UseGuards, Req,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Readable } from 'stream';
import { InvoicesService } from './invoices.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { IdentityClientService } from '../common/services/identity-client.service';
import { GenerateInvoiceDtoZ, BulkGenerateInvoiceDtoZ, UpdateInvoiceDtoZ } from '../common/dto/zod-dtos';
import { buildRequestContext } from '../common/entities/base.entity';
import type { Invoice } from '@aibrains/shared-types';

@Controller('finance/schools/:schoolId/invoices')
@UseGuards(JwtAuthGuard)
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly identityClient: IdentityClientService,
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
    @Query('limit') limit: string,
    @Query('cursor') cursor: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<{ items: Invoice[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    const context = buildRequestContext(tenant, req, schoolId);

    // Student-scoped filtering: Parent/Student roles only see their linked students' invoices
    const scopedStudentId = studentId;
    if (!scopedStudentId && tenant.globalRole !== 'TenantAdmin') {
      const roleResult = await this.identityClient.getUserRole(tenant.userId, schoolId, context);
      const role = roleResult?.role;

      if (role === 'Parent' || role === 'Student') {
        const linkedStudentIds = await this.identityClient.getLinkedStudentIds(
          tenant.userId, schoolId, context,
        );
        if (linkedStudentIds.length === 0) {
          return { items: [], hasMore: false };
        }
        // Query per-student via GSI2 and merge results
        return this.invoicesService.listForStudents(schoolId, linkedStudentIds, context, {
          status, academicYear,
          limit: limit ? parseInt(limit, 10) : 50,
          cursor,
        });
      }
    }

    // If caller explicitly passed studentId, enforce ownership for parents
    if (scopedStudentId && tenant.globalRole !== 'TenantAdmin') {
      await this.identityClient.enforceStudentOwnership(scopedStudentId, schoolId, context);
    }

    // Sprint B.1 — gradeLevel filter routes to the dedicated GSI14
    // path, which is O(matching rows) rather than the school-wide
    // GSI1 scan + post-filter the default list() does.
    // `gradeLevel` and `studentId` are independent dimensions; for
    // the Sprint B operator-facing chip flow only `gradeLevel` is
    // set, so we don't try to compose both (would require a code
    // path that does GSI14 + post-filter studentId, which has no
    // current caller). If both arrive together, gradeLevel wins
    // and studentId is added as a FilterExpression below.
    if (gradeLevel && gradeLevel.trim()) {
      return this.invoicesService.listBySchoolAndGrade(schoolId, gradeLevel, context, {
        status, academicYear,
        limit: limit ? parseInt(limit, 10) : 50,
        cursor,
      });
    }

    return this.invoicesService.list(schoolId, context, {
      status, studentId: scopedStudentId, academicYear,
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

  @Post('bulk-generate')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'create', schoolIdParam: 'schoolId' })
  async bulkGenerate(
    @Param('schoolId') schoolId: string,
    @Body() dto: BulkGenerateInvoiceDtoZ,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<{ generated: number; skipped: number; errors: string[] }> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.invoicesService.generateBulk(schoolId, dto, context);
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
