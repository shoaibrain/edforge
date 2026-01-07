/**
 * Students Controller - Student management endpoints
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { StudentsService } from './students.service';
import { EnrollmentService } from '../enrollment/enrollment.service';
import { AttendanceService } from '../attendance/attendance.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import {
  CreateStudentDto,
  UpdateStudentDto,
  StudentResponseDto,
  StudentListResponseDto,
  StudentProfileDto,
} from '../common/dto/student.dto';
import { EnrollmentListResponseDto } from '../common/dto/enrollment.dto';
import { AttendanceListResponseDto, StudentAttendanceSummaryDto } from '../common/dto/attendance.dto';
import { RequestContext } from '../common/entities';

@Controller('academics/students')
@UseGuards(JwtAuthGuard)
export class StudentsController {
  constructor(
    private readonly studentsService: StudentsService,
    private readonly enrollmentService: EnrollmentService,
    private readonly attendanceService: AttendanceService,
  ) {}

  /**
   * Create a new student
   * POST /academics/students
   */
  @Post()
  async createStudent(
    @Body() createStudentDto: CreateStudentDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StudentResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.studentsService.createStudent(createStudentDto, context);
  }

  /**
   * List students for a school
   * GET /academics/students?schoolId=xxx
   */
  @Get()
  async listStudents(
    @Query('schoolId') schoolId: string,
    @Query('limit') limit: string,
    @Query('cursor') cursor: string,
    @Query('gradeLevel') gradeLevel: string,
    @Query('status') status: string,
    @Query('search') search: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StudentListResponseDto> {
    const context = this.buildContext(tenant, req);
    context.schoolId = schoolId;

    const result = await this.studentsService.listStudents(
      schoolId,
      context,
      limit ? parseInt(limit, 10) : 50,
      cursor,
      { gradeLevel, status, search }
    );

    return {
      items: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  // ============================================
  // Student-Centric Views (MUST be defined BEFORE generic :id routes)
  // NestJS evaluates routes in definition order
  // ============================================

  /**
   * Get student profile with aggregated data
   * GET /academics/students/:id/profile
   */
  @Get(':id/profile')
  async getStudentProfile(
    @Param('id') studentId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StudentProfileDto> {
    const context = this.buildContext(tenant, req);
    return this.studentsService.getStudentProfile(studentId, context);
  }

  /**
   * Get student enrollment history
   * GET /academics/students/:id/enrollments
   */
  @Get(':id/enrollments')
  async getStudentEnrollments(
    @Param('id') studentId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<EnrollmentListResponseDto> {
    const context = this.buildContext(tenant, req);
    const enrollments = await this.enrollmentService.getStudentEnrollmentHistory(studentId, context);
    return {
      items: enrollments,
      hasMore: false,
    };
  }

  /**
   * Get student attendance summary
   * GET /academics/students/:id/attendance/summary
   * NOTE: Must be before :id/attendance to match correctly
   */
  @Get(':id/attendance/summary')
  async getStudentAttendanceSummary(
    @Param('id') studentId: string,
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StudentAttendanceSummaryDto> {
    const context = this.buildContext(tenant, req);
    return this.attendanceService.getStudentAttendanceSummary(
      studentId,
      schoolId,
      academicYearId,
      undefined,
      undefined,
      context
    );
  }

  /**
   * Get student attendance records
   * GET /academics/students/:id/attendance
   */
  @Get(':id/attendance')
  async getStudentAttendance(
    @Param('id') studentId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<AttendanceListResponseDto> {
    const context = this.buildContext(tenant, req);
    const attendanceRecords = await this.attendanceService.getStudentAttendance(
      studentId,
      startDate,
      endDate,
      context
    );
    return {
      items: attendanceRecords,
      hasMore: false,
    };
  }

  /**
   * Get student grades summary
   * GET /academics/students/:id/grades
   */
  @Get(':id/grades')
  async getStudentGrades(
    @Param('id') studentId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('termId') termId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<any> {
    const context = this.buildContext(tenant, req);
    // TODO: Implement grades service
    // For now, return placeholder
    return {
      studentId,
      academicYearId,
      termId,
      grades: [],
      gpa: null,
      message: 'Grades module not yet implemented',
    };
  }

  // ============================================
  // Generic Student CRUD (MUST be after specific nested routes)
  // ============================================

  /**
   * Get student by ID
   * GET /academics/students/:id
   */
  @Get(':id')
  async getStudent(
    @Param('id') studentId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StudentResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.studentsService.getStudent(studentId, context);
  }

  /**
   * Update student
   * PATCH /academics/students/:id
   */
  @Patch(':id')
  async updateStudent(
    @Param('id') studentId: string,
    @Body() updateStudentDto: UpdateStudentDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StudentResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.studentsService.updateStudent(studentId, updateStudentDto, context);
  }

  /**
   * Delete student (soft delete)
   * DELETE /academics/students/:id
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteStudent(
    @Param('id') studentId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<void> {
    const context = this.buildContext(tenant, req);
    return this.studentsService.deleteStudent(studentId, context);
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

