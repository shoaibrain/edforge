import {
  Controller,
  Get,
  Param, Query,
  UseGuards, Req,
} from '@nestjs/common';
import { Request } from 'express';
import { StudentAccountsService } from './student-accounts.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { IdentityClientService } from '../common/services/identity-client.service';
import { buildRequestContext } from '../common/entities/base.entity';
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
