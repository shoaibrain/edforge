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
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { StudentsService, StudentProfileDto } from './students.service';
import { EnrollmentService } from '../enrollment/enrollment.service';
import { AttendanceService } from '../attendance/attendance.service';
import { SectionEnrollmentService } from '../sections/section-enrollment.service';
import { GradesService } from '../grades/grades.service';
import { GpaCalculatorService, GpaResult } from '../grades/gpa-calculator.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
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
  private readonly logger = new Logger(StudentsController.name);

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
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'students', action: 'create' })
  async createStudent(
    @Body() createStudentDto: CreateStudentDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StudentResponseDto> {
    this.logger.log(`POST /academics/students — body keys=${Object.keys(createStudentDto).join(',')}`);
    const context = this.buildContext(tenant, req);
    return this.studentsService.createStudent(createStudentDto, context);
  }

  /**
   * List students for a school
   * GET /academics/students?schoolId=xxx
   */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'students', action: 'view' })
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
    this.logger.log(`GET /academics/students — schoolId=${schoolId} gradeLevel=${gradeLevel || 'all'} status=${status || 'all'} search=${search ? '[provided]' : '[none]'} limit=${limit || '50'} cursor=${cursor ? '[provided]' : '[none]'}`);
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
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'students', action: 'view' })
  async checkDuplicate(
    @Query('firstName') firstName: string,
    @Query('lastName') lastName: string,
    @Query('dateOfBirth') dateOfBirth: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<{ exists: boolean; matches: StudentResponseDto[] }> {
    this.logger.log(`GET /academics/students/check-duplicate — firstName=[provided] lastName=[provided] dateOfBirth=[provided] schoolId=${schoolId}`);
    const context = this.buildContext(tenant, req);
    return this.studentsService.checkDuplicate(firstName, lastName, dateOfBirth, schoolId, context);
  }

  /**
   * Detailed duplicate check with confidence levels
   * POST /academics/students/check-duplicate
   * Returns { hasDuplicates, matches[] } for frontend DuplicateCheckResult
   */
  @Post('check-duplicate')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'students', action: 'view' })
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
    this.logger.log(`POST /academics/students/check-duplicate — firstName=[provided] lastName=[provided] dateOfBirth=[provided] schoolId=${body.schoolId}`);
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
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'students', action: 'create' })
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
    this.logger.log(`POST /academics/students/import — schoolId=${body.schoolId} studentCount=${body.students?.length || 0}`);
    const context = this.buildContext(tenant, req);
    return this.studentsService.importStudents(body.students, body.schoolId, context);
  }

  /**
   * Bulk import students from a Nepal IEMIS CSV export.
   * POST /academics/students/import/iemis
   *
   * Body:
   *   - students: raw IEMIS rows (see `IemisRow` interface)
   *   - schoolId: destination school (must be PABSON archetype)
   *   - dryRun: if true, transform + dedup but skip DDB writes
   *
   * Returns structured findings (errors + warnings) per row, dedup results,
   * and import counts. Cap of 1000 rows per request; 779 Saraswati rows fit.
   */
  @Post('import/iemis')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'students', action: 'create' })
  async importStudentsIemis(
    @Body() body: {
      students: Array<Record<string, unknown>>;
      schoolId: string;
      dryRun?: boolean;
    },
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<{
    succeeded: number;
    failed: number;
    skipped: number;
    findings: Array<{ row: number; field: string; level: 'warn' | 'error'; message: string }>;
    duplicates: Array<{ row: number; emisStudentId: string; existingStudentId: string }>;
  }> {
    this.logger.log(
      `POST /academics/students/import/iemis — schoolId=${body.schoolId} rows=${body.students?.length ?? 0} dryRun=${!!body.dryRun}`,
    );
    const context = this.buildContext(tenant, req);
    return this.studentsService.importStudentsIemis(
      body.students as any,
      body.schoolId,
      context,
      { dryRun: body.dryRun },
    );
  }

  // ============================================
  // Student-Centric Views (MUST be defined BEFORE generic :id routes)
  // NestJS evaluates routes in definition order
  // ============================================

  /**
   * Get student profile with aggregated data
   * GET /academics/students/:id/profile?schoolId=xxx
   */
  @Get(':id/profile')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'students', action: 'view' })
  async getStudentProfile(
    @Param('id') studentId: string,
    @Query('schoolId') _schoolId: string, // extracted by PermissionGuard
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StudentProfileDto> {
    this.logger.log(`GET /academics/students/${studentId}/profile — schoolId=${_schoolId}`);
    const context = this.buildContext(tenant, req);
    return this.studentsService.getStudentProfile(studentId, context);
  }

  /**
   * Get student enrollment history
   * GET /academics/students/:id/enrollments?schoolId=xxx
   */
  @Get(':id/enrollments')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'enrollment', action: 'view' })
  async getStudentEnrollments(
    @Param('id') studentId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<EnrollmentListResponseDto> {
    this.logger.log(`GET /academics/students/${studentId}/enrollments — schoolId=${schoolId}`);
    const context = this.buildContext(tenant, req);
    const enrollments = await this.enrollmentService.getStudentEnrollmentHistory(studentId, context, schoolId);
    return {
      items: enrollments,
      hasMore: false,
    };
  }

  /**
   * Get student attendance summary
   * GET /academics/students/:id/attendance/summary?schoolId=xxx&academicYearId=xxx
   * NOTE: Must be before :id/attendance to match correctly
   */
  @Get(':id/attendance/summary')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'attendance', action: 'view' })
  async getStudentAttendanceSummary(
    @Param('id') studentId: string,
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StudentAttendanceSummaryDto> {
    this.logger.log(`GET /academics/students/${studentId}/attendance/summary — schoolId=${schoolId} academicYearId=${academicYearId || '[none]'}`);
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
   * GET /academics/students/:id/attendance?schoolId=xxx
   */
  @Get(':id/attendance')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'attendance', action: 'view' })
  async getStudentAttendance(
    @Param('id') studentId: string,
    @Query('schoolId') schoolId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<AttendanceListResponseDto> {
    this.logger.log(`GET /academics/students/${studentId}/attendance — schoolId=${schoolId} startDate=${startDate || '[none]'} endDate=${endDate || '[none]'}`);
    const context = this.buildContext(tenant, req);
    const attendanceRecords = await this.attendanceService.getStudentAttendance(
      studentId,
      startDate,
      endDate,
      context,
      schoolId,
    );
    return {
      items: attendanceRecords,
      hasMore: false,
    };
  }

  /**
   * Get sections a student is enrolled in
   * GET /academics/students/:id/sections?schoolId=xxx&academicYearId=xxx
   */
  @Get(':id/sections')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'scheduling', action: 'view' })
  async getStudentSections(
    @Param('id') studentId: string,
    @Query('schoolId') _schoolId: string, // extracted by PermissionGuard
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<StudentSectionResponseDto[]> {
    this.logger.log(`GET /academics/students/${studentId}/sections — schoolId=${_schoolId} academicYearId=${academicYearId || '[none]'}`);
    const context = this.buildContext(tenant, req);
    return this.sectionEnrollmentService.getStudentSections(studentId, academicYearId, context);
  }

  /**
   * Get student grades and GPA
   * GET /academics/students/:id/grades?schoolId=xxx&academicYearId=xxx&termId=xxx
   */
  @Get(':id/grades')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'grades', action: 'view' })
  async getStudentGrades(
    @Param('id') studentId: string,
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('termId') termId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<{ studentId: string; academicYearId: string; grades: GradeResponseDto[]; gpa: GpaResult | null }> {
    this.logger.log(`GET /academics/students/${studentId}/grades — schoolId=${schoolId} academicYearId=${academicYearId || '[none]'} termId=${termId || '[none]'}`);
    const context = this.buildContext(tenant, req);

    const grades = await this.gradesService.getStudentGrades(studentId, academicYearId, context, termId, schoolId);

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
   * GET /academics/students/:id?schoolId=xxx
   */
  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'students', action: 'view' })
  async getStudent(
    @Param('id') studentId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StudentResponseDto> {
    this.logger.log(`GET /academics/students/${studentId} — schoolId=${schoolId}`);
    const context = this.buildContext(tenant, req);
    return this.studentsService.getStudent(studentId, context, schoolId);
  }

  /**
   * Update student
   * PATCH /academics/students/:id?schoolId=xxx
   */
  /**
   * Link a guardian to a user account (portal access)
   * POST /academics/students/:id/link-guardian?schoolId=xxx
   */
  @Post(':id/link-guardian')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'students', action: 'edit' })
  async linkGuardianToUser(
    @Param('id') studentId: string,
    @Body() body: { userId: string; guardianId?: string; guardianEmail: string },
    @Query('schoolId') _schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<{ linked: boolean }> {
    this.logger.log(`POST /academics/students/${studentId}/link-guardian — schoolId=${_schoolId} userId=${body.userId} guardianId=${body.guardianId || '[none]'} guardianEmail=[provided]`);
    const context = this.buildContext(tenant, req);
    await this.studentsService.linkGuardianToUser(
      studentId,
      body.userId,
      body.guardianId,
      body.guardianEmail,
      context,
    );
    return { linked: true };
  }

  @Patch(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'students', action: 'edit' })
  async updateStudent(
    @Param('id') studentId: string,
    @Body() updateStudentDto: UpdateStudentDtoZ,
    @Query('schoolId') _schoolId: string, // extracted by PermissionGuard
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StudentResponseDto> {
    this.logger.log(`PATCH /academics/students/${studentId} — schoolId=${_schoolId} body keys=${Object.keys(updateStudentDto).join(',')}`);
    const context = this.buildContext(tenant, req);
    return this.studentsService.updateStudent(studentId, updateStudentDto, context);
  }

  /**
   * Delete student (soft delete)
   * DELETE /academics/students/:id?schoolId=xxx
   */
  @Delete(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'students', action: 'delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteStudent(
    @Param('id') studentId: string,
    @Query('schoolId') _schoolId: string, // extracted by PermissionGuard
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<void> {
    this.logger.log(`DELETE /academics/students/${studentId} — schoolId=${_schoolId}`);
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
