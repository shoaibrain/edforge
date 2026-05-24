/**
 * StudentTimelineController — Sprint D.2.11
 *
 * `GET /academics/students/{studentId}/timeline?fromAyId=…&toAyId=…&limit=…`
 *
 * Returns every enrollment for a student across all academic years,
 * sorted ascending. The response is the primary read API for the
 * cross-year transcript UI and powers the operator's "did this student
 * actually flip?" investigation pattern.
 */

import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Req,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequestContext } from '../common/entities';
import {
  StudentTimelineService,
  StudentTimelineResponse,
} from './student-timeline.service';

@Controller('academics/students/:studentId/timeline')
@UseGuards(JwtAuthGuard)
export class StudentTimelineController {
  private readonly logger = new Logger(StudentTimelineController.name);

  constructor(private readonly service: StudentTimelineService) {}

  /**
   * GET /academics/students/:studentId/timeline
   *
   * Query params:
   *   - fromAyId  (optional) — filter by AY range (inclusive lower)
   *   - toAyId    (optional) — filter by AY range (inclusive upper)
   *   - limit     (optional) — page size; defaults to 50, max 200
   */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'students', action: 'view' })
  async getTimeline(
    @Param('studentId') studentId: string,
    @Query('fromAyId') fromAyId: string | undefined,
    @Query('toAyId') toAyId: string | undefined,
    @Query('limit') limitRaw: string | undefined,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<StudentTimelineResponse> {
    this.logger.log(
      `GET /academics/students/${studentId}/timeline fromAyId=${fromAyId ?? '*'} toAyId=${toAyId ?? '*'} limit=${limitRaw ?? '50'}`,
    );
    const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 50, 1), 200) : 50;
    const context = this.buildContext(tenant, req);
    return this.service.getTimeline({ studentId, fromAyId, toAyId, limit }, context);
  }

  private buildContext(tenant: TenantContext, req: Request): RequestContext {
    return {
      userId: tenant.userId,
      tenantId: tenant.tenantId,
      email: tenant.email,
      role: tenant.globalRole,
      jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
      username: tenant.username,
    };
  }
}
