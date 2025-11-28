import { Controller, Get, Post, Put, Delete, Body, Param, Query, Req, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('classroomId') classroomId: string,
    @Query('studentId') studentId: string,
    @Query('date') date: string,
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

  /**
   * Import attendance records from CSV file
   * Phase 5: Advanced Features - CSV Import
   * 
   * POST /attendance/records/import?schoolId=xxx&academicYearId=yyy&classroomId=zzz
   * Content-Type: multipart/form-data
   * Body: { file: File (CSV) }
   */
  @Post('import')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async importAttendanceFromCsv(
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('classroomId') classroomId: string,
    @UploadedFile() file: any,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    if (!file) {
      throw new Error('CSV file is required');
    }

    const context = this.buildContext(req, tenant);
    return this.attendanceService.importAttendanceFromCsv(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      file,
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

  @Delete(':recordId')
  @UseGuards(JwtAuthGuard)
  async deleteAttendance(
    @Param('recordId') recordId: string,
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('studentId') studentId: string,
    @Query('date') date: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return this.attendanceService.deleteAttendance(
      tenant.tenantId,
      schoolId,
      academicYearId,
      studentId,
      date,
      context
    );
  }
}
