/**
 * Attendance Controller - Attendance tracking endpoints
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
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { CacheTTL } from '../common/decorators/cache-ttl.decorator';
import { CacheHeaderInterceptor } from '../common/interceptors/cache-header.interceptor';
import {
  CreateAttendanceDto,
  BulkAttendanceDto,
  UpdateAttendanceDto,
  AttendanceResponseDto,
  DailyAttendanceSummaryDto,
  StudentAttendanceSummaryDto,
  BulkAttendanceResponseDto,
  AttendancePolicyResponseDto,
} from '@aibrains/shared-types';
import { RequestContext } from '../common/entities';
import { AttendancePolicyResolverService } from './attendance-policy-resolver.service';

// Type alias for backward compatibility
type RecordAttendanceDto = CreateAttendanceDto;

// Type alias for list responses
interface AttendanceListResponseDto {
  items: AttendanceResponseDto[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
}

@Controller('academics/attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  private readonly logger = new Logger(AttendanceController.name);

  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly attendancePolicyResolver: AttendancePolicyResolverService,
  ) {}

  /**
   * Resolve the effective attendance policy (mode + counting policy) for a school.
   * GET /academics/attendance/policy?schoolId=
   */
  @Get('policy')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'attendance', action: 'view' })
  async getAttendancePolicy(
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<AttendancePolicyResponseDto> {
    // The PermissionGuard rejects a missing schoolId for non-admins, but
    // TenantAdmin bypasses that guard. Without this check the resolver's
    // graceful degradation would return 200 with schoolId: undefined, violating
    // attendancePolicyResponseSchema (schoolId is required).
    if (!schoolId) {
      throw new BadRequestException('schoolId query parameter is required');
    }
    const context = this.buildContext(tenant, req);
    return this.attendancePolicyResolver.resolveEffectivePolicy(schoolId, context);
  }

  /**
   * Record single attendance
   * POST /academics/attendance
   */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'attendance', action: 'create' })
  async recordAttendance(
    @Body() recordDto: RecordAttendanceDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<AttendanceResponseDto> {
    this.logger.log(`POST /academics/attendance — bodyKeys=${Object.keys(recordDto).join(',')}`);
    const context = this.buildContext(tenant, req);
    return this.attendanceService.recordAttendance(recordDto, context);
  }

  /**
   * Record bulk attendance
   * POST /academics/attendance/bulk
   */
  @Post('bulk')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'attendance', action: 'create' })
  async recordBulkAttendance(
    @Body() bulkDto: BulkAttendanceDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<BulkAttendanceResponseDto> {
    this.logger.log(`POST /academics/attendance/bulk — bodyKeys=${Object.keys(bulkDto).join(',')}`);
    const context = this.buildContext(tenant, req);
    return this.attendanceService.recordBulkAttendance(bulkDto, context);
  }

  /**
   * Get attendance for a date
   * GET /academics/attendance?schoolId=xxx&date=yyyy-mm-dd
   */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'attendance', action: 'view' })
  async getAttendanceByDate(
    @Query('schoolId') schoolId: string,
    @Query('date') date: string,
    @Query('limit') limit: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<AttendanceListResponseDto> {
    this.logger.log(`GET /academics/attendance — schoolId=${schoolId} date=${date} limit=${limit || '100'}`);
    const context = this.buildContext(tenant, req);
    const result = await this.attendanceService.getAttendanceByDate(
      schoolId,
      date,
      context,
      limit ? parseInt(limit, 10) : 100
    );

    return {
      items: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Get daily attendance summary
   * GET /academics/attendance/summary?schoolId=xxx&date=yyyy-mm-dd&academicYearId=xxx
   */
  @Get('summary')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'attendance', action: 'view' })
  @UseInterceptors(CacheHeaderInterceptor)
  @CacheTTL(120)
  async getDailyAttendanceSummary(
    @Query('schoolId') schoolId: string,
    @Query('date') date: string,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<DailyAttendanceSummaryDto> {
    this.logger.log(`GET /academics/attendance/summary — schoolId=${schoolId} date=${date} academicYearId=${academicYearId || '[none]'}`);
    const context = this.buildContext(tenant, req);
    return this.attendanceService.getDailyAttendanceSummary(schoolId, date, context, academicYearId || undefined);
  }

  /**
   * Get student attendance
   * GET /academics/attendance/student/:studentId?schoolId=xxx
   */
  @Get('student/:studentId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'attendance', action: 'view' })
  async getStudentAttendance(
    @Param('studentId') studentId: string,
    @Query('schoolId') schoolId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<AttendanceResponseDto[]> {
    this.logger.log(`GET /academics/attendance/student/${studentId} — schoolId=${schoolId} startDate=${startDate || '[none]'} endDate=${endDate || '[none]'}`);
    const context = this.buildContext(tenant, req);
    return this.attendanceService.getStudentAttendance(
      studentId,
      startDate,
      endDate,
      context,
      schoolId,
    );
  }

  /**
   * Get student attendance summary
   * GET /academics/attendance/student/:studentId/summary
   * Query params are optional — when dates are omitted, returns all-time summary.
   */
  @Get('student/:studentId/summary')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'attendance', action: 'view' })
  async getStudentAttendanceSummary(
    @Param('studentId') studentId: string,
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StudentAttendanceSummaryDto> {
    this.logger.log(`GET /academics/attendance/student/${studentId}/summary — schoolId=${schoolId || '[none]'} academicYearId=${academicYearId || '[none]'} startDate=${startDate || '[none]'} endDate=${endDate || '[none]'}`);
    const context = this.buildContext(tenant, req);
    return this.attendanceService.getStudentAttendanceSummary(
      studentId,
      schoolId || '',
      academicYearId || '',
      startDate || undefined,
      endDate || undefined,
      context
    );
  }

  // ============================================
  // Attendance Analytics
  // ============================================

  /**
   * Get attendance overview (aggregate dashboard endpoint)
   * GET /academics/attendance/overview?schoolId=xxx&academicYearId=xxx&date=yyyy-mm-dd
   * MUST be defined BEFORE :date/:studentId route
   */
  @Get('overview')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'attendance', action: 'view' })
  async getAttendanceOverview(
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('date') date: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<any> {
    this.logger.log(`GET /academics/attendance/overview — schoolId=${schoolId} academicYearId=${academicYearId} date=${date}`);
    const context = this.buildContext(tenant, req);
    return this.attendanceService.getAttendanceOverview(schoolId, academicYearId, date, context);
  }

  /**
   * Get attendance trend (daily summaries over a date range)
   * GET /academics/attendance/trend?schoolId=xxx&startDate=yyyy-mm-dd&endDate=yyyy-mm-dd
   * MUST be defined BEFORE :date/:studentId route
   */
  @Get('trend')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'attendance', action: 'view' })
  @UseInterceptors(CacheHeaderInterceptor)
  @CacheTTL(300)
  async getAttendanceTrend(
    @Query('schoolId') schoolId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<DailyAttendanceSummaryDto[]> {
    this.logger.log(`GET /academics/attendance/trend — schoolId=${schoolId} startDate=${startDate} endDate=${endDate}`);
    const context = this.buildContext(tenant, req);
    return this.attendanceService.getAttendanceTrend(schoolId, startDate, endDate, context);
  }

  /**
   * Get students below attendance threshold
   * GET /academics/attendance/alerts?schoolId=xxx&academicYearId=xxx&threshold=90&startDate=&endDate=
   * MUST be defined BEFORE :date/:studentId route
   */
  @Get('alerts')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'attendance', action: 'view' })
  async getAttendanceAlerts(
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('threshold') threshold: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<any> {
    this.logger.log(`GET /academics/attendance/alerts — schoolId=${schoolId} academicYearId=${academicYearId} threshold=${threshold || '90'} startDate=${startDate || '[none]'} endDate=${endDate || '[none]'}`);
    const context = this.buildContext(tenant, req);
    return this.attendanceService.getAttendanceAlerts(
      schoolId,
      academicYearId,
      threshold ? parseFloat(threshold) : 90,
      startDate,
      endDate,
      context,
    );
  }

  /**
   * Batch per-student attendance trend for the roster sparkline.
   * GET /academics/attendance/student-trends?schoolId=xxx&studentIds=a,b,c&startDate=&endDate=
   * Distinct from /trend (school-wide daily summaries). MUST be defined BEFORE
   * the :date / :studentId routes so it isn't shadowed.
   */
  @Get('student-trends')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'attendance', action: 'view' })
  async getStudentTrends(
    @Query('schoolId') schoolId: string,
    @Query('studentIds') studentIds: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<any> {
    const ids = (studentIds || '').split(',').map((s) => s.trim()).filter(Boolean);
    this.logger.log(`GET /academics/attendance/student-trends — schoolId=${schoolId} ids=${ids.length} startDate=${startDate || '[none]'} endDate=${endDate || '[none]'}`);
    const context = this.buildContext(tenant, req);
    return this.attendanceService.getStudentTrends(schoolId, ids, startDate, endDate, context);
  }

  /**
   * Update attendance
   * PATCH /academics/attendance/:date/:studentId?schoolId=xxx
   */
  @Patch(':date/:studentId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'attendance', action: 'edit' })
  async updateAttendance(
    @Param('date') date: string,
    @Param('studentId') studentId: string,
    @Body() updateDto: UpdateAttendanceDto,
    @Query('schoolId') _schoolId: string, // extracted by PermissionGuard, not used in handler
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<AttendanceResponseDto> {
    this.logger.log(`PATCH /academics/attendance/${date}/${studentId} — schoolId=${_schoolId} bodyKeys=${Object.keys(updateDto).join(',')}`);
    const context = this.buildContext(tenant, req);
    return this.attendanceService.updateAttendance(date, studentId, updateDto, context);
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
