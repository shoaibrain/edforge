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
  Query,
  Header,
  Res,
  BadRequestException
} from '@nestjs/common';
import { Response } from 'express';
import { EnrollmentService } from './enrollment.service';
import {
  CreateEnrollmentDto,
  UpdateEnrollmentStatusDto,
  TransferEnrollmentDto,
  SuspendEnrollmentDto,
  GraduateEnrollmentDto,
  BulkEnrollmentDto
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
   * Export Enrollments to CSV
   * Phase 5: Advanced Features - Import/Export Functionality
   * GET /enrollments/export?schoolId=xxx&academicYearId=yyy
   * Note: Must come before @Get(':enrollmentId') to avoid route conflicts
   */
  @Get('export')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="enrollments.csv"')
  async exportEnrollments(
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant: any,
    @Res() res: Response
  ) {
    if (!schoolId || !academicYearId) {
      throw new BadRequestException('schoolId and academicYearId are required for enrollment export.');
    }

    const csv = await this.enrollmentService.exportEnrollmentsToCsv(
      tenant.tenantId,
      schoolId,
      academicYearId
    );

    res.send(csv);
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
   * GET /enrollments?schoolId=xxx&academicYearId=yyy&status=active&limit=50&lastEvaluatedKey=xxx
   * Phase 5: Performance Optimizations - Pagination
   */
  @Get()
  async listEnrollments(
    @Query('schoolId') schoolId?: string,
    @Query('academicYearId') academicYearId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: number,
    @Query('lastEvaluatedKey') lastEvaluatedKey?: string,
    @TenantCredentials() tenant?: any
  ) {
    if (schoolId && academicYearId) {
      const result = await this.enrollmentService.listEnrollmentsBySchoolYear(
        tenant.tenantId,
        schoolId,
        academicYearId,
        status,
        limit || 50,
        lastEvaluatedKey
      );
      
      return {
        items: result.items,
        pagination: {
          limit: limit || 50,
          lastEvaluatedKey: result.lastEvaluatedKey,
          hasMore: result.hasMore,
          itemCount: result.items.length
        }
      };
    }
    return {
      items: [],
      pagination: {
        limit: limit || 50,
        hasMore: false,
        itemCount: 0
      }
    };
  }

  /**
   * Bulk Enrollment
   * POST /enrollments/bulk
   * Phase 5: Advanced Features - Bulk Operations
   * 
   * Processes multiple enrollments in parallel with pre-validation.
   * Returns detailed success/failure results for each enrollment.
   */
  @Post('bulk')
  async bulkEnrollStudents(
    @Body() bulkDto: BulkEnrollmentDto,
    @Req() req: any,
    @TenantCredentials() tenant: any
  ) {
    const context = this.getRequestContext(req, tenant);
    return this.enrollmentService.bulkEnrollStudents(tenant.tenantId, bulkDto, context);
  }
}

