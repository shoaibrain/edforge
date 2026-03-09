/**
 * Section Attendance Controller (Ed-Fi: StudentSectionAttendanceEvent)
 *
 * Endpoints for per-section attendance CRUD.
 * Section attendance is the primary entry point for teachers.
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { SectionAttendanceService } from './section-attendance.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import {
  CreateSectionAttendanceDto,
  BulkSectionAttendanceDto,
  UpdateSectionAttendanceDto,
  SectionAttendanceResponseDto,
  BulkSectionAttendanceResponseDto,
} from '@aibrains/shared-types';
import { RequestContext } from '../common/entities';

interface SectionAttendanceListResponseDto {
  items: SectionAttendanceResponseDto[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
}

@Controller('academics/section-attendance')
@UseGuards(JwtAuthGuard)
export class SectionAttendanceController {
  constructor(
    private readonly sectionAttendanceService: SectionAttendanceService,
  ) {}

  /**
   * Record single section attendance
   * POST /academics/section-attendance
   */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'attendance', action: 'create' })
  async recordSectionAttendance(
    @Body() dto: CreateSectionAttendanceDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<SectionAttendanceResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.sectionAttendanceService.recordSectionAttendance(dto, context);
  }

  /**
   * Record bulk section attendance
   * POST /academics/section-attendance/bulk
   */
  @Post('bulk')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'attendance', action: 'create' })
  async recordBulkSectionAttendance(
    @Body() bulkDto: BulkSectionAttendanceDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<BulkSectionAttendanceResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.sectionAttendanceService.recordBulkSectionAttendance(bulkDto, context);
  }

  /**
   * Get section attendance for a date
   * GET /academics/section-attendance?sectionId=xxx&schoolId=xxx&date=yyyy-mm-dd
   */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'attendance', action: 'view' })
  async getSectionAttendanceByDate(
    @Query('sectionId') sectionId: string,
    @Query('schoolId') schoolId: string,
    @Query('date') date: string,
    @Query('limit') limit: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<SectionAttendanceListResponseDto> {
    const context = this.buildContext(tenant, req);
    const result = await this.sectionAttendanceService.getSectionAttendanceByDate(
      sectionId, schoolId, date, context,
      limit ? parseInt(limit, 10) : 100,
    );
    return {
      items: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Get student section attendance history
   * GET /academics/section-attendance/student/:studentId
   */
  @Get('student/:studentId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'attendance', action: 'view' })
  async getStudentSectionAttendance(
    @Param('studentId') studentId: string,
    @Query('sectionId') sectionId: string,
    @Query('schoolId') schoolId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<SectionAttendanceResponseDto[]> {
    const context = this.buildContext(tenant, req);
    return this.sectionAttendanceService.getStudentSectionAttendance(
      studentId, context,
      sectionId || undefined,
      startDate || undefined,
      endDate || undefined,
      schoolId || undefined,
    );
  }

  /**
   * Update section attendance (correction)
   * PATCH /academics/section-attendance/:date/:sectionId/:studentId?schoolId=xxx
   */
  @Patch(':date/:sectionId/:studentId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'attendance', action: 'edit' })
  async updateSectionAttendance(
    @Param('date') date: string,
    @Param('sectionId') sectionId: string,
    @Param('studentId') studentId: string,
    @Body() updateDto: UpdateSectionAttendanceDto,
    @Query('schoolId') _schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<SectionAttendanceResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.sectionAttendanceService.updateSectionAttendance(
      date, sectionId, studentId, updateDto, context,
    );
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
