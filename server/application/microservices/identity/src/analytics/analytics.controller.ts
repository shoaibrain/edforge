/**
 * Layer 7 — Analytics read-path controller.
 *
 * Five endpoints under the identity service:
 *   GET  /analytics/tenants/:tenantId
 *   GET  /analytics/tenants/:tenantId/adoption-report
 *   GET  /analytics/fleet
 *   GET  /me/session-history
 *   GET  /analytics/tenants/:tenantId/export.csv
 *
 * Authz philosophy — two layers, on EVERY read path:
 *   (a) Controller authz from JWT claims (TenantContext).
 *   (b) DDB query PK scoped on server-validated tenantId / userId.
 *
 * No endpoint builds a PK from a path/body value without first proving it
 * matches the JWT tenant. `/analytics/fleet` is SystemAdmin-only; for V1
 * we gate on `SYSTEM_ADMIN_EMAILS` env var since the identity JWT has no
 * SystemAdmin role enum.
 */

import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Req,
  Res,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import {
  AnalyticsService,
  type Granularity,
  type FleetSummary,
  type AdoptionReport,
  type MetricSeries,
  type SessionHistoryEvent,
} from './analytics.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { EntityKeyBuilder } from '../common/entities/base.entity';
import type { Tenant } from '../common/entities/tenant.entity';

const MAX_RANGE_DAYS = 365;

@Controller()
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly dynamoDB: DynamoDBClientService,
  ) {}

  /**
   * 7.1 — GET /analytics/tenants/:tenantId
   * Query: from=yyyy-mm-dd, to=yyyy-mm-dd, granularity=day|week|month
   */
  @Get('analytics/tenants/:tenantId')
  async getTenantSeries(
    @Param('tenantId') tenantId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('granularity') granularity: string,
    @TenantCredentials() tenant: TenantContext,
  ): Promise<MetricSeries[]> {
    this.requireOwnTenantOrSystemAdmin(tenant, tenantId);
    this.validateDateRange(from, to);
    const gran = this.validateGranularity(granularity);
    return this.analytics.getTenantTimeSeries(tenantId, from, to, gran);
  }

  /**
   * 7.2 — GET /analytics/tenants/:tenantId/adoption-report?week=yyyy-Www
   */
  @Get('analytics/tenants/:tenantId/adoption-report')
  async getAdoptionReport(
    @Param('tenantId') tenantId: string,
    @Query('week') week: string,
    @TenantCredentials() tenant: TenantContext,
  ): Promise<AdoptionReport> {
    this.requireOwnTenantOrSystemAdmin(tenant, tenantId);
    if (!/^\d{4}-W\d{2}$/.test(week || '')) {
      throw new BadRequestException('week must be in yyyy-Www format');
    }
    const provisionedAt = await this.lookupTenantProvisionedAt(tenantId);
    return this.analytics.getAdoptionReport(tenantId, week, provisionedAt);
  }

  /**
   * 7.3 — GET /analytics/fleet (SystemAdmin only)
   */
  @Get('analytics/fleet')
  async getFleet(
    @Query('from') from: string,
    @Query('to') to: string,
    @TenantCredentials() tenant: TenantContext,
  ): Promise<FleetSummary> {
    this.requireSystemAdmin(tenant);
    this.validateDateRange(from, to);
    return this.analytics.getFleetSummary(from, to);
  }

  /**
   * 7.4 — GET /me/session-history?days=30
   *
   * Always scoped to JWT sub. No tenantId in response (not needed by the
   * end user and leaks cross-tenant info if misconfigured).
   */
  @Get('me/session-history')
  async getMySessionHistory(
    @Query('days') daysStr: string,
    @TenantCredentials() tenant: TenantContext,
  ): Promise<SessionHistoryEvent[]> {
    const days = daysStr ? Number.parseInt(daysStr, 10) : 30;
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      throw new BadRequestException('days must be an integer between 1 and 365');
    }
    return this.analytics.getSessionHistory(tenant.userId, days);
  }

  /**
   * 7.5 — GET /analytics/tenants/:tenantId/export.csv
   * Streamed CSV response; chunked writes via AsyncGenerator.
   */
  @Get('analytics/tenants/:tenantId/export.csv')
  async exportCsv(
    @Param('tenantId') tenantId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('granularity') granularity: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    this.requireOwnTenantOrSystemAdmin(tenant, tenantId);
    this.validateDateRange(from, to);
    const gran = this.validateGranularity(granularity);

    const filename = `analytics-${tenantId}-${from}-${to}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    void req; // retained for future: correlationId header injection

    for await (const chunk of this.analytics.streamExportCsv(
      tenantId,
      from,
      to,
      gran,
    )) {
      res.write(chunk);
    }
    res.end();
  }

  // ============================================================
  // Authz helpers
  // ============================================================

  /** SystemAdmin OR tenant-owned access. Throws 403 otherwise. */
  private requireOwnTenantOrSystemAdmin(
    tenant: TenantContext,
    pathTenantId: string,
  ): void {
    if (this.isSystemAdmin(tenant)) return;
    if (tenant.tenantId !== pathTenantId) {
      throw new ForbiddenException(
        'Cannot read analytics for a different tenant',
      );
    }
  }

  private requireSystemAdmin(tenant: TenantContext): void {
    if (!this.isSystemAdmin(tenant)) {
      throw new ForbiddenException('SystemAdmin required');
    }
  }

  private isSystemAdmin(tenant: TenantContext): boolean {
    // The identity-service JWT has only TenantAdmin/TenantUser globalRole.
    // For V1, SystemAdmin is established via `SYSTEM_ADMIN_EMAILS` env var
    // (comma-separated lower-case emails). The ControlPlane's real
    // SystemAdmin concept lives in SBT; a future migration will route
    // SystemAdmin requests through the SBT control-plane API directly.
    const allow = (process.env.SYSTEM_ADMIN_EMAILS || '')
      .toLowerCase()
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    return allow.includes((tenant.email || '').toLowerCase());
  }

  // ============================================================
  // Query param validation
  // ============================================================

  private validateDateRange(from: string, to: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '')) {
      throw new BadRequestException('from must be yyyy-mm-dd');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to || '')) {
      throw new BadRequestException('to must be yyyy-mm-dd');
    }
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    if (end < start) {
      throw new BadRequestException('to cannot be before from');
    }
    const rangeDays = (end.getTime() - start.getTime()) / 86400_000;
    if (rangeDays > MAX_RANGE_DAYS) {
      throw new BadRequestException(`Maximum range is ${MAX_RANGE_DAYS} days`);
    }
  }

  private validateGranularity(g: string): Granularity {
    if (g !== 'day' && g !== 'week' && g !== 'month') {
      throw new BadRequestException(
        'granularity must be one of: day, week, month',
      );
    }
    return g;
  }

  // ============================================================
  // Tenant lookup (for grace-period calculation in adoption report)
  // ============================================================

  private async lookupTenantProvisionedAt(tenantId: string): Promise<string> {
    const client = this.dynamoDB.getSystemClient();
    const tenant = await this.dynamoDB.getItem<Tenant>(
      client,
      tenantId,
      EntityKeyBuilder.tenantMetadata(),
    );
    if (!tenant) {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }
    return tenant.createdAt || '';
  }
}
