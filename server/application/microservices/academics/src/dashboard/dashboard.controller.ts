/**
 * Dashboard Controller
 *
 * GET /academics/dashboard/overview — aggregated overview data
 * for the Academics module landing page.
 */

import {
  Controller,
  Get,
  Query,
  UseGuards,
  UseInterceptors,
  Req,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import { DashboardService } from './dashboard.service';
import { DashboardOverviewDto } from './dashboard.dto';
import { RequestContext } from '../common/entities';
import { CacheTTL } from '../common/decorators/cache-ttl.decorator';
import { CacheHeaderInterceptor } from '../common/interceptors/cache-header.interceptor';

@Controller('academics/dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  private readonly logger = new Logger(DashboardController.name);

  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * Aggregated overview endpoint.
   * Returns enrollment summary, active sections count, and today's
   * attendance summary in a single response.
   *
   * GET /academics/dashboard/overview?schoolId=X&academicYearId=Y&date=Z
   */
  @Get('overview')
  @UseInterceptors(CacheHeaderInterceptor)
  @CacheTTL(60)
  async getOverview(
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('date') date: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<DashboardOverviewDto> {
    const context = this.buildContext(tenant, req);
    const start = Date.now();

    const result = await this.dashboardService.getOverview(
      schoolId,
      academicYearId,
      date,
      context,
    );

    this.logger.log(
      `Dashboard overview for school=${schoolId} completed in ${Date.now() - start}ms (cache=${result._cached ? 'HIT' : 'MISS'})`,
    );

    return result;
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
