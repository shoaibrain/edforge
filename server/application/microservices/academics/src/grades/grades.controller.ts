/**
 * Grades Controller
 *
 * REST endpoints for grade recording, retrieval, and finalization.
 * All endpoints require authentication (JwtAuthGuard) and resource-level
 * permissions (PermissionGuard) based on the user's role at the target school.
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
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import {
  GradesService,
  RecordAssignmentGradeDto,
  BulkRecordGradeDto,
  GradeOverviewResponse,
} from './grades.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequestContext } from '../common/entities';
import { GradeResponseDto } from '../common/mappers/grade.mapper';

@Controller('academics/grades')
@UseGuards(JwtAuthGuard)
export class GradesController {
  private readonly logger = new Logger(GradesController.name);

  constructor(private readonly gradesService: GradesService) {}

  /**
   * Record a single assignment grade
   * POST /academics/grades/record
   */
  @Post('record')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'grades', action: 'create' })
  async recordGrade(
    @Body() dto: RecordAssignmentGradeDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<GradeResponseDto> {
    this.logger.log(`POST /academics/grades/record — bodyKeys=${Object.keys(dto).join(',')}`);
    const context = this.buildContext(tenant, req);
    return this.gradesService.recordAssignmentGrade(dto, context);
  }

  /**
   * Record grades for multiple students on one assignment
   * POST /academics/grades/record/bulk
   */
  @Post('record/bulk')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'grades', action: 'create' })
  async recordBulkGrades(
    @Body() dto: BulkRecordGradeDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<{ recorded: number; errors: { studentId: string; error: string }[] }> {
    this.logger.log(`POST /academics/grades/record/bulk — bodyKeys=${Object.keys(dto).join(',')}`);
    const context = this.buildContext(tenant, req);
    return this.gradesService.recordBulkGrades(dto, context);
  }

  /**
   * Get a grade by student, course, and term
   * GET /academics/grades?studentId=xxx&courseId=xxx&termId=xxx&schoolId=xxx
   */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'grades', action: 'view' })
  async getGrade(
    @Query('studentId') studentId: string,
    @Query('courseId') courseId: string,
    @Query('termId') termId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<GradeResponseDto> {
    this.logger.log(`GET /academics/grades — studentId=${studentId} courseId=${courseId} termId=${termId} schoolId=${schoolId}`);
    const context = this.buildContext(tenant, req);
    return this.gradesService.getGrade(studentId, courseId, termId, context, schoolId);
  }

  /**
   * Get aggregated grade overview for a school
   * GET /academics/grades/overview?schoolId=xxx&academicYearId=xxx
   */
  @Get('overview')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'grades', action: 'view' })
  async getGradeOverview(
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<GradeOverviewResponse> {
    this.logger.log(`GET /academics/grades/overview — schoolId=${schoolId} academicYearId=${academicYearId}`);
    if (!schoolId || !academicYearId) {
      throw new BadRequestException('schoolId and academicYearId are required');
    }
    const context = this.buildContext(tenant, req);
    return this.gradesService.getGradeOverview(schoolId, academicYearId, context);
  }

  /**
   * Get all grades for a section, optionally filtered by term
   * GET /academics/grades/section/:sectionId?schoolId=xxx&termId=xxx
   */
  @Get('section/:sectionId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'grades', action: 'view' })
  async getSectionGrades(
    @Param('sectionId') sectionId: string,
    @Query('schoolId') schoolId: string,
    @Query('termId') termId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<GradeResponseDto[]> {
    this.logger.log(`GET /academics/grades/section/${sectionId} — schoolId=${schoolId} termId=${termId || '[none]'}`);
    const context = this.buildContext(tenant, req);
    return this.gradesService.getSectionGrades(sectionId, schoolId, context, termId || undefined);
  }

  /**
   * Bulk-finalize all grades for a section in a term
   * POST /academics/grades/finalize/bulk
   */
  @Post('finalize/bulk')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'grades', action: 'edit' })
  async bulkFinalizeGrades(
    @Body() body: { sectionId: string; termId: string; schoolId: string },
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<{
    finalized: number;
    alreadyFinalized: number;
    errors: Array<{ studentId: string; courseId: string; error: string }>;
  }> {
    this.logger.log(`POST /academics/grades/finalize/bulk — sectionId=${body.sectionId} termId=${body.termId} schoolId=${body.schoolId}`);
    if (!body.sectionId || !body.termId || !body.schoolId) {
      throw new BadRequestException('sectionId, termId, and schoolId are required');
    }
    const context = this.buildContext(tenant, req);
    return this.gradesService.bulkFinalizeGrades(
      body.sectionId,
      body.termId,
      body.schoolId,
      context,
    );
  }

  /**
   * Finalize a grade (prevent further changes)
   * PATCH /academics/grades/:gradeId/finalize?schoolId=xxx
   *
   * gradeId format: studentId:courseId:termId (colon-separated composite)
   * schoolId must be provided as query param for permission checking.
   */
  @Patch(':gradeId/finalize')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'grades', action: 'edit' })
  async finalizeGrade(
    @Param('gradeId') gradeId: string,
    @Query('schoolId') _schoolId: string, // extracted by PermissionGuard, not used in handler
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<GradeResponseDto> {
    this.logger.log(`PATCH /academics/grades/${gradeId}/finalize — schoolId=${_schoolId}`);
    const context = this.buildContext(tenant, req);
    const [studentId, courseId, termId] = gradeId.split(':');
    if (!studentId || !courseId || !termId) {
      throw new BadRequestException('gradeId must be in format studentId:courseId:termId');
    }
    return this.gradesService.finalizeGrade(studentId, courseId, termId, context);
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
