import {
  Body,
  Controller,
  Get,
  Param, Put, Query,
  UseGuards, Req,
} from '@nestjs/common';
import { Request } from 'express';
import { StudentAccountsService } from './student-accounts.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { IdentityClientService } from '../common/services/identity-client.service';
import { Idempotent } from '../common/interceptors/idempotent.interceptor';
import { SetOpeningBalanceDtoZ } from '../common/dto/zod-dtos';
import { buildRequestContext } from '../common/entities/base.entity';
import { billingAccountEntityToDto } from '../common/mappers/billing-account.mapper';
import type { BillingAccount, StudentLedgerEntry } from '@aibrains/shared-types';

@Controller('finance/schools/:schoolId/student-accounts')
@UseGuards(JwtAuthGuard)
export class StudentAccountsController {
  constructor(
    private readonly studentAccountsService: StudentAccountsService,
    private readonly identityClient: IdentityClientService,
  ) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async list(
    @Param('schoolId') schoolId: string,
    @Query('searchTerm') searchTerm: string,
    @Query('hasOutstandingBalance') hasOutstandingBalance: string,
    @Query('limit') limit: string,
    @Query('cursor') cursor: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<{ items: BillingAccount[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.studentAccountsService.list(schoolId, context, {
      searchTerm,
      hasOutstandingBalance: hasOutstandingBalance === 'true' ? true : undefined,
      limit: limit ? parseInt(limit, 10) : 50,
      cursor,
    });
  }

  @Get(':accountId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async get(
    @Param('schoolId') schoolId: string,
    @Param('accountId') accountId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<BillingAccount> {
    const context = buildRequestContext(tenant, req, schoolId);
    const account = await this.studentAccountsService.getByAccountId(schoolId, accountId, context);

    // Entity-level ownership enforcement
    await this.identityClient.enforceStudentOwnership(account.studentId, schoolId, context);

    return account;
  }

  /**
   * Pilot Onboarding Hardening Sprint PD.1.5 — set / revise the
   * opening balance (carry-forward of money owed prior to EdForge).
   *
   *   PUT /finance/schools/:schoolId/student-accounts/:accountId/opening-balance
   *
   * - Permission: billing:manage (scoped to the URL's schoolId)
   * - Idempotent: replays the original response for repeat
   *   submissions with the same `Idempotency-Key` header
   * - Cross-school access: 404 (NOT 403) per the established
   *   contract (per CLAUDE.md — UUIDs aren't enumerable across
   *   schools by design); the service's `BILLING_ACCOUNT_NOT_FOUND`
   *   path surfaces here
   * - Validation: body parsed by the global ZodValidationPipe
   *   against `setOpeningBalanceSchema`; service performs defensive
   *   re-validation for internal callers
   */
  @Put(':accountId/opening-balance')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'manage', schoolIdParam: 'schoolId' })
  @Idempotent()
  async setOpeningBalance(
    @Param('schoolId') schoolId: string,
    @Param('accountId') accountId: string,
    @Body() dto: SetOpeningBalanceDtoZ,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<BillingAccount> {
    const context = buildRequestContext(tenant, req, schoolId);

    // Cross-school 404 contract: service throws NOT_FOUND for
    // accounts that don't exist OR exist in another school the
    // operator can't see. Permission guard handles the deny case;
    // the service handles the wrong-school case symmetrically.
    const result = await this.studentAccountsService.setOpeningBalance(
      accountId,
      dto.amount,
      dto.asOf,
      dto.note,
      context,
    );

    // PD.1.6 mapper passes through opening-balance fields + computes
    // openingBalanceRemaining. In PD.1 no settlements exist yet, so
    // remaining = openingBalance. PD.2 enriches with the settled
    // amount via the optional 2nd arg.
    return billingAccountEntityToDto(result.account);
  }

  @Get(':accountId/ledger')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async getLedger(
    @Param('schoolId') schoolId: string,
    @Param('accountId') accountId: string,
    @Query('limit') limit: string,
    @Query('cursor') cursor: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<{ items: StudentLedgerEntry[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    const context = buildRequestContext(tenant, req, schoolId);

    // Enforce ownership: get the account to check studentId
    const account = await this.studentAccountsService.getByAccountId(schoolId, accountId, context);
    await this.identityClient.enforceStudentOwnership(account.studentId, schoolId, context);

    return this.studentAccountsService.getLedger(accountId, context, {
      limit: limit ? parseInt(limit, 10) : 50,
      cursor,
    });
  }
}
