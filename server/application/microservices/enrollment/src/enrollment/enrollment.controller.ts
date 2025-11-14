/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Enrollment Controller - REST API endpoints for Enrollment management
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
import { EnrollmentService } from './enrollment.service';
import {
  CreateEnrollmentDto,
  UpdateEnrollmentStatusDto,
  TransferEnrollmentDto,
  SuspendEnrollmentDto,
  GraduateEnrollmentDto
} from './dto/enrollment.dto';
import { TenantCredentials } from '@app/auth/auth.decorator';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { RequestContext } from '../common/entities/base.entity';
import { ValidationService } from '../common/services/validation.service';

@Controller('enrollments')
@UseGuards(JwtAuthGuard)
export class EnrollmentController {
  constructor(
    private readonly enrollmentService: EnrollmentService,
    private readonly validationService: ValidationService
  ) {}

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
   * Enroll Student
   * POST /enrollments/students/:studentId
   */
  @Post('students/:studentId')
  async enrollStudent(
    @Param('studentId') studentId: string,
    @Body() createEnrollmentDto: CreateEnrollmentDto,
    @Req() req: any,
    @TenantCredentials() tenant: any
  ) {
    // Validate input before processing
    await this.validationService.validateEnrollmentCreation(tenant.tenantId, studentId, createEnrollmentDto);
    
    const context = this.getRequestContext(req, tenant);
    return this.enrollmentService.enrollStudent(tenant.tenantId, studentId, createEnrollmentDto, context);
  }

  /**
   * Get Enrollment by ID
   * GET /enrollments/:enrollmentId
   */
  @Get(':enrollmentId')
  async getEnrollment(
    @Param('enrollmentId') enrollmentId: string,
    @TenantCredentials() tenant: any
  ) {
    return this.enrollmentService.getEnrollment(tenant.tenantId, enrollmentId);
  }

  /**
   * Update Enrollment Status
   * PUT /enrollments/:enrollmentId/status
   */
  @Put(':enrollmentId/status')
  async updateEnrollmentStatus(
    @Param('enrollmentId') enrollmentId: string,
    @Body() updateStatusDto: UpdateEnrollmentStatusDto,
    @Req() req: any,
    @TenantCredentials() tenant: any
  ) {
    // Get current enrollment to validate status transition
    const currentEnrollment = await this.enrollmentService.getEnrollment(tenant.tenantId, enrollmentId);
    await this.validationService.validateEnrollmentStatusTransition(currentEnrollment.status, updateStatusDto.status);
    
    const context = this.getRequestContext(req, tenant);
    return this.enrollmentService.updateEnrollmentStatus(tenant.tenantId, enrollmentId, updateStatusDto, context);
  }

  /**
   * Transfer Student
   * POST /enrollments/:enrollmentId/transfer
   */
  @Post(':enrollmentId/transfer')
  async transferStudent(
    @Param('enrollmentId') enrollmentId: string,
    @Body() transferDto: TransferEnrollmentDto,
    @Req() req: any,
    @TenantCredentials() tenant: any
  ) {
    // Validate transfer before processing
    await this.validationService.validateTransfer(tenant.tenantId, enrollmentId, transferDto);
    
    const context = this.getRequestContext(req, tenant);
    return this.enrollmentService.transferStudent(tenant.tenantId, enrollmentId, transferDto, context);
  }

  /**
   * Suspend Enrollment
   * POST /enrollments/:enrollmentId/suspend
   */
  @Post(':enrollmentId/suspend')
  async suspendEnrollment(
    @Param('enrollmentId') enrollmentId: string,
    @Body() suspendDto: SuspendEnrollmentDto,
    @Req() req: any,
    @TenantCredentials() tenant: any
  ) {
    const context = this.getRequestContext(req, tenant);
    return this.enrollmentService.suspendEnrollment(tenant.tenantId, enrollmentId, suspendDto, context);
  }

  /**
   * Graduate Student
   * POST /enrollments/:enrollmentId/graduate
   */
  @Post(':enrollmentId/graduate')
  async graduateStudent(
    @Param('enrollmentId') enrollmentId: string,
    @Body() graduateDto: GraduateEnrollmentDto,
    @Req() req: any,
    @TenantCredentials() tenant: any
  ) {
    const context = this.getRequestContext(req, tenant);
    return this.enrollmentService.graduateStudent(tenant.tenantId, enrollmentId, graduateDto, context);
  }

  /**
   * Withdraw Student
   * POST /enrollments/:enrollmentId/withdraw
   */
  @Post(':enrollmentId/withdraw')
  async withdrawStudent(
    @Param('enrollmentId') enrollmentId: string,
    @Body() body: { reason: string },
    @Req() req: any,
    @TenantCredentials() tenant: any
  ) {
    const context = this.getRequestContext(req, tenant);
    return this.enrollmentService.withdrawStudent(tenant.tenantId, enrollmentId, body.reason, context);
  }

  /**
   * List Enrollments
   * GET /enrollments?schoolId=xxx&academicYearId=yyy&status=active
   */
  @Get()
  async listEnrollments(
    @Query('schoolId') schoolId?: string,
    @Query('academicYearId') academicYearId?: string,
    @Query('status') status?: string,
    @TenantCredentials() tenant?: any
  ) {
    if (schoolId && academicYearId) {
      return this.enrollmentService.listEnrollmentsBySchoolYear(tenant.tenantId, schoolId, academicYearId, status);
    }
    return [];
  }
}

