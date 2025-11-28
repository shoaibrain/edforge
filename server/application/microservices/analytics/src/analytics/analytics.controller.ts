/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Analytics Controller - Dashboard endpoints for principals and teachers
 */

import { 
  Controller, 
  Get, 
  Param, 
  Query, 
  UseGuards, 
  Req, 
  HttpException, 
  HttpStatus,
  Logger,
  BadRequestException
} from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { TenantCredentials } from '@app/auth/auth.decorator';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * Validate date format (YYYY-MM-DD)
   */
  private validateDateFormat(date: string): boolean {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return false;
    }
    const parsed = new Date(date);
    return parsed instanceof Date && !isNaN(parsed.getTime());
  }

  /**
   * Validate academic year ID format
   */
  private validateAcademicYearId(academicYearId: string): boolean {
    // Academic year ID should be a non-empty string
    return academicYearId && academicYearId.trim().length > 0;
  }

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
    try {
      // Validate required parameters
      if (!this.validateAcademicYearId(academicYearId)) {
        throw new BadRequestException('academicYearId is required and must be a valid string');
      }

      // Validate date formats if provided
      if (startDate && !this.validateDateFormat(startDate)) {
        throw new BadRequestException('startDate must be in YYYY-MM-DD format');
      }
      if (endDate && !this.validateDateFormat(endDate)) {
        throw new BadRequestException('endDate must be in YYYY-MM-DD format');
      }

      // Validate date range
      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (start > end) {
          throw new BadRequestException('startDate must be before or equal to endDate');
        }
      }

      const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
      
      const result = await this.analyticsService.getPrincipalDashboard(
        tenant.tenantId,
        schoolId,
        academicYearId,
        { startDate, endDate },
        jwtToken
      );

      return result;
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`Error getting principal dashboard: ${error.message}`, error.stack);
      throw new HttpException(
        `Failed to retrieve principal dashboard: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
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
    try {
      // Validate required parameters
      if (!this.validateAcademicYearId(academicYearId)) {
        throw new BadRequestException('academicYearId is required and must be a valid string');
      }

      // Validate date formats if provided
      if (startDate && !this.validateDateFormat(startDate)) {
        throw new BadRequestException('startDate must be in YYYY-MM-DD format');
      }
      if (endDate && !this.validateDateFormat(endDate)) {
        throw new BadRequestException('endDate must be in YYYY-MM-DD format');
      }

      // Validate date range
      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (start > end) {
          throw new BadRequestException('startDate must be before or equal to endDate');
        }
      }

      const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
      
      const result = await this.analyticsService.getTeacherDashboard(
        tenant.tenantId,
        teacherId,
        academicYearId,
        { classroomId, startDate, endDate },
        jwtToken
      );

      return result;
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`Error getting teacher dashboard: ${error.message}`, error.stack);
      throw new HttpException(
        `Failed to retrieve teacher dashboard: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
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
    try {
      // Validate required parameters
      if (!this.validateAcademicYearId(academicYearId)) {
        throw new BadRequestException('academicYearId is required and must be a valid string');
      }

      const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
      
      const result = await this.analyticsService.getStudentPerformance(
        tenant.tenantId,
        studentId,
        academicYearId,
        jwtToken
      );

      return result;
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`Error getting student performance: ${error.message}`, error.stack);
      throw new HttpException(
        `Failed to retrieve student performance: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
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
    @Query('threshold') threshold?: string
  ) {
    try {
      // Validate required parameters
      if (!this.validateAcademicYearId(academicYearId)) {
        throw new BadRequestException('academicYearId is required and must be a valid string');
      }

      // Parse and validate threshold
      let thresholdValue = 60; // Default threshold
      if (threshold !== undefined) {
        const parsed = parseFloat(threshold);
        if (isNaN(parsed) || parsed < 0 || parsed > 100) {
          throw new BadRequestException('threshold must be a number between 0 and 100');
        }
        thresholdValue = parsed;
      }

      const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
      
      const result = await this.analyticsService.getAtRiskStudents(
        tenant.tenantId,
        schoolId,
        academicYearId,
        thresholdValue,
        jwtToken
      );

      return result;
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`Error getting at-risk students: ${error.message}`, error.stack);
      throw new HttpException(
        `Failed to retrieve at-risk students: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
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
    try {
      // Validate required parameters
      if (!this.validateAcademicYearId(academicYearId)) {
        throw new BadRequestException('academicYearId is required and must be a valid string');
      }

      const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
      
      const result = await this.analyticsService.getAchievementGaps(
        tenant.tenantId,
        schoolId,
        academicYearId,
        demographic,
        jwtToken
      );

      return result;
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`Error getting achievement gaps: ${error.message}`, error.stack);
      throw new HttpException(
        `Failed to retrieve achievement gaps: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}

