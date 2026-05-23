/**
 * ExamCourses Controller — Sprint A.3.6
 *
 * Sub-resource under /academics/exams/:examId/courses:
 *   POST   /academics/exams/:examId/courses             — add course to exam
 *   GET    /academics/exams/:examId/courses             — list
 *   GET    /academics/exams/:examId/courses/:ecId       — get single
 *   PATCH  /academics/exams/:examId/courses/:ecId       — update maxMarks / passingMarks / creditHours
 *   DELETE /academics/exams/:examId/courses/:ecId       — remove
 *
 * @see docs/pilot-greenlight/a3-sprint-plan.md §4 A.3.6
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { ExamCoursesService } from './exam-courses.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { ExamCourseResponseDto } from '@aibrains/shared-types';
import {
  CreateExamCourseDtoZ,
  UpdateExamCourseDtoZ,
} from '../common/dto/zod-dtos';
import { RequestContext } from '../common/entities';

interface ExamCourseListResponseDto {
  items: ExamCourseResponseDto[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
}

@Controller('academics/exams/:examId/courses')
@UseGuards(JwtAuthGuard)
export class ExamCoursesController {
  private readonly logger = new Logger(ExamCoursesController.name);

  constructor(private readonly examCoursesService: ExamCoursesService) {}

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'exams', action: 'update' })
  async addExamCourse(
    @Param('examId') examId: string,
    @Body() dto: CreateExamCourseDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<ExamCourseResponseDto> {
    this.logger.log(`POST /academics/exams/${examId}/courses — courseId=${dto.courseId} maxMarks=${dto.maxMarks}`);
    return this.examCoursesService.addExamCourse(examId, dto, this.buildContext(tenant, req));
  }

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'exams', action: 'view' })
  async listExamCourses(
    @Param('examId') examId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<ExamCourseListResponseDto> {
    this.logger.log(`GET /academics/exams/${examId}/courses`);
    return this.examCoursesService.listExamCourses(examId, this.buildContext(tenant, req));
  }

  @Get(':examCourseId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'exams', action: 'view' })
  async getExamCourse(
    @Param('examId') examId: string,
    @Param('examCourseId') examCourseId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<ExamCourseResponseDto> {
    return this.examCoursesService.getExamCourse(examId, examCourseId, this.buildContext(tenant, req));
  }

  @Patch(':examCourseId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'exams', action: 'update' })
  async updateExamCourse(
    @Param('examId') examId: string,
    @Param('examCourseId') examCourseId: string,
    @Body() dto: UpdateExamCourseDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<ExamCourseResponseDto> {
    this.logger.log(`PATCH /academics/exams/${examId}/courses/${examCourseId} — updatedFields=${Object.keys(dto).join(',')}`);
    return this.examCoursesService.updateExamCourse(examId, examCourseId, dto, this.buildContext(tenant, req));
  }

  @Delete(':examCourseId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'exams', action: 'update' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeExamCourse(
    @Param('examId') examId: string,
    @Param('examCourseId') examCourseId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<void> {
    this.logger.log(`DELETE /academics/exams/${examId}/courses/${examCourseId}`);
    return this.examCoursesService.removeExamCourse(examId, examCourseId, this.buildContext(tenant, req));
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
