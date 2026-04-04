/**
 * Calendar Date Controller - CalendarDate REST endpoints + calendar generation
 *
 * Routes:
 * - /schools/:schoolId/calendar-dates
 * - /schools/:schoolId/academic-years/:yearId/generate-calendar
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
import { CalendarDateService } from './calendar-date.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import {
  CreateCalendarDateDtoZ,
  UpdateCalendarDateDtoZ,
  GenerateCalendarDtoZ,
  BulkUpdateCalendarDatesDtoZ,
} from '../common/dto/zod-dtos';
import type {
  CalendarDateResponseDto,
  CalendarDateListResponseDto,
  CalendarSummaryDto,
} from '@aibrains/shared-types';
import { RequestContext } from '../common/entities';
import { getHolidaysForLocale, hasHolidayData, getSupportedHolidayLocales } from '../data/holidays';

@Controller('schools/:schoolId')
@UseGuards(JwtAuthGuard)
export class CalendarDateController {
  constructor(private readonly calendarDateService: CalendarDateService) {}

  // ============================================
  // CalendarDate CRUD
  // ============================================

  /**
   * List calendar dates with filtering
   * GET /schools/:schoolId/calendar-dates
   */
  @Get('calendar-dates')
  async listCalendarDates(
    @Param('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('eventType') eventType: string,
    @Query('isInstructionalDay') isInstructionalDay: string,
    @Query('month') month: string,
    @Query('limit') limit: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<CalendarDateListResponseDto> {
    const context = this.buildContext(tenant, req);
    const result = await this.calendarDateService.listCalendarDates(schoolId, {
      academicYearId,
      startDate,
      endDate,
      eventType: eventType as any,
      isInstructionalDay: isInstructionalDay !== undefined ? isInstructionalDay === 'true' : undefined,
      month: month ? parseInt(month, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : 100,
    }, context);

    return {
      items: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Get calendar summary statistics
   * GET /schools/:schoolId/calendar-dates/stats
   */
  @Get('calendar-dates/stats')
  async getCalendarStats(
    @Param('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<CalendarSummaryDto> {
    const context = this.buildContext(tenant, req);
    return this.calendarDateService.getCalendarStats(schoolId, academicYearId, context);
  }

  /**
   * Get single calendar date
   * GET /schools/:schoolId/calendar-dates/:date
   */
  @Get('calendar-dates/:date')
  async getCalendarDate(
    @Param('schoolId') schoolId: string,
    @Param('date') date: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<CalendarDateResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.calendarDateService.getCalendarDate(schoolId, date, context);
  }

  /**
   * Create single calendar date
   * POST /schools/:schoolId/calendar-dates
   */
  @Post('calendar-dates')
  async createCalendarDate(
    @Param('schoolId') schoolId: string,
    @Body() createDto: CreateCalendarDateDtoZ,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<CalendarDateResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.calendarDateService.createCalendarDate(schoolId, academicYearId, createDto, context);
  }

  /**
   * Bulk create calendar dates
   * POST /schools/:schoolId/calendar-dates/bulk
   */
  @Post('calendar-dates/bulk')
  async bulkCreateCalendarDates(
    @Param('schoolId') schoolId: string,
    @Body() body: { academicYearId: string; dates: any[] },
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<{ created: number }> {
    const context = this.buildContext(tenant, req);
    return this.calendarDateService.bulkCreateCalendarDates(
      schoolId,
      body.academicYearId,
      body.dates,
      context
    );
  }

  /**
   * Update single calendar date
   * PATCH /schools/:schoolId/calendar-dates/:date
   */
  @Patch('calendar-dates/:date')
  async updateCalendarDate(
    @Param('schoolId') schoolId: string,
    @Param('date') date: string,
    @Body() updateDto: UpdateCalendarDateDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<CalendarDateResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.calendarDateService.updateCalendarDate(schoolId, date, updateDto, context);
  }

  /**
   * Bulk update calendar dates
   * POST /schools/:schoolId/calendar-dates/bulk-update
   */
  @Post('calendar-dates/bulk-update')
  async bulkUpdateCalendarDates(
    @Param('schoolId') schoolId: string,
    @Body() dto: BulkUpdateCalendarDatesDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<{ updated: number }> {
    const context = this.buildContext(tenant, req);
    return this.calendarDateService.bulkUpdateCalendarDates(schoolId, dto, context);
  }

  // ============================================
  // Calendar Generation (Task 2.5)
  // ============================================

  /**
   * Generate calendar dates for an academic year
   * POST /schools/:schoolId/academic-years/:yearId/generate-calendar
   */
  @Post('academic-years/:yearId/generate-calendar')
  async generateCalendar(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Body() dto: GenerateCalendarDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ) {
    const context = this.buildContext(tenant, req);
    return this.calendarDateService.generateCalendar(schoolId, yearId, dto, context);
  }

  // ============================================
  // Locale Holiday Data (Ed-Fi CalendarEvent seed)
  // ============================================

  /**
   * Get public holidays for a locale and date range
   * GET /schools/:schoolId/holidays?locale=np&startDate=2026-03-29&endDate=2027-04-01
   *
   * Returns holidays that can be passed to the generate-calendar endpoint.
   * This is a read-only, stateless lookup — no DynamoDB access required.
   */
  @Get('holidays')
  async getHolidaysForLocale(
    @Query('locale') locale: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ): Promise<{
    locale: string;
    supported: boolean;
    holidays: Array<{ date: string; name: string; eventType: string }>;
    supportedLocales: string[];
  }> {
    const supported = hasHolidayData(locale || '');
    const holidays = locale && startDate && endDate
      ? getHolidaysForLocale(locale, startDate, endDate)
      : [];

    return {
      locale: locale || '',
      supported,
      holidays,
      supportedLocales: getSupportedHolidayLocales(),
    };
  }

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
