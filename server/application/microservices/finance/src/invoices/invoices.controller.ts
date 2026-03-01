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
    @Query('limit') limit: string,
    @Query('cursor') cursor: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<{ items: Invoice[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    const context = buildRequestContext(tenant, req, schoolId);

    // Student-scoped filtering: Parent/Student roles only see their linked students' invoices
    let scopedStudentId = studentId;
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

    return this.invoicesService.list(schoolId, context, {
      status, studentId: scopedStudentId, academicYear,
      limit: limit ? parseInt(limit, 10) : 50,
      cursor,
    });
  }

  // Static routes MUST be defined before dynamic :id routes in NestJS

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
}
