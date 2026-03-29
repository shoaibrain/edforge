/**
 * Enrollment Controller - Student enrollment endpoints
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
  UseInterceptors,
  Req,
  Res,
  Header,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { EnrollmentService } from './enrollment.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { CacheTTL } from '../common/decorators/cache-ttl.decorator';
import { CacheHeaderInterceptor } from '../common/interceptors/cache-header.interceptor';
import { EnrollmentResponseDto, EnrollmentSummaryDto } from '@aibrains/shared-types';
import {
  CreateEnrollmentDtoZ,
  UpdateEnrollmentDtoZ,
  WithdrawStudentDtoZ,
  TransferStudentDtoZ,
  CloseYearDtoZ,
} from '../common/dto/zod-dtos';
import { RequestContext } from '../common/entities';

// Type alias for list responses
interface EnrollmentListResponseDto {
  items: EnrollmentResponseDto[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
}

@Controller('academics')
@UseGuards(JwtAuthGuard)
export class EnrollmentController {
  private readonly logger = new Logger(EnrollmentController.name);

  constructor(private readonly enrollmentService: EnrollmentService) {}

  /**
   * Create enrollment
   * POST /academics/enrollments
   */
  @Post('enrollments')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'enrollment', action: 'create' })
  async createEnrollment(
    @Body() createEnrollmentDto: CreateEnrollmentDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<EnrollmentResponseDto> {
    this.logger.log(`POST /academics/enrollments — schoolId=${createEnrollmentDto.schoolId} yearId=${createEnrollmentDto.academicYearId} studentId=${createEnrollmentDto.studentId}`);
    const context = this.buildContext(tenant, req);
    return this.enrollmentService.createEnrollment(createEnrollmentDto, context);
  }

  /**
   * List enrollments for a school/year
   * GET /academics/schools/:schoolId/years/:yearId/enrollments
   */
  @Get('schools/:schoolId/years/:yearId/enrollments')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'enrollment', action: 'view' })
  async listEnrollments(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Query('limit') limit: string,
    @Query('cursor') cursor: string,
    @Query('gradeLevel') gradeLevel: string,
    @Query('status') status: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<EnrollmentListResponseDto> {
    this.logger.log(`GET /academics/schools/${schoolId}/years/${yearId}/enrollments — gradeLevel=${gradeLevel || 'all'} status=${status || 'all'} limit=${limit || '50'} cursor=${cursor ? '[provided]' : '[none]'}`);
    const context = this.buildContext(tenant, req);
    context.schoolId = schoolId;

    const result = await this.enrollmentService.listEnrollments(
      schoolId,
      yearId,
      context,
      limit ? parseInt(limit, 10) : 50,
      cursor,
      { gradeLevel, status }
    );

    return {
      items: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Get enrollment summary for a school
   * GET /academics/schools/:schoolId/years/:yearId/enrollments/summary
   */
  @Get('schools/:schoolId/years/:yearId/enrollments/summary')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'enrollment', action: 'view' })
  @UseInterceptors(CacheHeaderInterceptor)
  @CacheTTL(300)
  async getEnrollmentSummary(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<EnrollmentSummaryDto> {
    this.logger.log(`GET /academics/schools/${schoolId}/years/${yearId}/enrollments/summary`);
    const context = this.buildContext(tenant, req);
    return this.enrollmentService.getEnrollmentSummary(schoolId, yearId, context);
  }

  /**
   * Get student enrollment history
   * GET /academics/students/:studentId/enrollment?schoolId=xxx
   */
  @Get('students/:studentId/enrollment')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'enrollment', action: 'view' })
  async getStudentEnrollmentHistory(
    @Param('studentId') studentId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<EnrollmentResponseDto[]> {
    this.logger.log(`GET /academics/students/${studentId}/enrollment — schoolId=${schoolId || '[none]'}`);
    const context = this.buildContext(tenant, req);
    return this.enrollmentService.getStudentEnrollmentHistory(studentId, context, schoolId);
  }

  /**
   * Get specific enrollment
   * GET /academics/schools/:schoolId/years/:yearId/students/:studentId/enrollment
   */
  @Get('schools/:schoolId/years/:yearId/students/:studentId/enrollment')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'enrollment', action: 'view' })
  async getEnrollment(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Param('studentId') studentId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<EnrollmentResponseDto> {
    this.logger.log(`GET /academics/schools/${schoolId}/years/${yearId}/students/${studentId}/enrollment`);
    const context = this.buildContext(tenant, req);
    return this.enrollmentService.getEnrollment(schoolId, yearId, studentId, context);
  }

  /**
   * Update enrollment
   * PATCH /academics/schools/:schoolId/years/:yearId/students/:studentId/enrollment
   */
  @Patch('schools/:schoolId/years/:yearId/students/:studentId/enrollment')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'enrollment', action: 'edit' })
  async updateEnrollment(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Param('studentId') studentId: string,
    @Body() updateEnrollmentDto: UpdateEnrollmentDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<EnrollmentResponseDto> {
    this.logger.log(`PATCH /academics/schools/${schoolId}/years/${yearId}/students/${studentId}/enrollment — bodyKeys=${Object.keys(updateEnrollmentDto).join(',')}`);
    const context = this.buildContext(tenant, req);
    return this.enrollmentService.updateEnrollment(
      schoolId, yearId, studentId, updateEnrollmentDto, context
    );
  }

  /**
   * Withdraw student
   * POST /academics/schools/:schoolId/years/:yearId/students/:studentId/withdraw
   */
  @Post('schools/:schoolId/years/:yearId/students/:studentId/withdraw')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'enrollment', action: 'edit' })
  async withdrawStudent(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Param('studentId') studentId: string,
    @Body() withdrawDto: WithdrawStudentDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<EnrollmentResponseDto> {
    this.logger.log(`POST /academics/schools/${schoolId}/years/${yearId}/students/${studentId}/withdraw — bodyKeys=${Object.keys(withdrawDto).join(',')}`);
    const context = this.buildContext(tenant, req);
    return this.enrollmentService.withdrawStudent(
      schoolId, yearId, studentId, withdrawDto, context
    );
  }

  /**
   * Transfer student
   * POST /academics/schools/:schoolId/years/:yearId/students/:studentId/transfer
   */
  @Post('schools/:schoolId/years/:yearId/students/:studentId/transfer')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'enrollment', action: 'edit' })
  async transferStudent(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Param('studentId') studentId: string,
    @Body() transferDto: TransferStudentDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<EnrollmentResponseDto> {
    this.logger.log(`POST /academics/schools/${schoolId}/years/${yearId}/students/${studentId}/transfer — bodyKeys=${Object.keys(transferDto).join(',')}`);
    const context = this.buildContext(tenant, req);
    return this.enrollmentService.transferStudent(
      schoolId, yearId, studentId, transferDto, context
    );
  }

  /**
   * Mark enrollment as no-show
   * POST /academics/schools/:schoolId/years/:yearId/students/:studentId/no-show
   */
  @Post('schools/:schoolId/years/:yearId/students/:studentId/no-show')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'enrollment', action: 'edit' })
  async markNoShow(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Param('studentId') studentId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<EnrollmentResponseDto> {
    this.logger.log(`POST /academics/schools/${schoolId}/years/${yearId}/students/${studentId}/no-show`);
    const context = this.buildContext(tenant, req);
    return this.enrollmentService.markNoShow(schoolId, yearId, studentId, context);
  }

  /**
   * Close all open enrollments for a completed academic year
   * POST /academics/schools/:schoolId/years/:yearId/enrollments/close-year
   */
  @Post('schools/:schoolId/years/:yearId/enrollments/close-year')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'enrollment', action: 'edit' })
  async closeAcademicYearEnrollments(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Body() body: CloseYearDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<{ closed: number; alreadyClosed: number; errors: number }> {
    this.logger.log(`POST /academics/schools/${schoolId}/years/${yearId}/enrollments/close-year — lastDayOfSchool=${body.lastDayOfSchool}`);
    const context = this.buildContext(tenant, req);
    return this.enrollmentService.closeAcademicYearEnrollments(
      schoolId, yearId, body.lastDayOfSchool, context,
    );
  }

  /**
   * Export enrollments as CSV
   * GET /academics/schools/:schoolId/years/:yearId/enrollments/export
   */
  @Get('schools/:schoolId/years/:yearId/enrollments/export')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'enrollment', action: 'view' })
  @Header('Content-Type', 'text/csv')
  async exportEnrollments(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    this.logger.log(`GET /academics/schools/${schoolId}/years/${yearId}/enrollments/export`);
    const context = this.buildContext(tenant, req);
    const csv = await this.enrollmentService.exportEnrollments(schoolId, yearId, context);
    res.setHeader('Content-Disposition', `attachment; filename="enrollments-${schoolId}-${yearId}.csv"`);
    res.send(csv);
  }

  /**
   * Get calendars for a school/year (placeholder - proxies to Identity service academic year data)
   * GET /academics/schools/:schoolId/academic-years/:yearId/calendars
   */
  @Get('schools/:schoolId/academic-years/:yearId/calendars')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'enrollment', action: 'view' })
  async getCalendars(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<{ schoolId: string; academicYearId: string; calendars: any[] }> {
    this.logger.log(`GET /academics/schools/${schoolId}/academic-years/${yearId}/calendars`);
    const context = this.buildContext(tenant, req);
    const enrollment = await this.enrollmentService.getEnrollmentSummary(schoolId, yearId, context);
    return {
      schoolId,
      academicYearId: yearId,
      calendars: [{
        code: 'default',
        name: `${enrollment.academicYearName || yearId} Calendar`,
        schoolId,
        academicYearId: yearId,
      }],
    };
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
