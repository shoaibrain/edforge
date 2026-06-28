/**
 * BulkOpsController — Sprint D.3
 *
 * Houses the bulk-ops job read endpoint:
 *   GET /finance/jobs/:jobId  →  the FinanceJob row, or 404.
 *
 * Sprint E/F/G will add the POST submit endpoints (bulk-generate async,
 * bulk-pdf-export); this sprint is the foundation only.
 *
 * Auth shape — why JwtAuthGuard + manual checkPermission (not PermissionGuard):
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
 *   load the job, then evaluate authorization locally by calling identity's
 *   `checkPermission(userId, 'billing', 'view', job.schoolId)` — the exact
 *   same gate PermissionGuard would have applied, just deferred until after
 *   we know `job.schoolId`. This honors identity's real RBAC matrix
 *   (Teacher has school-role presence but NOT `billing:view`); a bare
 *   "operator has any role at that school" check would over-grant.
 *
 *   404-not-403 contract: missing row, cross-school row, AND
 *   `checkPermission`-denied row all return the same bare 404 with no
 *   body distinction. That makes jobIds non-enumerable across schools —
 *   an operator can't probe `/finance/jobs/<some-uuid>` to discover
 *   whether that jobId exists in someone else's school OR whether they
 *   lack `billing:view` for the holding school.
 *
 *   Identity-transport failure also fails closed to 404 (same shape as
 *   `IdentityClientService.checkPermission` itself, which returns
 *   `{ allowed:false }` after exhausting its retry budget — see
 *   `identity-client.service.ts`). No information leaks about identity
 *   health to the caller.
 *
 * No `schoolIdParam` on the route → nginx.template needs no change
 * (the existing `^/finance` location block covers this), per CLAUDE.md
 * §434-460. API Gateway spec is updated in `tenant-api-prod.json`.
 */

import {
  Controller,
  Get,
  Logger,
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
import { buildRequestContext } from '../common/entities/base.entity';
import type { FinanceJobEntity } from '../common/entities/finance-job.entity';

@Controller('finance/jobs')
@UseGuards(JwtAuthGuard)
export class BulkOpsController {
  private readonly logger = new Logger(BulkOpsController.name);

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

    // TenantAdmin bypasses checkPermission (consistent with
    // PermissionGuard's bypass at `canActivate` line 57). For everyone
    // else, evaluate `billing:view` against identity's RBAC matrix for
    // the JOB's school — the same gate PermissionGuard would have run
    // if we'd known the schoolId at request time. Translates allowed:false
    // OR identity transport failure to the SAME bare 404 as missing /
    // cross-school. Preserves the non-enumerability contract while
    // honoring the real role→permission matrix (Teacher has no billing:view).
    if (tenant?.globalRole !== 'TenantAdmin') {
      let allowed = false;
      try {
        const result = await this.identityClient.checkPermission(
          context.userId,
          'billing',
          'view',
          job.schoolId,
          context,
        );
        allowed = result?.allowed === true;
      } catch (err) {
        // Fail-closed on transport failure — same 404 as a deny. Log
        // for ops visibility (the only difference between a deny and a
        // failure is server-side log signal, never response shape).
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `BulkOpsController.getJob checkPermission threw for jobId=${jobId} ` +
            `schoolId=${job.schoolId} userId=${context.userId}: ${message.slice(0, 200)}`,
        );
        allowed = false;
      }
      if (!allowed) {
        throw new NotFoundException();
      }
    }

    return job;
  }
}
