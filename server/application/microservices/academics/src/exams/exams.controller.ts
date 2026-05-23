/**
 * Exams Controller — Sprint A.3.5 + A.3.8
 *
 * Endpoints under /academics/exams:
 *   POST   /academics/exams                          — create Exam
 *   GET    /academics/exams                          — list (filter by schoolId + termId + status)
 *   GET    /academics/exams/:examId                  — get single
 *   PATCH  /academics/exams/:examId                  — generic update (NOT status — see below)
 *   PATCH  /academics/exams/:examId/status           — state-machine transition (A.3.8)
 *   DELETE /academics/exams/:examId                  — soft-delete
 *
 * All routes require JWT auth + permission guard. Course validation (FK)
 * lives in the dedicated /courses sub-resource controller (exam-courses.controller).
 *
 * @see docs/pilot-greenlight/a3-sprint-plan.md §3 Phase 2
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { ExamsService } from './exams.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { ExamResponseDto } from '@aibrains/shared-types';
import {
  CreateExamDtoZ,
  UpdateExamDtoZ,
  ExamStatusTransitionDtoZ,
} from '../common/dto/zod-dtos';
import { RequestContext } from '../common/entities';

interface ExamListResponseDto {
  items: ExamResponseDto[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
}

@Controller('academics/exams')
@UseGuards(JwtAuthGuard)
export class ExamsController {
  private readonly logger = new Logger(ExamsController.name);

  constructor(private readonly examsService: ExamsService) {}

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'exams', action: 'create' })
  async createExam(
    @Body() dto: CreateExamDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<ExamResponseDto> {
    this.logger.log(`POST /academics/exams — schoolId=${dto.schoolId} examType=${dto.examType}`);
    return this.examsService.createExam(dto, this.buildContext(tenant, req));
  }

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'exams', action: 'view' })
  async listExams(
    @Query('schoolId') schoolId: string,
    @Query('limit') limit: string,
    @Query('cursor') cursor: string,
    @Query('academicYearId') academicYearId: string,
    @Query('termId') termId: string,
    @Query('examType') examType: string,
    @Query('status') status: string,
    @Query('isActive') isActive: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<ExamListResponseDto> {
    if (!schoolId) {
      throw new BadRequestException('schoolId query parameter is required');
    }
    this.logger.log(`GET /academics/exams — schoolId=${schoolId} termId=${termId || '[none]'} status=${status || '[none]'}`);
    const parsedLimit = limit ? Math.max(1, Math.min(100, parseInt(limit, 10))) : 50;
    return this.examsService.listExams(
      schoolId,
      this.buildContext(tenant, req),
      parsedLimit,
      cursor || undefined,
      {
        academicYearId: academicYearId || undefined,
        termId: termId || undefined,
        examType: examType || undefined,
        status: status || undefined,
        isActive: isActive ? isActive === 'true' : undefined,
      },
    );
  }

  @Get(':examId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'exams', action: 'view' })
  async getExam(
    @Param('examId') examId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<ExamResponseDto> {
    if (!schoolId) {
      throw new BadRequestException('schoolId query parameter is required');
    }
    return this.examsService.getExam(examId, schoolId, this.buildContext(tenant, req));
  }

  @Patch(':examId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'exams', action: 'update' })
  async updateExam(
    @Param('examId') examId: string,
    @Query('schoolId') schoolId: string,
    @Body() dto: UpdateExamDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<ExamResponseDto> {
    if (!schoolId) {
      throw new BadRequestException('schoolId query parameter is required');
    }
    this.logger.log(`PATCH /academics/exams/${examId} — updatedFields=${Object.keys(dto).join(',')}`);
    return this.examsService.updateExam(examId, schoolId, dto, this.buildContext(tenant, req));
  }

  @Patch(':examId/status')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'exams', action: 'update' })
  async transitionStatus(
    @Param('examId') examId: string,
    @Query('schoolId') schoolId: string,
    @Body() dto: ExamStatusTransitionDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<ExamResponseDto> {
    if (!schoolId) {
      throw new BadRequestException('schoolId query parameter is required');
    }
    this.logger.log(`PATCH /academics/exams/${examId}/status — target=${dto.targetStatus}`);
    return this.examsService.transitionStatus(examId, schoolId, dto, this.buildContext(tenant, req));
  }

  @Delete(':examId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'exams', action: 'delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteExam(
    @Param('examId') examId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<void> {
    if (!schoolId) {
      throw new BadRequestException('schoolId query parameter is required');
    }
    this.logger.log(`DELETE /academics/exams/${examId}`);
    return this.examsService.deleteExam(examId, schoolId, this.buildContext(tenant, req));
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
