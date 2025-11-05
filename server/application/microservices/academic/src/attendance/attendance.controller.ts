import { Controller, Get, Post, Put, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { CreateAttendanceDto, UpdateAttendanceDto, BulkAttendanceDto } from './dto/attendance.dto';
import type { RequestContext } from '@edforge/shared-types';
import { TenantCredentials } from '@app/auth/auth.decorator';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';

@Controller('academic/schools/:schoolId/academic-years/:academicYearId/classrooms/:classroomId/attendance')
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
    @Param('schoolId') schoolId: string,
    @Param('academicYearId') academicYearId: string,
    @Param('classroomId') classroomId: string,
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

  @Get('dates/:date')
  @UseGuards(JwtAuthGuard)
  async getAttendanceByDate(
    @Param('schoolId') schoolId: string,
    @Param('academicYearId') academicYearId: string,
    @Param('classroomId') classroomId: string,
    @Param('date') date: string,
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

  @Get('dates/:date/students/:studentId')
  @UseGuards(JwtAuthGuard)
  async getAttendance(
    @Param('schoolId') schoolId: string,
    @Param('academicYearId') academicYearId: string,
    @Param('classroomId') classroomId: string,
    @Param('date') date: string,
    @Param('studentId') studentId: string,
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

  @Put('dates/:date/students/:studentId')
  @UseGuards(JwtAuthGuard)
  async updateAttendance(
    @Param('schoolId') schoolId: string,
    @Param('academicYearId') academicYearId: string,
    @Param('classroomId') classroomId: string,
    @Param('date') date: string,
    @Param('studentId') studentId: string,
    @Body() updateDto: UpdateAttendanceDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return this.attendanceService.updateAttendance(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      date,
      studentId,
      updateDto,
      context
    );
  }

  @Post('bulk')
  @UseGuards(JwtAuthGuard)
  async createBulkAttendance(
    @Param('schoolId') schoolId: string,
    @Param('academicYearId') academicYearId: string,
    @Param('classroomId') classroomId: string,
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

  @Get('/students/:studentId/summary')
  @UseGuards(JwtAuthGuard)
  async getAttendanceSummary(
    @Param('schoolId') schoolId: string,
    @Param('academicYearId') academicYearId: string,
    @Param('studentId') studentId: string,
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

  @Get('/students/:studentId')
  @UseGuards(JwtAuthGuard)
  async getAttendanceByStudent(
    @Param('schoolId') schoolId: string,
    @Param('academicYearId') academicYearId: string,
    @Param('studentId') studentId: string,
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
