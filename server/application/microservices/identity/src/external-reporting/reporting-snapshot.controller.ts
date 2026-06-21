/**
 * ReportingSnapshot Controller — Sprint E.1.4 + E.1.5
 *
 * Operator-facing API for CEHRD IEMIS Flash I/II report submissions.
 *
 * Routes (all under JwtAuthGuard; ABAC enforced at service via tenant
 * scoping from JWT claims):
 *
 *   POST   /reporting/snapshots               — create + trigger Lambda (E.1.4)
 *   POST   /reporting/snapshots/preflight     — sync validation (E.1.5)
 *   GET    /reporting/snapshots               — list a school's snapshots
 *   GET    /reporting/snapshots/:snapshotId   — read state
 *   GET    /reporting/snapshots/:snapshotId/download — presigned CSV URL
 *   PATCH  /reporting/snapshots/:snapshotId/transition — Lambda + operator UI
 *
 * Three-way handoff:
 *   - Nest controller (this file) ✓
 *   - server/lib/tenant-api-prod.json — new `/reporting/snapshots*` paths
 *   - server/application/reverseproxy/nginx.template — new `^/reporting` block
 */

import {
  BadRequestException,
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
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import { RequireGlobalRole } from '../common/decorators/require-global-role.decorator';
import { GlobalRoleGuard } from '../common/guards/global-role.guard';
import {
  createReportingSnapshotSchema,
  listReportingSnapshotsQuerySchema,
  preflightReportingSnapshotSchema,
  transitionReportingSnapshotSchema,
  type CreateReportingSnapshotDto,
  type ListReportingSnapshotsQueryDto,
  type ListReportingSnapshotsResponseDto,
  type PreflightReportingSnapshotDto,
  type PreflightReportingSnapshotResponseDto,
  type ReportingSnapshotDownloadResponseDto,
  type ReportingSnapshotResponseDto,
  type TransitionReportingSnapshotDto,
} from '@aibrains/shared-types';
import { ReportingSnapshotService } from './reporting-snapshot.service';
import { RequestContext } from '../common/entities';

@Controller('reporting/snapshots')
@UseGuards(JwtAuthGuard)
export class ReportingSnapshotController {
  constructor(private readonly svc: ReportingSnapshotService) {}

  /** POST /reporting/snapshots — Sprint E.1.4 */
  @Post()
  @RequireGlobalRole('TenantAdmin')
  @UseGuards(GlobalRoleGuard)
  async create(
    @Body() body: unknown,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<ReportingSnapshotResponseDto> {
    const parsed = createReportingSnapshotSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        errorCode: 'BAD_REQUEST',
        message: 'Invalid create-snapshot payload',
        details: parsed.error.flatten(),
      });
    }
    return this.svc.createSnapshot(
      parsed.data as CreateReportingSnapshotDto,
      this.buildContext(tenant, req),
    );
  }

  /** POST /reporting/snapshots/preflight — Sprint E.1.5 */
  @Post('preflight')
  @RequireGlobalRole('TenantAdmin')
  @UseGuards(GlobalRoleGuard)
  async preflight(
    @Body() body: unknown,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<PreflightReportingSnapshotResponseDto> {
    const parsed = preflightReportingSnapshotSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        errorCode: 'BAD_REQUEST',
        message: 'Invalid preflight payload',
        details: parsed.error.flatten(),
      });
    }
    return this.svc.preflightSnapshot(
      parsed.data as PreflightReportingSnapshotDto,
      this.buildContext(tenant, req),
    );
  }

  /** GET /reporting/snapshots?schoolId=&templateId=&academicYearBs=&status= */
  @Get()
  async list(
    @Query() query: Record<string, string>,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<ListReportingSnapshotsResponseDto> {
    const parsed = listReportingSnapshotsQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        errorCode: 'BAD_REQUEST',
        message: 'Invalid list-snapshots query',
        details: parsed.error.flatten(),
      });
    }
    return this.svc.listSnapshots(
      parsed.data as ListReportingSnapshotsQueryDto,
      this.buildContext(tenant, req),
    );
  }

  /** GET /reporting/snapshots/:snapshotId/download?schoolId= */
  @Get(':snapshotId/download')
  async download(
    @Param('snapshotId') snapshotId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<ReportingSnapshotDownloadResponseDto> {
    if (!schoolId) {
      throw new BadRequestException({
        errorCode: 'SCHOOL_ID_REQUIRED',
        message: 'Query param `schoolId` is required.',
      });
    }
    return this.svc.getSnapshotDownloadUrl(
      snapshotId,
      schoolId,
      this.buildContext(tenant, req),
    );
  }

  /** GET /reporting/snapshots/:snapshotId?schoolId= */
  @Get(':snapshotId')
  async read(
    @Param('snapshotId') snapshotId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<ReportingSnapshotResponseDto> {
    if (!schoolId) {
      throw new BadRequestException({
        errorCode: 'SCHOOL_ID_REQUIRED',
        message: 'Query param `schoolId` is required.',
      });
    }
    return this.svc.getSnapshot(snapshotId, schoolId, this.buildContext(tenant, req));
  }

  /** PATCH /reporting/snapshots/:snapshotId/transition?schoolId= */
  @Patch(':snapshotId/transition')
  @RequireGlobalRole('TenantAdmin')
  @UseGuards(GlobalRoleGuard)
  async transition(
    @Param('snapshotId') snapshotId: string,
    @Query('schoolId') schoolId: string,
    @Body() body: unknown,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<ReportingSnapshotResponseDto> {
    if (!schoolId) {
      throw new BadRequestException({
        errorCode: 'SCHOOL_ID_REQUIRED',
        message: 'Query param `schoolId` is required.',
      });
    }
    const parsed = transitionReportingSnapshotSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        errorCode: 'BAD_REQUEST',
        message: 'Invalid transition payload',
        details: parsed.error.flatten(),
      });
    }
    return this.svc.transitionSnapshot(
      snapshotId,
      schoolId,
      parsed.data as TransitionReportingSnapshotDto,
      this.buildContext(tenant, req),
    );
  }

  // ---- helpers ----

  private buildContext(tenant: TenantContext, req: Request): RequestContext {
    return {
      userId: tenant.userId,
      tenantId: tenant.tenantId,
      email: tenant.email,
      globalRole: tenant.globalRole,
      jwtToken: (req.headers.authorization || '').replace(/^Bearer\s+/i, ''),
    };
  }
}
