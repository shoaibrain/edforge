/**
 * Academic Years Controller - Academic year management endpoints
 */

import {
  Controller,
  Get,
  Post,
  Put,
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
import { AcademicYearsService } from './academic-years.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import {
  CreateAcademicYearDto,
  UpdateAcademicYearDto,
  UpdateAcademicYearStatusDto,
  AcademicYearResponseDto,
  AcademicYearListResponseDto,
  CreateGradingPeriodDto,
  UpdateGradingPeriodDto,
  GradingPeriodResponseDto,
  GradingPeriodListResponseDto,
  CreateHolidayDto,
  HolidayResponseDto,
  HolidayListResponseDto,
} from '../common/dto/academic-year.dto';
import { RequestContext } from '../common/entities';

@Controller('schools/:schoolId/academic-years')
@UseGuards(JwtAuthGuard)
export class AcademicYearsController {
  constructor(private readonly academicYearsService: AcademicYearsService) {}

  // ============================================
  // Academic Year Endpoints
  // ============================================

  /**
   * Create academic year
   * POST /schools/:schoolId/academic-years
   */
  @Post()
  async createAcademicYear(
    @Param('schoolId') schoolId: string,
    @Body() createDto: CreateAcademicYearDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<AcademicYearResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.academicYearsService.createAcademicYear(schoolId, createDto, context);
  }

  /**
   * List academic years
   * GET /schools/:schoolId/academic-years
   */
  @Get()
  async listAcademicYears(
    @Param('schoolId') schoolId: string,
    @Query('limit') limit: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<AcademicYearListResponseDto> {
    const context = this.buildContext(tenant, req);
    const result = await this.academicYearsService.listAcademicYears(
      schoolId,
      context,
      limit ? parseInt(limit, 10) : 20
    );
    return {
      items: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Get current academic year
   * GET /schools/:schoolId/academic-years/current
   */
  @Get('current')
  async getCurrentAcademicYear(
    @Param('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<AcademicYearResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.academicYearsService.getCurrentAcademicYear(schoolId, context);
  }

  // ============================================
  // Specific nested routes (MUST be defined BEFORE generic :yearId routes)
  // NestJS evaluates routes in definition order
  // ============================================

  /**
   * Set academic year as current
   * PUT /schools/:schoolId/academic-years/:yearId/set-current
   */
  @Put(':yearId/set-current')
  async setCurrentAcademicYear(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<AcademicYearResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.academicYearsService.setCurrentAcademicYear(schoolId, yearId, context);
  }

  /**
   * Update academic year status
   * PUT /schools/:schoolId/academic-years/:yearId/status
   */
  @Put(':yearId/status')
  async updateAcademicYearStatus(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Body() updateDto: UpdateAcademicYearStatusDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<AcademicYearResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.academicYearsService.updateAcademicYearStatus(schoolId, yearId, updateDto, context);
  }

  // ============================================
  // Generic academic year CRUD (MUST be after specific nested routes)
  // ============================================

  /**
   * Get academic year by ID
   * GET /schools/:schoolId/academic-years/:yearId
   */
  @Get(':yearId')
  async getAcademicYear(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<AcademicYearResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.academicYearsService.getAcademicYear(schoolId, yearId, context);
  }

  /**
   * Update academic year
   * PUT /schools/:schoolId/academic-years/:yearId
   */
  @Put(':yearId')
  async updateAcademicYear(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Body() updateDto: UpdateAcademicYearDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<AcademicYearResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.academicYearsService.updateAcademicYear(schoolId, yearId, updateDto, context);
  }

  // ============================================
  // Grading Period Endpoints
  // ============================================

  /**
   * Create grading period
   * POST /schools/:schoolId/academic-years/:yearId/grading-periods
   */
  @Post(':yearId/grading-periods')
  async createGradingPeriod(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Body() createDto: CreateGradingPeriodDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<GradingPeriodResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.academicYearsService.createGradingPeriod(schoolId, yearId, createDto, context);
  }

  /**
   * List grading periods
   * GET /schools/:schoolId/academic-years/:yearId/grading-periods
   */
  @Get(':yearId/grading-periods')
  async listGradingPeriods(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<GradingPeriodListResponseDto> {
    const context = this.buildContext(tenant, req);
    const result = await this.academicYearsService.listGradingPeriods(schoolId, yearId, context);
    return {
      items: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Update grading period
   * PUT /schools/:schoolId/academic-years/:yearId/grading-periods/:termId
   */
  @Put(':yearId/grading-periods/:termId')
  async updateGradingPeriod(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Param('termId') termId: string,
    @Body() updateDto: UpdateGradingPeriodDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<GradingPeriodResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.academicYearsService.updateGradingPeriod(schoolId, yearId, termId, updateDto, context);
  }

  // ============================================
  // Holiday Endpoints
  // ============================================

  /**
   * Create holiday
   * POST /schools/:schoolId/academic-years/:yearId/holidays
   */
  @Post(':yearId/holidays')
  async createHoliday(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Body() createDto: CreateHolidayDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<HolidayResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.academicYearsService.createHoliday(schoolId, yearId, createDto, context);
  }

  /**
   * List holidays
   * GET /schools/:schoolId/academic-years/:yearId/holidays
   */
  @Get(':yearId/holidays')
  async listHolidays(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<HolidayListResponseDto> {
    const context = this.buildContext(tenant, req);
    const result = await this.academicYearsService.listHolidays(schoolId, yearId, context);
    return {
      items: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Delete holiday
   * DELETE /schools/:schoolId/academic-years/:yearId/holidays/:holidayId
   */
  @Delete(':yearId/holidays/:holidayId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteHoliday(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Param('holidayId') holidayId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<void> {
    const context = this.buildContext(tenant, req);
    return this.academicYearsService.deleteHoliday(schoolId, yearId, holidayId, context);
  }

  // ============================================
  // Helper Methods
  // ============================================

  private buildContext(tenant: TenantContext, req: Request): RequestContext {
    return {
      userId: tenant.userId,
      tenantId: tenant.tenantId,
      email: tenant.email,
      globalRole: tenant.globalRole,
      jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
      username: tenant.username,
    };
  }
}

