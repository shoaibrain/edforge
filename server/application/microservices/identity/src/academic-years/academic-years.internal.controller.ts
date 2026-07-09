/**
 * Academic Years — INTERNAL service-to-service read.
 *
 * Finance resolves the sibling-discount academic-year LABEL→id by listing a
 * school's academic years (BH-1.4). The operator-facing route
 * (`GET /schools/:schoolId/academic-years`) is
 * `@RequirePermission('scheduling','view')`; the Accountant billing role and
 * the enrollment-webhook context lack that permission, so the operator route
 * 403s and finance's AY-scoping degrades to unscoped for them.
 *
 * AY resolution for billing is INTERNAL logic, not an operator action — so
 * this route authenticates the *caller service* via `x-internal-api-key`
 * (InternalApiKeyGuard) and SKIPS the operator permission gate. It returns the
 * exact same rows as the operator route by calling the SAME service method.
 *
 * The tenant-scoped DDB credentials still come from the forwarded operator JWT
 * (Authorization header → TokenVendingMachine), so no ABAC widening is needed:
 * the internal key only removes the scheduling:view permission requirement, it
 * does not change which tenant's data the caller can read.
 *
 * Not fronted by API Gateway (path is under `/internal`, Service Connect mesh
 * only) — hence exempt from the route-drift linter and classified `internal`
 * by the authz-coverage audit.
 */

import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AcademicYearsService } from './academic-years.service';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';
import type { AcademicYearListResponseDto } from '@aibrains/shared-types';
import { RequestContext } from '../common/entities';

@Controller('internal/schools/:schoolId/academic-years')
@UseGuards(InternalApiKeyGuard)
export class AcademicYearsInternalController {
  constructor(private readonly academicYearsService: AcademicYearsService) {}

  @Get()
  async listAcademicYears(
    @Param('schoolId') schoolId: string,
    @Query('limit') limit: string,
    @Req() req: Request,
  ): Promise<AcademicYearListResponseDto> {
    const context = this.buildContext(req);
    const result = await this.academicYearsService.listAcademicYears(
      schoolId,
      context,
      limit ? parseInt(limit, 10) : 20,
    );
    return {
      items: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * There is no JwtAuthGuard on this route, so `@TenantCredentials()` is not
   * populated. The calling service's HttpClient forwards the operator identity
   * as headers (Authorization / X-Tenant-Id / X-User-Id / X-User-Role); the JWT
   * is required for the TokenVendingMachine to vend tenant-scoped DDB creds.
   */
  private buildContext(req: Request): RequestContext {
    const authHeader = (req.headers['authorization'] as string) || '';
    const jwtToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const role = (req.headers['x-user-role'] as string) || '';
    return {
      userId: (req.headers['x-user-id'] as string) || 'system',
      tenantId: (req.headers['x-tenant-id'] as string) || '',
      email: '',
      // listAcademicYears reads only tenantId + jwtToken; globalRole is carried
      // for shape-completeness. Trust the forwarded header only when it's a
      // real GlobalRole, else least-privilege.
      globalRole: role === 'TenantAdmin' ? 'TenantAdmin' : 'TenantUser',
      jwtToken,
    };
  }
}
