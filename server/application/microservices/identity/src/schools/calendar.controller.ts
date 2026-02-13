/**
 * Calendar Controller - Calendar entity REST endpoints
 *
 * Routes: /schools/:schoolId/calendars
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { CalendarService } from './calendar.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import {
  CreateCalendarDtoZ,
  UpdateCalendarDtoZ,
} from '../common/dto/zod-dtos';
import type {
  CalendarResponseDto,
  CalendarListResponseDto,
} from '@aibrains/shared-types';
import { RequestContext } from '../common/entities';

@Controller('schools/:schoolId/calendars')
@UseGuards(JwtAuthGuard)
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  /**
   * Create calendar
   * POST /schools/:schoolId/calendars
   */
  @Post()
  async createCalendar(
    @Param('schoolId') schoolId: string,
    @Body() createDto: CreateCalendarDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<CalendarResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.calendarService.createCalendar(schoolId, createDto, context);
  }

  /**
   * List calendars for school
   * GET /schools/:schoolId/calendars
   */
  @Get()
  async listCalendars(
    @Param('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<CalendarListResponseDto> {
    const context = this.buildContext(tenant, req);
    const result = await this.calendarService.listCalendars(schoolId, context);
    return {
      items: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Get calendar by ID
   * GET /schools/:schoolId/calendars/:calendarId
   */
  @Get(':calendarId')
  async getCalendar(
    @Param('schoolId') schoolId: string,
    @Param('calendarId') calendarId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<CalendarResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.calendarService.getCalendar(schoolId, calendarId, context);
  }

  /**
   * Update calendar
   * PATCH /schools/:schoolId/calendars/:calendarId
   */
  @Patch(':calendarId')
  async updateCalendar(
    @Param('schoolId') schoolId: string,
    @Param('calendarId') calendarId: string,
    @Body() updateDto: UpdateCalendarDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<CalendarResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.calendarService.updateCalendar(schoolId, calendarId, updateDto, context);
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
