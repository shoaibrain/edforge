/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
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
  Req
} from '@nestjs/common';
import { SchoolsService } from './schools.service';
import { CreateSchoolDto, UpdateSchoolDto, CreateDepartmentDto, CreateAcademicYearDto, CreateSchoolConfigurationDto, GenerateSchoolReportDto } from './dto/create-school.dto';
import { TenantCredentials } from '@app/auth/auth.decorator';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';

@Controller('schools')
export class SchoolsController {
  constructor(private readonly schoolsService: SchoolsService) {}

  // School Management Endpoints
  @Post()
  @UseGuards(JwtAuthGuard)
  async createSchool(
    @Body() createSchoolDto: CreateSchoolDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.schoolsService.createSchool(tenant.tenantId, createSchoolDto, jwtToken);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async getSchools(@TenantCredentials() tenant, @Req() req) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.schoolsService.getSchools(tenant.tenantId, jwtToken);
  }

  @Get(':schoolId')
  @UseGuards(JwtAuthGuard)
  async getSchool(@Param('schoolId') schoolId: string, @TenantCredentials() tenant, @Req() req) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.schoolsService.getSchool(tenant.tenantId, schoolId, jwtToken);
  }

  @Put(':schoolId')
  @UseGuards(JwtAuthGuard)
  async updateSchool(
    @Param('schoolId') schoolId: string,
    @Body() updateSchoolDto: UpdateSchoolDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.schoolsService.updateSchool(tenant.tenantId, schoolId, updateSchoolDto, jwtToken);
  }

  @Delete(':schoolId')
  @UseGuards(JwtAuthGuard)
  async deleteSchool(@Param('schoolId') schoolId: string, @TenantCredentials() tenant, @Req() req) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    await this.schoolsService.deleteSchool(tenant.tenantId, schoolId, jwtToken);
    return { message: 'School deleted successfully' };
  }

  // Department Management Endpoints
  @Post(':schoolId/departments')
  @UseGuards(JwtAuthGuard)
  async createDepartment(
    @Param('schoolId') schoolId: string,
    @Body() createDepartmentDto: CreateDepartmentDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.schoolsService.createDepartment(tenant.tenantId, schoolId, createDepartmentDto, jwtToken);
  }

  @Get(':schoolId/departments')
  @UseGuards(JwtAuthGuard)
  async getDepartments(@Param('schoolId') schoolId: string, @TenantCredentials() tenant, @Req() req) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.schoolsService.getDepartments(tenant.tenantId, schoolId, jwtToken);
  }

  // Academic Year Management Endpoints
  @Post(':schoolId/academic-years')
  @UseGuards(JwtAuthGuard)
  async createAcademicYear(
    @Param('schoolId') schoolId: string,
    @Body() createAcademicYearDto: CreateAcademicYearDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.schoolsService.createAcademicYear(tenant.tenantId, schoolId, createAcademicYearDto, jwtToken);
  }

  @Get(':schoolId/academic-years')
  @UseGuards(JwtAuthGuard)
  async getAcademicYears(@Param('schoolId') schoolId: string, @TenantCredentials() tenant, @Req() req) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.schoolsService.getAcademicYears(tenant.tenantId, schoolId, jwtToken);
  }

  @Put(':schoolId/academic-years/:academicYearId/set-current')
  @UseGuards(JwtAuthGuard)
  async setCurrentAcademicYear(
    @Param('schoolId') schoolId: string,
    @Param('academicYearId') academicYearId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    await this.schoolsService.setCurrentAcademicYear(tenant.tenantId, schoolId, academicYearId, jwtToken);
    return { message: 'Current academic year updated successfully' };
  }

  // School Configuration Endpoints
  @Post(':schoolId/configuration')
  @UseGuards(JwtAuthGuard)
  async createSchoolConfiguration(
    @Param('schoolId') schoolId: string,
    @Body() createConfigDto: CreateSchoolConfigurationDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.schoolsService.createSchoolConfiguration(tenant.tenantId, schoolId, createConfigDto, jwtToken);
  }

  @Get(':schoolId/configuration')
  @UseGuards(JwtAuthGuard)
  async getSchoolConfiguration(@Param('schoolId') schoolId: string, @TenantCredentials() tenant, @Req() req) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.schoolsService.getSchoolConfiguration(tenant.tenantId, schoolId, jwtToken);
  }

  // School Reporting Endpoints
  @Post(':schoolId/reports')
  @UseGuards(JwtAuthGuard)
  async generateSchoolReport(
    @Param('schoolId') schoolId: string,
    @Body() generateReportDto: GenerateSchoolReportDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.schoolsService.generateSchoolReport(tenant.tenantId, schoolId, generateReportDto, jwtToken);
  }

  // Health check endpoint
  @Get('/health')
  @SetMetadata('isPublic', true)
  health() {
    return { status: 'ok', service: 'school-management' };
  }
}
