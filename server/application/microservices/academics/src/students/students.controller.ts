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
import { StudentsService, StudentProfileDto } from './students.service';
import { EnrollmentService } from '../enrollment/enrollment.service';
import { AttendanceService } from '../attendance/attendance.service';
import { SectionEnrollmentService } from '../sections/section-enrollment.service';
import { GradesService } from '../grades/grades.service';
import { GpaCalculatorService, GpaResult } from '../grades/gpa-calculator.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import {
  StudentResponseDto,
  StudentAttendanceSummaryDto,
  StudentSectionResponseDto,
} from '@aibrains/shared-types';
import { CreateStudentDtoZ, UpdateStudentDtoZ } from '../common/dto/zod-dtos';
import { RequestContext } from '../common/entities';
import { GradeResponseDto } from '../common/mappers/grade.mapper';

// Type aliases for list responses
interface StudentListResponseDto {
  items: StudentResponseDto[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
}

interface EnrollmentListResponseDto {
  items: any[];
  hasMore: boolean;
}

interface AttendanceListResponseDto {
  items: any[];
  hasMore: boolean;
}

@Controller('academics/students')
@UseGuards(JwtAuthGuard)
export class StudentsController {
  constructor(
    private readonly studentsService: StudentsService,
    private readonly enrollmentService: EnrollmentService,
    private readonly attendanceService: AttendanceService,
    private readonly sectionEnrollmentService: SectionEnrollmentService,
    private readonly gradesService: GradesService,
    private readonly gpaCalculatorService: GpaCalculatorService,
  ) {}

  /**
   * Create a new student
   * POST /academics/students
   */
  @Post()
  async createStudent(
    @Body() createStudentDto: CreateStudentDtoZ,
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

  /**
   * Check for duplicate students
   * GET /academics/students/check-duplicate?firstName=x&lastName=x&dateOfBirth=x&schoolId=x
   * MUST be defined BEFORE :id routes to avoid route conflict
   */
  @Get('check-duplicate')
  async checkDuplicate(
    @Query('firstName') firstName: string,
    @Query('lastName') lastName: string,
    @Query('dateOfBirth') dateOfBirth: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<{ exists: boolean; matches: StudentResponseDto[] }> {
    const context = this.buildContext(tenant, req);
    return this.studentsService.checkDuplicate(firstName, lastName, dateOfBirth, schoolId, context);
  }

  /**
   * Detailed duplicate check with confidence levels
   * POST /academics/students/check-duplicate
   * Returns { hasDuplicates, matches[] } for frontend DuplicateCheckResult
   */
  @Post('check-duplicate')
  async checkDuplicateDetailed(
    @Body() body: { firstName: string; lastName: string; dateOfBirth: string; schoolId: string },
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<{
    hasDuplicates: boolean;
    matches: Array<{
      studentId: string;
      firstName: string;
      lastName: string;
      dateOfBirth: string;
      currentGradeLevel?: string;
      status?: string;
      confidence: string;
      matchReasons: string[];
    }>;
  }> {
    const context = this.buildContext(tenant, req);
    const results = await this.studentsService.checkDuplicateDetailed(
      body.firstName, body.lastName, body.dateOfBirth, body.schoolId, context
    );
    return {
      hasDuplicates: results.some(r => r.confidence === 'high' || r.confidence === 'medium'),
      matches: results.map(r => ({
        studentId: r.student.studentId,
        firstName: r.student.firstName,
        lastName: r.student.lastName,
        dateOfBirth: r.student.dateOfBirth,
        currentGradeLevel: r.student.currentGradeLevel,
        status: r.student.status,
        confidence: r.confidence,
        matchReasons: [r.reason],
      })),
    };
  }

  /**
   * Bulk import students from CSV data
   * POST /academics/students/import
   */
  @Post('import')
  async importStudents(
    @Body() body: { students: Record<string, unknown>[]; schoolId: string },
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<{
    imported: number;
    skipped: number;
    errors: Array<{ row: number; field: string; message: string }>;
    duplicates: Array<{ row: number; matches: Array<{ studentId: string; name: string; confidence: string }> }>;
  }> {
    const context = this.buildContext(tenant, req);
    return this.studentsService.importStudents(body.students, body.schoolId, context);
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
   * Get sections a student is enrolled in
   * GET /academics/students/:id/sections?academicYearId=xxx
   */
  @Get(':id/sections')
  async getStudentSections(
    @Param('id') studentId: string,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<StudentSectionResponseDto[]> {
    const context = this.buildContext(tenant, req);
    return this.sectionEnrollmentService.getStudentSections(studentId, academicYearId, context);
  }

  /**
   * Get student grades and GPA
   * GET /academics/students/:id/grades?academicYearId=xxx&termId=xxx
   */
  @Get(':id/grades')
  async getStudentGrades(
    @Param('id') studentId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('termId') termId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<{ studentId: string; academicYearId: string; grades: GradeResponseDto[]; gpa: GpaResult | null }> {
    const context = this.buildContext(tenant, req);

    const grades = await this.gradesService.getStudentGrades(studentId, academicYearId, context, termId);

    let gpa: GpaResult | null = null;
    if (academicYearId) {
      gpa = await this.gpaCalculatorService.calculateGpa(studentId, academicYearId, context);
    }

    return { studentId, academicYearId, grades, gpa };
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
    @Body() updateStudentDto: UpdateStudentDtoZ,
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

