/**
 * IEMIS Controller (Sprint 1)
 *
 * Tenant-wide IEMIS operations gated by `@RequireIemisPermission()`:
 *   - GET /iemis/verify-school-code/:code  (S1.5) — format validator
 *   - GET /iemis/audit                      (S1.10) — read-only log
 *
 * Every hit emits an audit event via `IemisAuditLogger` so operator
 * reads and denied attempts alike land in the append-only log.
 *
 * Future sprints hang more endpoints off the same controller:
 *   - Sprint 8:  POST /iemis/import, GET /iemis/jobs/:id
 *   - Sprint 10: POST /iemis/export, GET /iemis/exports/:id
 */

import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import {
  IemisPermission,
  isValidIemisSchoolCode,
  parseIemisAuditEntityKey,
  type IemisAuditEvent,
  type IemisAuditEventType,
} from '@aibrains/shared-types';
import { RequireIemisPermission } from '../common/decorators/require-iemis-permission.decorator';
import { IemisPermissionGuard } from '../common/guards/iemis-permission.guard';
import { IemisAuditLogger } from '../common/services/iemis-audit-logger.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { redactAuditEventForRole } from './iemis-audit-redact';

interface VerifySchoolCodeResponse {
  code: string;
  valid: boolean;
  reason?: string;
}

interface IemisAuditListResponse {
  items: IemisAuditEvent[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
}

@Controller('iemis')
export class IemisController {
  constructor(
    private readonly auditLogger: IemisAuditLogger,
    private readonly dynamoDBClient: DynamoDBClientService,
  ) {}

  /**
   * GET /iemis/verify-school-code/:code — S1.5
   *
   * Format-only validation today (there is no public CEHRD lookup API).
   * Returns `{ valid, reason? }` so the UI can rely on a stable contract
   * when a real registry integration replaces the body of this method
   * later.
   *
   * Every hit emits an audit event. A denied attempt (wrong role / no
   * JWT) emits `code.verify.denied` via the guard-level logging — this
   * method emits `code.verified` on success.
   */
  @Get('verify-school-code/:code')
  @UseGuards(JwtAuthGuard, IemisPermissionGuard)
  @RequireIemisPermission(IemisPermission.VerifyCode)
  async verifySchoolCode(
    @Param('code') code: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<VerifySchoolCodeResponse> {
    const valid = isValidIemisSchoolCode(code);

    // Emit audit regardless — an invalid-format query is still a
    // meaningful operator action that belongs in the log.
    const jwt = req.headers.authorization?.replace('Bearer ', '') || '';
    await this.auditLogger.emit(
      {
        eventType: 'code.verified',
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        actorName: tenant.username,
        ipAddress: req.ip,
        metadata: {
          code,
          valid,
        },
      },
      jwt,
    );

    return valid
      ? { code, valid: true }
      : {
          code,
          valid: false,
          reason:
            'IEMIS School Code must be 8–10 digits (digits only, no spaces or dashes).',
        };
  }

  /**
   * GET /iemis/audit — S1.10
   *
   * Paginated, reverse-chronological list of IEMIS audit events for the
   * caller's tenant. TenantAdmin sees raw metadata; other roles see
   * PII fields masked per `redactAuditEventForRole`.
   *
   * Query params:
   *   - limit: 1..200 (default 50)
   *   - cursor: opaque pagination token from a previous response
   *   - eventType: optional filter (e.g. `code.verified`)
   */
  @Get('audit')
  @UseGuards(JwtAuthGuard, IemisPermissionGuard)
  @RequireIemisPermission(IemisPermission.ViewAudit)
  async listAuditEvents(
    @Query('limit') limitRaw: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('eventType') eventType: string | undefined,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<IemisAuditListResponse> {
    const limit = clampLimit(limitRaw, 50, 200);
    const jwt = req.headers.authorization?.replace('Bearer ', '') || '';
    const client = await this.dynamoDBClient.getClient(tenant.tenantId, jwt);

    const filterExpr = eventType ? '#et = :et' : undefined;
    const filterValues = eventType ? { ':et': eventType } : undefined;
    const filterNames = eventType ? { '#et': 'eventType' } : undefined;

    const result = await this.dynamoDBClient.query<any>(
      client,
      tenant.tenantId,
      'AUDIT#IEMIS#',
      filterExpr,
      filterValues,
      filterNames,
      limit,
      cursor ? JSON.parse(Buffer.from(cursor, 'base64').toString()) : undefined,
    );

    // Read-of-audit is itself an auditable action (defense in depth +
    // DSAR traceability in Sprint 13). Emit before we return so a late
    // failure doesn't skip the write.
    await this.auditLogger.emit(
      {
        eventType: 'audit.viewed',
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        actorName: tenant.username,
        ipAddress: req.ip,
        metadata: {
          count: result.items.length,
          filter: { eventType: eventType ?? null, limit },
        },
      },
      jwt,
    );

    // Shape DDB rows → response events. Derive timestamp + eventId from
    // the SK when attributes aren't redundantly stored (DynamoDB item
    // itself DOES carry both, so this is defensive — not required).
    const viewerRole = tenant.globalRole ?? 'TenantUser';
    const items = result.items.map((row) => {
      const fromKey = parseIemisAuditEntityKey(row.entityKey ?? '');
      const event: IemisAuditEvent = {
        eventType: row.eventType as IemisAuditEventType,
        tenantId: row.tenantId,
        schoolId: row.schoolId,
        actorUserId: row.actorUserId,
        actorName: row.actorName,
        ipAddress: row.ipAddress,
        metadata: row.metadata,
        eventId: row.eventId ?? fromKey?.eventId ?? '',
        timestamp: row.timestamp ?? fromKey?.timestamp ?? row.createdAt ?? '',
      };
      return redactAuditEventForRole(event, viewerRole);
    });

    return {
      items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }
}

function clampLimit(raw: string | undefined, dflt: number, max: number): number {
  if (!raw) return dflt;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    throw new BadRequestException('`limit` must be a positive integer');
  }
  return Math.min(Math.floor(n), max);
}
