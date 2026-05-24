/**
 * PromotionBatchController — Sprint D.2.5 + D.2.6
 *
 * Two POST endpoints for the cross-year promotion workflow:
 *   - D.2.5 evaluate: read-only suggestion-list
 *   - D.2.6 commit:   atomic apply via chunked TransactWriteItems
 *
 * Three-way handoff (per CLAUDE.md): controller (here) + API GW spec
 * (tenant-api-prod.json) + nginx `^/academics` (existing prefix).
 */

import {
  Controller,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequestContext } from '../common/entities';
import { PromotionBatchService } from './promotion-batch.service';
import { PromotionCommitService } from './promotion-commit.service';
import {
  PromotionEvaluationRequestDtoZ,
  PromotionCommitRequestDtoZ,
} from '../common/dto/zod-dtos';
import type {
  PromotionEvaluationResponseDto,
  PromotionCommitResponseDto,
} from '@aibrains/shared-types';

@Controller('academics/schools/:schoolId/academic-years/:fromAyId')
@UseGuards(JwtAuthGuard)
export class PromotionBatchController {
  private readonly logger = new Logger(PromotionBatchController.name);

  constructor(
    private readonly batchService: PromotionBatchService,
    private readonly commitService: PromotionCommitService,
  ) {}

  /**
   * POST /academics/schools/:schoolId/academic-years/:fromAyId/promote-from?targetAyId=…&gradeLevel=…
   *
   * Evaluates every enrollment in (schoolId, fromAyId, gradeLevel) — or
   * the subset specified by `enrollmentIds[]` in the body — and returns
   * per-enrollment suggestion-with-reasoning. Read-only.
   */
  @Post('promote-from')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'grades', action: 'view' })
  async evaluate(
    @Param('schoolId') schoolId: string,
    @Param('fromAyId') fromAyId: string,
    @Query('targetAyId') targetAyId: string,
    @Query('gradeLevel') gradeLevel: string,
    @Body() dto: PromotionEvaluationRequestDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<PromotionEvaluationResponseDto> {
    this.logger.log(
      `POST /academics/schools/${schoolId}/academic-years/${fromAyId}/promote-from?targetAyId=${targetAyId}&gradeLevel=${gradeLevel} enrollmentIdsCount=${dto.enrollmentIds?.length ?? 'all'}`,
    );
    const context = this.buildContext(tenant, req);
    return this.batchService.evaluate(schoolId, fromAyId, targetAyId, gradeLevel, dto, context);
  }

  /**
   * POST /academics/schools/:schoolId/academic-years/:fromAyId/promote-from/:targetAyId/commit
   *
   * Atomic apply (chunked at 100). Returns per-enrollment failure list
   * for retry. Write-once enforced at DDB layer via condition expression.
   */
  @Post('promote-from/:targetAyId/commit')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'grades', action: 'edit' })
  async commit(
    @Param('schoolId') schoolId: string,
    @Param('fromAyId') fromAyId: string,
    @Param('targetAyId') targetAyId: string,
    @Body() dto: PromotionCommitRequestDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<PromotionCommitResponseDto> {
    this.logger.log(
      `POST /academics/schools/${schoolId}/academic-years/${fromAyId}/promote-from/${targetAyId}/commit decisions=${dto.decisions.length}`,
    );
    const context = this.buildContext(tenant, req);
    return this.commitService.commit(schoolId, fromAyId, targetAyId, dto, context);
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
