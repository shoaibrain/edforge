/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Schools Controller -  for Enterprise Architecture
 * 
 * ARCHITECTURE:
 * - Controller extracts context from HTTP request
 * - Services handle business logic
 * - Validation happens before any DB operations
 * - Events published automatically
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
  SetMetadata,
  Req,
  Query
} from '@nestjs/common';
import { SchoolsService } from './schools.service';
import { AcademicYearService } from './services/academic-year.service';
import {
  CreateSchoolDto,
  UpdateSchoolDto,
  CreateDepartmentDto,
  CreateAcademicYearDto,
  UpdateAcademicYearDto,
  CreateGradingPeriodDto,
  CreateHolidayDto
} from './dto/school.dto';
import { TenantCredentials } from '@app/auth/auth.decorator';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { RequestContext } from './entities/school.entity.enhanced';

@Controller('schools')
export class SchoolsController {
  constructor(
    private readonly schoolsService: SchoolsService,
    private readonly academicYearService: AcademicYearService
  ) {}

  /**
   * Build RequestContext from incoming request
   * 
   * REQUEST CONTEXT contains audit information:
   * - userId: From JWT (req.user.sub)
   * - userRole: From JWT custom claims
   * - tenantId: From JWT custom claims
   * - ipAddress: From request
   * - userAgent: From headers
   * - jwtToken: For downstream service calls
   * 
   * This is used for:
   * - Audit logging (WHO did WHAT, WHEN, WHERE)
   * - Event publishing (track actor)
   * - Security monitoring
   */
  private buildContext(req: any, tenant: any): RequestContext {
    return {
      userId: req.user?.userId || 'unknown', // Use userId from JWT strategy, not sub
      userRole: req.user?.['custom:userRole'] || 'user',
      userName: req.user?.username || req.user?.email,
      tenantId: tenant.tenantId,
      ipAddress: req.ip || req.connection?.remoteAddress,
      userAgent: req.headers['user-agent'],
      sessionId: req.headers['x-session-id'],
      jwtToken: req.headers.authorization?.replace('Bearer ', '') || ''
    };
  }

  // ========================
  // School Management
  // ========================

  @Post()
  @UseGuards(JwtAuthGuard)
  async createSchool(
    @Body() createDto: CreateSchoolDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return await this.schoolsService.createSchool(tenant.tenantId, createDto, context);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async getSchools(
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.schoolsService.getSchools(tenant.tenantId, jwtToken);
  }

  @Get(':schoolId')
  @UseGuards(JwtAuthGuard)
  async getSchool(
    @Param('schoolId') schoolId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.schoolsService.getSchool(tenant.tenantId, schoolId, jwtToken);
  }

  @Put(':schoolId')
  @UseGuards(JwtAuthGuard)
  async updateSchool(
    @Param('schoolId') schoolId: string,
    @Body() updateDto: UpdateSchoolDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return await this.schoolsService.updateSchool(
      tenant.tenantId,
      schoolId,
      updateDto,
      context
    );
  }

  @Delete(':schoolId')
  @UseGuards(JwtAuthGuard)
  async deleteSchool(
    @Param('schoolId') schoolId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    await this.schoolsService.deleteSchool(tenant.tenantId, schoolId, context);
    return { message: 'School deleted successfully' };
  }

  // ========================
  // School Configuration
  // ========================

  @Get(':schoolId/configuration')
  @UseGuards(JwtAuthGuard)
  async getSchoolConfiguration(
    @Param('schoolId') schoolId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.schoolsService.getSchoolConfiguration(tenant.tenantId, schoolId, jwtToken);
  }

  @Put(':schoolId/configuration')
  @UseGuards(JwtAuthGuard)
  async upsertSchoolConfiguration(
    @Param('schoolId') schoolId: string,
    @Body() configDto: any,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return await this.schoolsService.upsertSchoolConfiguration(
      tenant.tenantId,
      schoolId,
      configDto,
      context
    );
  }

  // ========================
  // Department Management
  // ========================

  @Post(':schoolId/departments')
  @UseGuards(JwtAuthGuard)
  async createDepartment(
    @Param('schoolId') schoolId: string,
    @Body() createDto: CreateDepartmentDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return await this.schoolsService.createDepartment(tenant.tenantId, schoolId, createDto, context);
  }

  @Get(':schoolId/departments')
  @UseGuards(JwtAuthGuard)
  async getDepartments(
    @Param('schoolId') schoolId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.schoolsService.getDepartments(tenant.tenantId, schoolId, jwtToken);
  }

  // ========================
  // Academic Year Management (Delegated to AcademicYearService)
  // ========================

  @Post(':schoolId/academic-years')
  @UseGuards(JwtAuthGuard)
  async createAcademicYear(
    @Param('schoolId') schoolId: string,
    @Body() createDto: CreateAcademicYearDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return await this.academicYearService.createAcademicYear(
      tenant.tenantId,
      schoolId,
      createDto,
      context
    );
  }

  @Get(':schoolId/academic-years')
  @UseGuards(JwtAuthGuard)
  async getAcademicYears(
    @Param('schoolId') schoolId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.academicYearService.getAcademicYears(
      tenant.tenantId,
      schoolId,
      jwtToken
    );
  }

  @Get(':schoolId/academic-years/current')
  @UseGuards(JwtAuthGuard)
  async getCurrentAcademicYear(
    @Param('schoolId') schoolId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.academicYearService.getCurrentAcademicYear(
      tenant.tenantId,
      schoolId,
      jwtToken
    );
  }

  @Get(':schoolId/academic-years/:yearId')
  @UseGuards(JwtAuthGuard)
  async getAcademicYear(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.academicYearService.getAcademicYear(
      tenant.tenantId,
      schoolId,
      yearId,
      jwtToken
    );
  }

  @Put(':schoolId/academic-years/:yearId')
  @UseGuards(JwtAuthGuard)
  async updateAcademicYear(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Body() updateDto: UpdateAcademicYearDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return await this.academicYearService.updateAcademicYear(
      tenant.tenantId,
      schoolId,
      yearId,
      updateDto,
      context
    );
  }

  @Put(':schoolId/academic-years/:yearId/set-current')
  @UseGuards(JwtAuthGuard)
  async setCurrentAcademicYear(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    await this.academicYearService.setAsCurrentYear(
      tenant.tenantId,
      schoolId,
      yearId,
      context
    );
    return { message: 'Current academic year updated successfully' };
  }

  @Put(':schoolId/academic-years/:yearId/status')
  @UseGuards(JwtAuthGuard)
  async updateAcademicYearStatus(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Body() body: { status: string },
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return await this.academicYearService.updateAcademicYearStatus(
      tenant.tenantId,
      schoolId,
      yearId,
      body.status as any,
      context
    );
  }

  // ========================
  // Grading Period Management
  // ========================

  @Post(':schoolId/academic-years/:yearId/grading-periods')
  @UseGuards(JwtAuthGuard)
  async createGradingPeriod(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Body() createDto: CreateGradingPeriodDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return await this.academicYearService.createGradingPeriod(
      tenant.tenantId,
      schoolId,
      yearId,
      createDto,
      context
    );
  }

  @Get(':schoolId/academic-years/:yearId/grading-periods')
  @UseGuards(JwtAuthGuard)
  async getGradingPeriods(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.academicYearService.getGradingPeriods(
      tenant.tenantId,
      schoolId,
      yearId,
      jwtToken
    );
  }

  // ========================
  // Holiday Management
  // ========================

  @Post(':schoolId/academic-years/:yearId/holidays')
  @UseGuards(JwtAuthGuard)
  async createHoliday(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Body() createDto: CreateHolidayDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return await this.academicYearService.createHoliday(
      tenant.tenantId,
      schoolId,
      yearId,
      createDto,
      context
    );
  }

  @Get(':schoolId/academic-years/:yearId/holidays')
  @UseGuards(JwtAuthGuard)
  async getHolidays(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.academicYearService.getHolidays(
      tenant.tenantId,
      schoolId,
      yearId,
      jwtToken
    );
  }

  // ========================
  // Health Check
  // ========================

  @Get('health')
  @SetMetadata('isPublic', true)
  health() {
    return {
      status: 'ok',
      service: 'school-service-enhanced',
      version: '2.0.0',
      timestamp: new Date().toISOString()
    };
  }
}
