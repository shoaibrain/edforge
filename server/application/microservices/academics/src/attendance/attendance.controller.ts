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
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import {
  CreateAttendanceDto,
  BulkAttendanceDto,
  UpdateAttendanceDto,
  AttendanceResponseDto,
  DailyAttendanceSummaryDto,
  StudentAttendanceSummaryDto,
  BulkAttendanceResponseDto,
} from '@aibrains/shared-types';
import { RequestContext } from '../common/entities';

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
  constructor(private readonly attendanceService: AttendanceService) {}

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
  async getDailyAttendanceSummary(
    @Query('schoolId') schoolId: string,
    @Query('date') date: string,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<DailyAttendanceSummaryDto> {
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
    @Query('schoolId') _schoolId: string, // extracted by PermissionGuard, not used in handler
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<AttendanceResponseDto[]> {
    const context = this.buildContext(tenant, req);
    return this.attendanceService.getStudentAttendance(
      studentId,
      startDate,
      endDate,
      context
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
  async getAttendanceTrend(
    @Query('schoolId') schoolId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<DailyAttendanceSummaryDto[]> {
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
