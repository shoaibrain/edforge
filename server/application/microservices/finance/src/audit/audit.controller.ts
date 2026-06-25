/**
 * FinanceAuditController — Sprint 0.3
 *
 * Read endpoint for the finance bulk-export audit trail. Operators with
 * the `billing:view` permission can query the events emitted by the
 * bulk-export workflows (Sprints F/G land the emitters).
 *
 * `GET /finance/audit/bulk-export?from=&to=&schoolId=&operatorId=&eventType=&limit=&cursor=`
 *
 * Tenant-scoped: PK is always the caller's tenantId; the JWT guarantees
 * tenant isolation. Within-tenant ABAC narrowing (e.g. school operators
 * who should only see their own school) is enforced by the optional
 * `schoolIdParam` on the permission decorator pattern in V1 we lean on
 * the operator passing `schoolId` explicitly as a query filter; tighter
 * scoping is a follow-up once the bulk-export emitters land and we
 * know which operator roles need to read this.
 */

import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { FinanceAuditService } from '../common/services/finance-audit.service';
import {
  buildRequestContext,
  PaginatedResult,
} from '../common/entities/base.entity';
import {
  FinanceAuditEventEntity,
  FinanceAuditEventType,
} from '../common/entities/finance-audit-event.entity';

@Controller('finance/audit')
@UseGuards(JwtAuthGuard)
export class FinanceAuditController {
  constructor(private readonly financeAuditService: FinanceAuditService) {}

  @Get('bulk-export')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view' })
  async listBulkExportEvents(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('schoolId') schoolId: string,
    @Query('operatorId') operatorId: string,
    @Query('eventType') eventType: string,
    @Query('limit') limit: string,
    @Query('cursor') cursor: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<PaginatedResult<FinanceAuditEventEntity>> {
    const context = buildRequestContext(tenant, req);
    return this.financeAuditService.list(
      {
        from: from || undefined,
        to: to || undefined,
        schoolId: schoolId || undefined,
        operatorId: operatorId || undefined,
        eventType: (eventType as FinanceAuditEventType) || undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
        cursor: cursor || undefined,
      },
      context,
    );
  }
}
