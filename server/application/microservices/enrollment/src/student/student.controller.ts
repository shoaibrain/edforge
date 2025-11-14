/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Student Controller - REST API endpoints for Student management
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  Query
} from '@nestjs/common';
import { StudentService } from './student.service';
import { CreateStudentDto, UpdateStudentDto } from './dto/student.dto';
import { TenantCredentials } from '@app/auth/auth.decorator';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { RequestContext } from '../common/entities/base.entity';
import { ValidationService } from '../common/services/validation.service';

@Controller('students')
@UseGuards(JwtAuthGuard)
export class StudentController {
  constructor(
    private readonly studentService: StudentService,
    private readonly validationService: ValidationService
  ) {}

  /**
   * Extract request context from JWT token
   */
  private getRequestContext(@Req() req: any, @TenantCredentials() tenant: any): RequestContext {
    return {
      tenantId: tenant.tenantId,
      userId: tenant.userId || req.user?.sub || 'system',
      userRole: tenant.role || req.user?.role || 'user',
      userName: tenant.userName || req.user?.name,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      sessionId: req.sessionID
    };
  }

  /**
   * Create Student
   * POST /students
   */
  @Post()
  async createStudent(
    @Body() createStudentDto: CreateStudentDto,
    @Req() req: any,
    @TenantCredentials() tenant: any
  ) {
    // Validate input before processing
    await this.validationService.validateStudentCreation(tenant.tenantId, createStudentDto);
    
    const context = this.getRequestContext(req, tenant);
    return this.studentService.createStudent(tenant.tenantId, createStudentDto, context);
  }

  /**
   * Get Student by ID
   * GET /students/:studentId
   */
  @Get(':studentId')
  async getStudent(
    @Param('studentId') studentId: string,
    @TenantCredentials() tenant: any
  ) {
    return this.studentService.getStudent(tenant.tenantId, studentId);
  }

  /**
   * Update Student
   * PUT /students/:studentId
   */
  @Put(':studentId')
  async updateStudent(
    @Param('studentId') studentId: string,
    @Body() updateStudentDto: UpdateStudentDto,
    @Req() req: any,
    @TenantCredentials() tenant: any
  ) {
    // Validate input before processing
    await this.validationService.validateStudentUpdate(tenant.tenantId, studentId, updateStudentDto);
    
    const context = this.getRequestContext(req, tenant);
    return this.studentService.updateStudent(tenant.tenantId, studentId, updateStudentDto, context);
  }

  /**
   * List Students by School/Year
   * GET /students?schoolId=xxx&academicYearId=yyy
   */
  @Get()
  async listStudents(
    @Query('schoolId') schoolId?: string,
    @Query('academicYearId') academicYearId?: string,
    @TenantCredentials() tenant?: any
  ) {
    if (schoolId && academicYearId) {
      return this.studentService.listStudentsBySchoolYear(tenant.tenantId, schoolId, academicYearId);
    } else if (schoolId) {
      return this.studentService.listStudentsBySchool(tenant.tenantId, schoolId);
    }
    // TODO: Add tenant-wide listing if needed
    return [];
  }

  /**
   * Get Student Enrollment History
   * GET /students/:studentId/enrollments
   */
  @Get(':studentId/enrollments')
  async getStudentEnrollmentHistory(
    @Param('studentId') studentId: string,
    @TenantCredentials() tenant: any
  ) {
    return this.studentService.getStudentEnrollmentHistory(tenant.tenantId, studentId);
  }

  /**
   * Delete Student
   * DELETE /students/:studentId
   */
  @Delete(':studentId')
  async deleteStudent(
    @Param('studentId') studentId: string,
    @Req() req: any,
    @TenantCredentials() tenant: any
  ) {
    const context = this.getRequestContext(req, tenant);
    await this.studentService.deleteStudent(tenant.tenantId, studentId, context);
    return { message: 'Student deleted successfully' };
  }
}

