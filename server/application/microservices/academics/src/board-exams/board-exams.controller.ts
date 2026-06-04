/**
 * BoardExamsController — Sprint GB2.3
 *
 * One endpoint under `/academics/board-exams`:
 *   - GET /academics/board-exams?schoolId=…  list (lazy-seeds from the
 *     archetype profile on first empty read; grade-gated to the school).
 *
 * Three-way handoff (per CLAUDE.md): controller (here) + API GW spec
 * (tenant-api-prod.json `/academics/board-exams`) + nginx `^/academics`
 * (existing prefix — no nginx.template change).
 */

import {
  Controller,
  Get,
  Query,
  UseGuards,
  Req,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { BoardExamsService } from './board-exams.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequestContext } from '../common/entities';
import type { BoardExamEntity } from '../common/entities/board-exam.entity';

/** Public board-exam shape — entity minus internal audit/key fields. */
export interface BoardExamResponseDto {
  schoolId: string;
  examType: string;
  grade: number | string;
  authority: string;
  internalWeight: number;
  externalWeight: number;
  passingThresholdPct?: number;
  hasSupplementary?: boolean;
  maxNgForSupplementary?: number;
  archetypeId: string;
  archetypeDefaulted: boolean;
}

function toBoardExamDto(e: BoardExamEntity): BoardExamResponseDto {
  return {
    schoolId: e.schoolId,
    examType: e.examType,
    grade: e.grade,
    authority: e.authority,
    internalWeight: e.internalWeight,
    externalWeight: e.externalWeight,
    passingThresholdPct: e.passingThresholdPct,
    hasSupplementary: e.hasSupplementary,
    maxNgForSupplementary: e.maxNgForSupplementary,
    archetypeId: e.archetypeId,
    archetypeDefaulted: e.archetypeDefaulted,
  };
}

@Controller('academics/board-exams')
@UseGuards(JwtAuthGuard)
export class BoardExamsController {
  private readonly logger = new Logger(BoardExamsController.name);

  constructor(private readonly boardExamsService: BoardExamsService) {}

  /**
   * GET /academics/board-exams?schoolId=…
   *
   * Returns the school's board exams. On the first call for a school with none,
   * the archetype's board exams are lazily seeded (grade-gated) and returned.
   */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'exams', action: 'view' })
  async listBoardExams(
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<BoardExamResponseDto[]> {
    this.logger.log(`GET /academics/board-exams — schoolId=${schoolId}`);
    const context = this.buildContext(tenant, req);
    const entities = await this.boardExamsService.listBoardExams(schoolId, context);
    return entities.map(toBoardExamDto);
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
