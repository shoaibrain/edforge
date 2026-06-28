/**
 * BulkOpsController — Sprint D.3
 *
 * Houses the bulk-ops job read endpoint:
 *   GET /finance/jobs/:jobId  →  the FinanceJob row, or 404.
 *
 * Sprint E/F/G will add the POST submit endpoints (bulk-generate async,
 * bulk-pdf-export); this sprint is the foundation only.
 *
 * Auth shape — why JwtAuthGuard + manual scope check (not PermissionGuard):
 *
 *   The route is `/finance/jobs/:jobId` — there is NO `schoolId` in the
 *   URL because we don't want to leak which schools have jobs running
 *   to operators who don't already know the jobId. The school is on the
 *   entity itself.
 *
 *   PermissionGuard requires a schoolId to evaluate `billing:view` for a
 *   non-TenantAdmin operator (it throws 400 if no schoolId is on the
 *   request — see `PermissionGuard.canActivate`). So we'd have to ALWAYS
 *   pass through (TenantAdmin path) OR fail the request before we even
 *   load the job, which forecloses the 404-not-403 contract.
 *
 *   Instead we run JwtAuthGuard (tenant isolation enforced by the JWT),
 *   load the job, then evaluate scope locally:
 *     - TenantAdmin: see anything in the tenant.
 *     - Otherwise: must have a role at the job's schoolId (resolved via
 *       `identityClient.getUserRole(userId, schoolId, ctx)`). The
 *       getUserRole call also serves as the `billing:view` proxy — if
 *       the operator has any role at that school, they hold the
 *       finance read permission in the V1 RBAC matrix; tighter
 *       resource-level filtering can layer on later.
 *
 *   404-not-403 contract: both "row doesn't exist" and "row exists but
 *   not in your scope" return the same 404 with no body distinction.
 *   This is what makes jobIds non-enumerable across schools — an
 *   operator can't probe `/finance/jobs/<some-uuid>` to discover whether
 *   that jobId exists in someone else's school.
 *
 * No `schoolIdParam` on the route → nginx.template needs no change
 * (the existing `^/finance` location block covers this), per CLAUDE.md
 * §434-460. API Gateway spec is updated in `tenant-api-prod.json`.
 */

import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials } from '@app/auth';
import { FinanceJobsService } from './finance-jobs.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import {
  buildRequestContext,
  RequestContext,
} from '../common/entities/base.entity';
import type { FinanceJobEntity } from '../common/entities/finance-job.entity';

@Controller('finance/jobs')
@UseGuards(JwtAuthGuard)
export class BulkOpsController {
  constructor(
    private readonly jobsService: FinanceJobsService,
    private readonly identityClient: IdentityClientService,
  ) {}

  @Get(':jobId')
  async getJob(
    @Param('jobId') jobId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<FinanceJobEntity> {
    const context = buildRequestContext(tenant, req);
    const job = await this.jobsService.get(jobId, context);

    if (!job) {
      // Missing row — 404 is the only honest answer (no leak of "exists
      // but not yours" vs "doesn't exist").
      throw new NotFoundException();
    }

    const inScope = await this.operatorHasSchoolScope(
      tenant,
      job.schoolId,
      context,
    );
    if (!inScope) {
      // Same 404 — cross-school access returns identical response to
      // missing row. This is the 404-not-403 contract.
      throw new NotFoundException();
    }

    return job;
  }

  /**
   * Resolve whether the calling operator can read jobs at `schoolId`.
   *
   * TenantAdmin bypasses (consistent with PermissionGuard's bypass at
   * `canActivate` line 57). Any other role with a school-membership row
   * for `schoolId` passes — V1 RBAC treats per-school role presence as
   * the `billing:view` predicate; tighter resource-level checks can
   * layer on without changing this gate.
   *
   * On identity-service failure we fail-closed (return false / 404) —
   * same shape as `getLinkedStudentIds` which returns empty on lookup
   * failure so the caller denies access.
   */
  private async operatorHasSchoolScope(
    tenant: { globalRole?: string },
    schoolId: string,
    context: RequestContext,
  ): Promise<boolean> {
    if (tenant.globalRole === 'TenantAdmin') return true;
    try {
      const roleResult = await this.identityClient.getUserRole(
        context.userId,
        schoolId,
        context,
      );
      return !!roleResult?.role;
    } catch {
      return false;
    }
  }
}
