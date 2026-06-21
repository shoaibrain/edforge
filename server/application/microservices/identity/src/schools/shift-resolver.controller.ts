/**
 * Shift Resolver Controller — pilot greenlight C2.2.
 *
 * Single GET endpoint that returns the 5-way day classification for a given
 * school + AD date. Backed by `ShiftResolverService`, which reads the
 * existing CalendarDate row and reduces it via `classifyShiftFromCalendarDate`.
 *
 * Routes
 * ------
 *   GET /schools/:schoolId/shift-profile?date=YYYY-MM-DD
 *
 * Three-way route registration (per repo invariant):
 *   ✓ NestJS controller (this file)
 *   ✓ server/lib/tenant-api-prod.json (sibling PR change)
 *   - nginx: existing /schools prefix block covers it (no change needed)
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
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequestContext } from '../common/entities';
import {
  ShiftResolverService,
  ShiftProfileResponse,
} from './shift-resolver.service';

@Controller('schools/:schoolId/shift-profile')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ShiftResolverController {
  constructor(private readonly shiftResolverService: ShiftResolverService) {}

  /**
   * Resolve the shift profile for a single date.
   *
   * Response: { date, classification, isInstructionalDay, dayOfWeek,
   *             bellScheduleId?, bellScheduleName?, reason }
   *
   * 404 if no CalendarDate row exists for the date (calendar not yet
   * generated for the AY covering this date).
   */
  @Get()
  @RequirePermission({ resource: 'scheduling', action: 'view', schoolIdParam: 'schoolId' })
  async getShiftProfile(
    @Param('schoolId') schoolId: string,
    @Query('date') date: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<ShiftProfileResponse> {
    if (!date) {
      throw new BadRequestException(
        'Missing required query parameter: date=YYYY-MM-DD',
      );
    }
    // Strict ISO YYYY-MM-DD shape — defensive validation here so the
    // service layer can trust the format.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException(
        `Invalid date format: "${date}" — expected YYYY-MM-DD (AD)`,
      );
    }

    const context = this.buildContext(tenant, req);
    return this.shiftResolverService.resolve(schoolId, date, context);
  }

  private buildContext(tenant: TenantContext, req: Request): RequestContext {
    return {
      userId: tenant.userId,
      tenantId: tenant.tenantId,
      email: tenant.email,
      globalRole: tenant.globalRole,
      jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
      username: tenant.username,
    };
  }
}
