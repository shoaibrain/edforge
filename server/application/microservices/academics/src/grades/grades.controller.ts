/**
 * Grades Controller
 *
 * REST endpoints for grade recording, retrieval, and finalization.
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
} from '@nestjs/common';
import { Request } from 'express';
import {
  GradesService,
  RecordAssignmentGradeDto,
  BulkRecordGradeDto,
  GradeOverviewResponse,
} from './grades.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import { RequestContext } from '../common/entities';
import { GradeResponseDto } from '../common/mappers/grade.mapper';

@Controller('academics/grades')
@UseGuards(JwtAuthGuard)
export class GradesController {
  constructor(private readonly gradesService: GradesService) {}

  /**
   * Record a single assignment grade
   * POST /academics/grades/record
   */
  @Post('record')
  async recordGrade(
    @Body() dto: RecordAssignmentGradeDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<GradeResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.gradesService.recordAssignmentGrade(dto, context);
  }

  /**
   * Record grades for multiple students on one assignment
   * POST /academics/grades/record/bulk
   */
  @Post('record/bulk')
  async recordBulkGrades(
    @Body() dto: BulkRecordGradeDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<{ recorded: number; errors: { studentId: string; error: string }[] }> {
    const context = this.buildContext(tenant, req);
    return this.gradesService.recordBulkGrades(dto, context);
  }

  /**
   * Get a grade by student, course, and term
   * GET /academics/grades?studentId=xxx&courseId=xxx&termId=xxx
   */
  @Get()
  async getGrade(
    @Query('studentId') studentId: string,
    @Query('courseId') courseId: string,
    @Query('termId') termId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<GradeResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.gradesService.getGrade(studentId, courseId, termId, context);
  }

  /**
   * Get aggregated grade overview for a school
   * GET /academics/grades/overview?schoolId=xxx&academicYearId=xxx
   */
  @Get('overview')
  async getGradeOverview(
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<GradeOverviewResponse> {
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
  async getSectionGrades(
    @Param('sectionId') sectionId: string,
    @Query('schoolId') schoolId: string,
    @Query('termId') termId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<GradeResponseDto[]> {
    const context = this.buildContext(tenant, req);
    return this.gradesService.getSectionGrades(sectionId, schoolId, context, termId || undefined);
  }

  /**
   * Bulk-finalize all grades for a section in a term
   * POST /academics/grades/finalize/bulk
   */
  @Post('finalize/bulk')
  async bulkFinalizeGrades(
    @Body() body: { sectionId: string; termId: string; schoolId: string },
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<{
    finalized: number;
    alreadyFinalized: number;
    errors: Array<{ studentId: string; courseId: string; error: string }>;
  }> {
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
   * PATCH /academics/grades/:gradeId/finalize
   *
   * gradeId format: studentId:courseId:termId (colon-separated composite)
   */
  @Patch(':gradeId/finalize')
  async finalizeGrade(
    @Param('gradeId') gradeId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<GradeResponseDto> {
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
