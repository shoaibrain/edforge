/**
 * Family billing endpoint — EPIC-FB Sprint FB-4.6.
 *
 * GET /finance/schools/:schoolId/families/:familyId/open-invoices
 *
 * Permission: `billing:view` — this is a read of INVOICE data (who owes
 * what), not of negotiated agreement terms; the FB-2.0b agreements
 * permission gate covers agreement resources only.
 *
 * Deliberately NOT feature-flag-gated: family payments work without
 * billing agreements (BILLING_AGREEMENTS_ENABLED would be the wrong
 * flag), and when academics' family-groups feature is off its guard
 * 404s the family lookup — this endpoint degrades to 404 FAMILY_NOT_FOUND
 * naturally.
 *
 * Three-way route registration (CLAUDE.md):
 *   1. This controller method (Nest) — DONE
 *   2. `tenant-api-prod.json` (API GW) — REQUIRED before deploy (FB-4.9
 *      packaging; out of this package's touch scope)
 *   3. `nginx.template` — no change; `^/finance` covers the prefix
 */

import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { buildRequestContext } from '../common/entities/base.entity';
import {
  FamilyBillingService,
  FamilyOpenInvoicesResponseDto,
  FamilySummaryResponseDto,
} from './family-billing.service';

@Controller('finance')
@UseGuards(JwtAuthGuard)
export class FamilyBillingController {
  constructor(private readonly familyBillingService: FamilyBillingService) {}

  @Get('schools/:schoolId/families/:familyId/open-invoices')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async getFamilyOpenInvoices(
    @Param('schoolId') schoolId: string,
    @Param('familyId') familyId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<FamilyOpenInvoicesResponseDto> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.familyBillingService.getFamilyOpenInvoices(schoolId, familyId, context);
  }

  /**
   * EPIC-FB FB-5.3 — family financial summary (read-side rollup: member
   * balances, open invoices, active-agreement pointer). Same 404/503
   * semantics and `billing:view` permission as the open-invoices sibling
   * route above; agreement terms are NOT exposed (id/title/status only).
   *
   * Three-way route registration: Nest (here) + `tenant-api-prod.json`
   * (orchestrator handles the API GW row after this package); nginx needs
   * nothing (existing `/finance` prefix block).
   */
  @Get('schools/:schoolId/families/:familyId/summary')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async getFamilySummary(
    @Param('schoolId') schoolId: string,
    @Param('familyId') familyId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<FamilySummaryResponseDto> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.familyBillingService.getFamilySummary(schoolId, familyId, context);
  }
}
