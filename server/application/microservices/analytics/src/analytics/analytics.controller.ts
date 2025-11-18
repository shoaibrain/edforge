/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Analytics Controller - Dashboard endpoints for principals and teachers
 */

import { Controller, Get, Param, Query, UseGuards, Req } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { TenantCredentials } from '@app/auth/auth.decorator';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * Principal Dashboard - School-wide analytics
   */
  @Get('dashboards/principals/:schoolId')
  async getPrincipalDashboard(
    @Param('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant,
    @Req() req,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return this.analyticsService.getPrincipalDashboard(
      tenant.tenantId,
      schoolId,
      academicYearId,
      { startDate, endDate },
      jwtToken
    );
  }

  /**
   * Teacher Dashboard - Classroom-specific analytics
   */
  @Get('dashboards/teachers/:teacherId')
  async getTeacherDashboard(
    @Param('teacherId') teacherId: string,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant,
    @Req() req,
    @Query('classroomId') classroomId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return this.analyticsService.getTeacherDashboard(
      tenant.tenantId,
      teacherId,
      academicYearId,
      { classroomId, startDate, endDate },
      jwtToken
    );
  }

  /**
   * Student Performance Analytics
   */
  @Get('students/:studentId/performance')
  async getStudentPerformance(
    @Param('studentId') studentId: string,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant,
    @Req() req
  ): Promise<any> {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return this.analyticsService.getStudentPerformance(
      tenant.tenantId,
      studentId,
      academicYearId,
      jwtToken
    );
  }

  /**
   * At-Risk Students Identification
   */
  @Get('schools/:schoolId/at-risk-students')
  async getAtRiskStudents(
    @Param('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant,
    @Req() req,
    @Query('threshold') threshold?: number
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return this.analyticsService.getAtRiskStudents(
      tenant.tenantId,
      schoolId,
      academicYearId,
      threshold || 60, // Default 60% threshold
      jwtToken
    );
  }

  /**
   * Achievement Gap Analysis
   */
  @Get('schools/:schoolId/achievement-gaps')
  async getAchievementGaps(
    @Param('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant,
    @Req() req,
    @Query('demographic') demographic?: string
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return this.analyticsService.getAchievementGaps(
      tenant.tenantId,
      schoolId,
      academicYearId,
      demographic,
      jwtToken
    );
  }
}

