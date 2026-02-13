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
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { EnrollmentService } from './enrollment.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import { EnrollmentResponseDto, EnrollmentSummaryDto } from '@aibrains/shared-types';
import {
  CreateEnrollmentDtoZ,
  UpdateEnrollmentDtoZ,
  WithdrawStudentDtoZ,
  TransferStudentDtoZ,
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
  constructor(private readonly enrollmentService: EnrollmentService) {}

  /**
   * Create enrollment
   * POST /academics/enrollments
   */
  @Post('enrollments')
  async createEnrollment(
    @Body() createEnrollmentDto: CreateEnrollmentDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<EnrollmentResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.enrollmentService.createEnrollment(createEnrollmentDto, context);
  }

  /**
   * List enrollments for a school/year
   * GET /academics/schools/:schoolId/years/:yearId/enrollments
   */
  @Get('schools/:schoolId/years/:yearId/enrollments')
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
  async getEnrollmentSummary(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<EnrollmentSummaryDto> {
    const context = this.buildContext(tenant, req);
    return this.enrollmentService.getEnrollmentSummary(schoolId, yearId, context);
  }

  /**
   * Get student enrollment history
   * GET /academics/students/:studentId/enrollment
   */
  @Get('students/:studentId/enrollment')
  async getStudentEnrollmentHistory(
    @Param('studentId') studentId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<EnrollmentResponseDto[]> {
    const context = this.buildContext(tenant, req);
    return this.enrollmentService.getStudentEnrollmentHistory(studentId, context);
  }

  /**
   * Get specific enrollment
   * GET /academics/schools/:schoolId/years/:yearId/students/:studentId/enrollment
   */
  @Get('schools/:schoolId/years/:yearId/students/:studentId/enrollment')
  async getEnrollment(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Param('studentId') studentId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<EnrollmentResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.enrollmentService.getEnrollment(schoolId, yearId, studentId, context);
  }

  /**
   * Update enrollment
   * PATCH /academics/schools/:schoolId/years/:yearId/students/:studentId/enrollment
   */
  @Patch('schools/:schoolId/years/:yearId/students/:studentId/enrollment')
  async updateEnrollment(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Param('studentId') studentId: string,
    @Body() updateEnrollmentDto: UpdateEnrollmentDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<EnrollmentResponseDto> {
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
  async withdrawStudent(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Param('studentId') studentId: string,
    @Body() withdrawDto: WithdrawStudentDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<EnrollmentResponseDto> {
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
  async transferStudent(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Param('studentId') studentId: string,
    @Body() transferDto: TransferStudentDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<EnrollmentResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.enrollmentService.transferStudent(
      schoolId, yearId, studentId, transferDto, context
    );
  }

  /**
   * Get calendars for a school/year (placeholder - proxies to Identity service academic year data)
   * GET /academics/schools/:schoolId/academic-years/:yearId/calendars
   */
  @Get('schools/:schoolId/academic-years/:yearId/calendars')
  async getCalendars(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<{ schoolId: string; academicYearId: string; calendars: any[] }> {
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

