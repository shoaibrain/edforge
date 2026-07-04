/**
 * Agreements Controllers — EPIC-FB Sprint FB-2.6 (+ FB-3.5 activate,
 * FB-3.6 versions)
 *
 * School-scoped CRUD + lifecycle under
 * `/finance/schools/:schoolId/agreements`, plus the student-scoped read
 * `GET /finance/students/:studentId/agreements` (schoolId as query param,
 * mirroring the finance payment-detail routes).
 *
 * Permissions: EVERY route — including reads — requires `billing:manage`
 * (owner decision FB-2.0b, 2026-07-04: negotiated pricing is sensitive;
 * `billing:view` alone does NOT expose agreement terms). Do NOT "fix"
 * reads down to billing:view.
 *
 * Feature flag: BillingAgreementsFlagGuard 404s every route when
 * `BILLING_AGREEMENTS_ENABLED === 'false'`.
 *
 * Three-way handoff (per CLAUDE.md): controllers (here) + API GW spec
 * (tenant-api-prod.json — registered by the follow-up package) + nginx
 * `^/finance` (existing prefix — no nginx.template change).
 */

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AgreementsService } from './agreements.service';
import { BillingAgreementsFlagGuard } from './billing-agreements-flag.guard';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import {
  ActivateAgreementDtoZ,
  CancelAgreementDtoZ,
  CreateBillingAgreementDtoZ,
  UpdateBillingAgreementDtoZ,
} from '../common/dto/zod-dtos';
import { buildRequestContext } from '../common/entities/base.entity';
import type { AgreementStatus, BillingAgreement } from '@aibrains/shared-types';

@Controller('finance/schools/:schoolId/agreements')
@UseGuards(JwtAuthGuard, BillingAgreementsFlagGuard)
export class AgreementsController {
  constructor(private readonly agreementsService: AgreementsService) {}

  @Post()
  @UseGuards(PermissionGuard)
  // billing:manage even though this is a create — FB-2.0b.
  @RequirePermission({ resource: 'billing', action: 'manage', schoolIdParam: 'schoolId' })
  async create(
    @Param('schoolId') schoolId: string,
    @Body() dto: CreateBillingAgreementDtoZ,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<BillingAgreement> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.agreementsService.create(schoolId, dto, context);
  }

  @Get()
  @UseGuards(PermissionGuard)
  // billing:manage even for reads — FB-2.0b.
  @RequirePermission({ resource: 'billing', action: 'manage', schoolIdParam: 'schoolId' })
  async list(
    @Param('schoolId') schoolId: string,
    @Query('status') status: AgreementStatus | undefined,
    @Query('familyId') familyId: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<{ items: BillingAgreement[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.agreementsService.list(schoolId, context, {
      status,
      familyId,
      limit: limit ? parseInt(limit, 10) : 50,
      cursor,
    });
  }

  @Get(':agreementId')
  @UseGuards(PermissionGuard)
  // billing:manage even for reads — FB-2.0b.
  @RequirePermission({ resource: 'billing', action: 'manage', schoolIdParam: 'schoolId' })
  async get(
    @Param('schoolId') schoolId: string,
    @Param('agreementId') agreementId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<BillingAgreement> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.agreementsService.get(schoolId, agreementId, context);
  }

  @Get(':agreementId/versions')
  @UseGuards(PermissionGuard)
  // billing:manage even for reads — FB-2.0b.
  @RequirePermission({ resource: 'billing', action: 'manage', schoolIdParam: 'schoolId' })
  async getVersionHistory(
    @Param('schoolId') schoolId: string,
    @Param('agreementId') agreementId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<{ items: BillingAgreement[] }> {
    const context = buildRequestContext(tenant, req, schoolId);
    const items = await this.agreementsService.getVersionHistory(schoolId, agreementId, context);
    return { items };
  }

  @Patch(':agreementId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'manage', schoolIdParam: 'schoolId' })
  async update(
    @Param('schoolId') schoolId: string,
    @Param('agreementId') agreementId: string,
    @Body() dto: UpdateBillingAgreementDtoZ,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<BillingAgreement> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.agreementsService.update(schoolId, agreementId, dto, context);
  }

  @Post(':agreementId/cancel')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'manage', schoolIdParam: 'schoolId' })
  async cancel(
    @Param('schoolId') schoolId: string,
    @Param('agreementId') agreementId: string,
    @Body() dto: CancelAgreementDtoZ,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<BillingAgreement> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.agreementsService.cancel(schoolId, agreementId, dto, context);
  }

  @Post(':agreementId/activate')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'manage', schoolIdParam: 'schoolId' })
  async activate(
    @Param('schoolId') schoolId: string,
    @Param('agreementId') agreementId: string,
    @Body() dto: ActivateAgreementDtoZ,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<BillingAgreement> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.agreementsService.activate(schoolId, agreementId, dto, context);
  }
}

@Controller('finance/students/:studentId/agreements')
@UseGuards(JwtAuthGuard, BillingAgreementsFlagGuard)
export class StudentAgreementsController {
  constructor(private readonly agreementsService: AgreementsService) {}

  /**
   * GET /finance/students/:studentId/agreements?schoolId=…&status=…
   * schoolId as query param mirrors `GET /finance/payments/:paymentId`.
   */
  @Get()
  @UseGuards(PermissionGuard)
  // billing:manage even for reads — FB-2.0b.
  @RequirePermission({ resource: 'billing', action: 'manage', schoolIdParam: 'schoolId' })
  async listForStudent(
    @Param('studentId') studentId: string,
    @Query('schoolId') schoolId: string,
    @Query('status') status: AgreementStatus | undefined,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<{ items: BillingAgreement[] }> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.agreementsService.listForStudent(studentId, schoolId, context, { status });
  }
}
