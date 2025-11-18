import { Controller, Get, Post, Put, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { CreateAttendanceDto, UpdateAttendanceDto, BulkAttendanceDto } from './dto/attendance.dto';
import type { RequestContext } from '@edforge/shared-types';
import { TenantCredentials } from '@app/auth/auth.decorator';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';

@Controller('attendance/records')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  /**
   * Build RequestContext from incoming request
   */
  private buildContext(req: any, tenant: any): RequestContext {
    return {
      userId: req.user?.userId || 'unknown',
      jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
      tenantId: tenant.tenantId
    };
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async createAttendance(
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('classroomId') classroomId: string,
    @Body() createDto: CreateAttendanceDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return this.attendanceService.createAttendance(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      createDto,
      context
    );
  }

  @Get('classrooms/:classroomId/dates/:date')
  @UseGuards(JwtAuthGuard)
  async getAttendanceByDate(
    @Param('classroomId') classroomId: string,
    @Param('date') date: string,
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return this.attendanceService.getAttendanceByClassroomAndDate(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      date,
      jwtToken
    );
  }

  @Get('classrooms/:classroomId/dates/:date/students/:studentId')
  @UseGuards(JwtAuthGuard)
  async getAttendance(
    @Param('classroomId') classroomId: string,
    @Param('date') date: string,
    @Param('studentId') studentId: string,
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return this.attendanceService.getAttendance(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      date,
      studentId,
      jwtToken
    );
  }

  @Put('records/:recordId')
  @UseGuards(JwtAuthGuard)
  async updateAttendance(
    @Param('recordId') recordId: string,
    @Body() updateDto: UpdateAttendanceDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return this.attendanceService.updateAttendance(
      tenant.tenantId,
      recordId,
      updateDto,
      context
    );
  }

  @Post('bulk')
  @UseGuards(JwtAuthGuard)
  async createBulkAttendance(
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('classroomId') classroomId: string,
    @Body() bulkDto: BulkAttendanceDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return this.attendanceService.createBulkAttendance(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      bulkDto,
      context
    );
  }

  @Get('students/:studentId/summary')
  @UseGuards(JwtAuthGuard)
  async getAttendanceSummary(
    @Param('studentId') studentId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return this.attendanceService.calculateAttendanceSummary(
      tenant.tenantId,
      studentId,
      academicYearId,
      startDate,
      endDate,
      jwtToken
    );
  }

  @Get('students/:studentId/records')
  @UseGuards(JwtAuthGuard)
  async getAttendanceByStudent(
    @Param('studentId') studentId: string,
    @Query('academicYearId') academicYearId: string,
    @Query() filters: any,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return this.attendanceService.getAttendanceByStudent(
      tenant.tenantId,
      studentId,
      academicYearId,
      filters,
      jwtToken
    );
  }
}
