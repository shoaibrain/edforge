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
import { TenantCredentials, TenantContext } from '@app/auth';
import {
  RecordAttendanceDto,
  BulkAttendanceDto,
  UpdateAttendanceDto,
  AttendanceResponseDto,
  AttendanceListResponseDto,
  DailyAttendanceSummaryDto,
  StudentAttendanceSummaryDto,
  BulkAttendanceResponseDto,
} from '../common/dto/attendance.dto';
import { RequestContext } from '../common/entities';

@Controller('academics/attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  /**
   * Record single attendance
   * POST /academics/attendance
   */
  @Post()
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
   * GET /academics/attendance/summary?schoolId=xxx&date=yyyy-mm-dd
   */
  @Get('summary')
  async getDailyAttendanceSummary(
    @Query('schoolId') schoolId: string,
    @Query('date') date: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<DailyAttendanceSummaryDto> {
    const context = this.buildContext(tenant, req);
    return this.attendanceService.getDailyAttendanceSummary(schoolId, date, context);
  }

  /**
   * Get student attendance
   * GET /academics/attendance/student/:studentId
   */
  @Get('student/:studentId')
  async getStudentAttendance(
    @Param('studentId') studentId: string,
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
   */
  @Get('student/:studentId/summary')
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
      schoolId,
      academicYearId,
      startDate,
      endDate,
      context
    );
  }

  /**
   * Update attendance
   * PATCH /academics/attendance/:date/:studentId
   */
  @Patch(':date/:studentId')
  async updateAttendance(
    @Param('date') date: string,
    @Param('studentId') studentId: string,
    @Body() updateDto: UpdateAttendanceDto,
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

