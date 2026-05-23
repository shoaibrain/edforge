/**
 * ExamScores Controller — Sprint A.3.7 + A.3.9
 *
 * Sub-resource under /academics/exams/:examId/scores:
 *   POST   /academics/exams/:examId/scores                — record single score
 *   POST   /academics/exams/:examId/scores/bulk           — bulk write (A.3.9)
 *   GET    /academics/exams/:examId/scores                — list (school-scoped)
 *   GET    /academics/exams/:examId/scores/:scoreId       — get single
 *   PATCH  /academics/exams/:examId/scores/:scoreId       — update rawScore
 *
 * @see docs/pilot-greenlight/a3-sprint-plan.md §4 A.3.7 + A.3.9
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { ExamScoresService } from './exam-scores.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import {
  ExamScoreResponseDto,
  BulkExamScoreResponseDto,
} from '@aibrains/shared-types';
import {
  CreateExamScoreDtoZ,
  UpdateExamScoreDtoZ,
  BulkExamScoreDtoZ,
} from '../common/dto/zod-dtos';
import { RequestContext } from '../common/entities';

interface ExamScoreListResponseDto {
  items: ExamScoreResponseDto[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
}

@Controller('academics/exams/:examId/scores')
@UseGuards(JwtAuthGuard)
export class ExamScoresController {
  private readonly logger = new Logger(ExamScoresController.name);

  constructor(private readonly examScoresService: ExamScoresService) {}

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'exams', action: 'update' })
  async recordScore(
    @Param('examId') examId: string,
    @Body() dto: CreateExamScoreDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<ExamScoreResponseDto> {
    this.logger.log(`POST /academics/exams/${examId}/scores — examCourseId=${dto.examCourseId} enrollmentId=${dto.enrollmentId} rawScore=${dto.rawScore}`);
    return this.examScoresService.recordScore(examId, dto, this.buildContext(tenant, req));
  }

  @Post('bulk')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'exams', action: 'update' })
  async recordBulk(
    @Param('examId') examId: string,
    @Query('schoolId') schoolId: string,
    @Body() dto: BulkExamScoreDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<BulkExamScoreResponseDto> {
    if (!schoolId) {
      throw new BadRequestException('schoolId query parameter is required');
    }
    this.logger.log(`POST /academics/exams/${examId}/scores/bulk — schoolId=${schoolId} count=${dto.scores.length} correlationId=${dto.correlationId}`);
    return this.examScoresService.recordBulk(examId, schoolId, dto, this.buildContext(tenant, req));
  }

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'exams', action: 'view' })
  async listScores(
    @Param('examId') examId: string,
    @Query('schoolId') schoolId: string,
    @Query('examCourseId') examCourseId: string,
    @Query('enrollmentId') enrollmentId: string,
    @Query('limit') limit: string,
    @Query('cursor') cursor: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<ExamScoreListResponseDto> {
    if (!schoolId) {
      throw new BadRequestException('schoolId query parameter is required');
    }
    const parsedLimit = limit ? Math.max(1, Math.min(250, parseInt(limit, 10))) : 100;
    this.logger.log(`GET /academics/exams/${examId}/scores — schoolId=${schoolId} filters=${[examCourseId && 'examCourse', enrollmentId && 'enrollment'].filter(Boolean).join(',') || '[none]'}`);
    return this.examScoresService.listScoresInSchool(
      examId,
      schoolId,
      this.buildContext(tenant, req),
      {
        examCourseId: examCourseId || undefined,
        enrollmentId: enrollmentId || undefined,
      },
      parsedLimit,
      cursor || undefined,
    );
  }

  @Get(':scoreId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'exams', action: 'view' })
  async getScore(
    @Param('examId') examId: string,
    @Param('scoreId') scoreId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<ExamScoreResponseDto> {
    return this.examScoresService.getScore(examId, scoreId, this.buildContext(tenant, req));
  }

  @Patch(':scoreId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'exams', action: 'update' })
  async updateScore(
    @Param('examId') examId: string,
    @Param('scoreId') scoreId: string,
    @Body() dto: UpdateExamScoreDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<ExamScoreResponseDto> {
    this.logger.log(`PATCH /academics/exams/${examId}/scores/${scoreId} — rawScore=${dto.rawScore}`);
    return this.examScoresService.updateScore(examId, scoreId, dto, this.buildContext(tenant, req));
  }

  private buildContext(tenant: TenantContext, req: Request): RequestContext {
    return {
      userId: tenant.userId,
      tenantId: tenant.tenantId,
      email: tenant.email,
      role: tenant.globalRole,
      jwtToken: (req.headers.authorization || '').replace(/^Bearer\s+/i, ''),
    };
  }
}
