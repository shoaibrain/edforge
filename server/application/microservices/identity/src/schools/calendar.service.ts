/**
 * Calendar Service - Calendar entity CRUD
 *
 * Manages Ed-Fi Calendar entities (the intermediary between School and CalendarDate).
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import {
  Calendar,
  CalendarKeyBuilder,
  createCalendarEntity,
} from '../common/entities/calendar.entity';
import { RequestContext, PaginatedResult } from '../common/entities/base.entity';
import type { CreateCalendarDto, UpdateCalendarDto, CalendarResponseDto } from '@aibrains/shared-types';

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);

  constructor(private readonly dynamoDBClient: DynamoDBClientService) {}

  /**
   * Create a new calendar
   */
  async createCalendar(
    schoolId: string,
    createDto: CreateCalendarDto,
    context: RequestContext
  ): Promise<CalendarResponseDto> {
    const now = new Date().toISOString();
    const calendarId = uuid();
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // If setting as default, clear other defaults for same school+year
    if (createDto.isDefault) {
      await this.clearDefaultCalendar(schoolId, createDto.academicYearId, context);
    }

    const calendar = createCalendarEntity(
      context.tenantId,
      schoolId,
      calendarId,
      {
        academicYearId: createDto.academicYearId,
        calendarCode: createDto.calendarCode,
        calendarTypeDescriptor: createDto.calendarTypeDescriptor,
        gradeLevels: createDto.gradeLevels,
        isDefault: createDto.isDefault ?? false,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );

    await this.dynamoDBClient.putItem(client, calendar);

    this.logger.log(`Calendar created: ${calendar.calendarCode} (${calendarId}) for school ${schoolId}`);

    return this.toCalendarResponse(calendar);
  }

  /**
   * Get calendar by ID
   */
  async getCalendar(
    schoolId: string,
    calendarId: string,
    context: RequestContext
  ): Promise<CalendarResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const calendar = await this.dynamoDBClient.getItem<Calendar>(
      client,
      context.tenantId,
      CalendarKeyBuilder.calendar(schoolId, calendarId)
    );

    if (!calendar) {
      throw new NotFoundException('Calendar not found');
    }

    return this.toCalendarResponse(calendar);
  }

  /**
   * List calendars for a school
   */
  async listCalendars(
    schoolId: string,
    context: RequestContext
  ): Promise<PaginatedResult<CalendarResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const result = await this.dynamoDBClient.query<Calendar>(
      client,
      context.tenantId,
      CalendarKeyBuilder.calendarsPrefix(schoolId),
      'entityType = :entityType',
      { ':entityType': 'CALENDAR' },
      undefined,
      50
    );

    return {
      items: result.items.map(c => this.toCalendarResponse(c)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Get or create default calendar for school+year
   */
  async getOrCreateDefaultCalendar(
    schoolId: string,
    academicYearId: string,
    context: RequestContext
  ): Promise<CalendarResponseDto> {
    const calendars = await this.listCalendars(schoolId, context);
    const defaultCalendar = calendars.items.find(
      c => c.isDefault && c.academicYearId === academicYearId
    );

    if (defaultCalendar) {
      return defaultCalendar;
    }

    // Auto-create default "Student" calendar
    return this.createCalendar(schoolId, {
      academicYearId,
      calendarCode: `STUDENT-${new Date().getFullYear()}`,
      calendarTypeDescriptor: 'student',
      isDefault: true,
    }, context);
  }

  /**
   * Update calendar
   */
  async updateCalendar(
    schoolId: string,
    calendarId: string,
    updateDto: UpdateCalendarDto,
    context: RequestContext
  ): Promise<CalendarResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const calendar = await this.dynamoDBClient.getItem<Calendar>(
      client,
      context.tenantId,
      CalendarKeyBuilder.calendar(schoolId, calendarId)
    );

    if (!calendar) {
      throw new NotFoundException('Calendar not found');
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};

    if (updateDto.calendarCode) {
      updates.push('calendarCode = :calendarCode');
      values[':calendarCode'] = updateDto.calendarCode;
    }
    if (updateDto.calendarTypeDescriptor) {
      updates.push('calendarTypeDescriptor = :calendarTypeDescriptor');
      values[':calendarTypeDescriptor'] = updateDto.calendarTypeDescriptor;
    }
    if (updateDto.gradeLevels !== undefined) {
      updates.push('gradeLevels = :gradeLevels');
      values[':gradeLevels'] = updateDto.gradeLevels;
    }
    if (updateDto.isDefault !== undefined) {
      updates.push('isDefault = :isDefault');
      values[':isDefault'] = updateDto.isDefault;
    }

    if (updates.length === 0) {
      return this.toCalendarResponse(calendar);
    }

    updates.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;

    const updatedCalendar = await this.dynamoDBClient.updateItem<Calendar>(
      client,
      context.tenantId,
      CalendarKeyBuilder.calendar(schoolId, calendarId),
      `SET ${updates.join(', ')}`,
      values
    );

    this.logger.log(`Calendar updated: ${calendarId}`);

    return this.toCalendarResponse(updatedCalendar);
  }

  /**
   * Clear default flag from all calendars for a school+year
   */
  private async clearDefaultCalendar(
    schoolId: string,
    academicYearId: string,
    context: RequestContext
  ): Promise<void> {
    const calendars = await this.listCalendars(schoolId, context);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    for (const cal of calendars.items) {
      if (cal.isDefault && cal.academicYearId === academicYearId) {
        await this.dynamoDBClient.updateItem(
          client,
          context.tenantId,
          CalendarKeyBuilder.calendar(schoolId, cal.calendarId),
          'SET isDefault = :isDefault',
          { ':isDefault': false }
        );
      }
    }
  }

  // ============================================
  // Response Mapper
  // ============================================

  private toCalendarResponse(calendar: Calendar): CalendarResponseDto {
    return {
      calendarId: calendar.calendarId,
      schoolId: calendar.schoolId,
      academicYearId: calendar.academicYearId,
      calendarCode: calendar.calendarCode,
      calendarTypeDescriptor: calendar.calendarTypeDescriptor,
      gradeLevels: calendar.gradeLevels as CalendarResponseDto['gradeLevels'],
      isDefault: calendar.isDefault,
      createdAt: calendar.createdAt,
      updatedAt: calendar.updatedAt,
    };
  }
}
