/**
 * Calendar Date Service - CalendarDate CRUD and calendar generation
 *
 * The CalendarDate entity already exists. This service provides the
 * missing service layer for REST API exposure and calendar generation.
 */

import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  forwardRef,
} from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import {
  CalendarDate,
  CalendarDateKeyBuilder,
  createCalendarDateEntity,
  generateCalendarDatesForRange,
  calculateCalendarSummary,
} from '../common/entities/calendar-date.entity';
import { RequestContext, PaginatedResult } from '../common/entities/base.entity';
import { AcademicYearsService } from '../academic-years/academic-years.service';
import { AcademicSessionService } from './academic-session.service';
import { CalendarService } from './calendar.service';
import type {
  CreateCalendarDateDto,
  UpdateCalendarDateDto,
  CalendarDateResponseDto,
  CalendarDateFilterDto,
  GenerateCalendarDto,
  BulkUpdateCalendarDatesDto,
  CalendarSummaryDto,
} from '@aibrains/shared-types';

/** Response from calendar generation including warnings for data integrity issues */
export interface GenerateCalendarResult {
  calendarId: string;
  totalDays: number;
  instructionalDays: number;
  holidays: number;
  weekends: number;
  warnings: string[];
  sessions: Array<{
    sessionId: string;
    sessionName: string;
    instructionalDays: number;
  }>;
}

@Injectable()
export class CalendarDateService {
  private readonly logger = new Logger(CalendarDateService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    @Inject(forwardRef(() => AcademicYearsService))
    private readonly academicYearsService: AcademicYearsService,
    @Inject(forwardRef(() => AcademicSessionService))
    private readonly academicSessionService: AcademicSessionService,
    private readonly calendarService: CalendarService,
  ) {}

  // ============================================
  // Single CalendarDate Operations
  // ============================================

  /**
   * Create a single calendar date
   */
  async createCalendarDate(
    schoolId: string,
    academicYearId: string,
    createDto: CreateCalendarDateDto,
    context: RequestContext
  ): Promise<CalendarDateResponseDto> {
    const now = new Date().toISOString();
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Validate academic year exists
    await this.academicYearsService.getAcademicYear(schoolId, academicYearId, context);

    const calendarDate = createCalendarDateEntity(context.tenantId, schoolId, {
      date: createDto.date,
      academicYearId,
      calendarId: createDto.calendarId,
      calendarEvents: createDto.calendarEvents,
      isInstructionalDay: createDto.isInstructionalDay,
      isHoliday: createDto.isHoliday ?? false,
      isWeekend: createDto.isWeekend ?? false,
      dayOfWeek: this.getDayOfWeekFromDate(createDto.date),
      bellScheduleId: createDto.bellScheduleId,
      bellScheduleName: createDto.bellScheduleName,
      gradingPeriodId: createDto.gradingPeriodId,
      gradingPeriodName: createDto.gradingPeriodName,
      notes: createDto.notes,
      createdAt: now,
      createdBy: context.userId,
      updatedAt: now,
      updatedBy: context.userId,
      version: 1,
    });

    await this.dynamoDBClient.putItem(client, calendarDate);

    this.logger.log(`Calendar date created: ${createDto.date} for school ${schoolId}`);

    return this.toCalendarDateResponse(calendarDate);
  }

  /**
   * Get a single calendar date
   */
  async getCalendarDate(
    schoolId: string,
    date: string,
    context: RequestContext
  ): Promise<CalendarDateResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const calendarDate = await this.dynamoDBClient.getItem<CalendarDate>(
      client,
      context.tenantId,
      CalendarDateKeyBuilder.calendarDate(schoolId, date)
    );

    if (!calendarDate) {
      throw new NotFoundException(`Calendar date not found: ${date}`);
    }

    return this.toCalendarDateResponse(calendarDate);
  }

  /**
   * List calendar dates with filtering
   */
  async listCalendarDates(
    schoolId: string,
    params: Partial<CalendarDateFilterDto>,
    context: RequestContext
  ): Promise<PaginatedResult<CalendarDateResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const limit = params.limit ?? 100;

    const result = await this.dynamoDBClient.query<CalendarDate>(
      client,
      context.tenantId,
      CalendarDateKeyBuilder.calendarDatesPrefix(schoolId),
      'entityType = :entityType',
      { ':entityType': 'CALENDARDATE' },
      undefined,
      400  // Fetch more, filter in-memory for date range
    );

    let filtered = result.items;

    // Apply filters
    if (params.academicYearId) {
      filtered = filtered.filter(d => d.academicYearId === params.academicYearId);
    }
    if (params.startDate) {
      filtered = filtered.filter(d => d.date >= params.startDate!);
    }
    if (params.endDate) {
      filtered = filtered.filter(d => d.date <= params.endDate!);
    }
    if (params.eventType) {
      filtered = filtered.filter(d =>
        d.calendarEvents.some(e => e.eventType === params.eventType)
      );
    }
    if (params.isInstructionalDay !== undefined) {
      filtered = filtered.filter(d => d.isInstructionalDay === params.isInstructionalDay);
    }
    if (params.isHoliday !== undefined) {
      filtered = filtered.filter(d => d.isHoliday === params.isHoliday);
    }
    if (params.month) {
      filtered = filtered.filter(d => {
        const month = parseInt(d.date.split('-')[1], 10);
        return month === params.month;
      });
    }

    // Sort by date
    filtered.sort((a, b) => a.date.localeCompare(b.date));

    // Paginate
    const paginated = filtered.slice(0, limit);

    return {
      items: paginated.map(d => this.toCalendarDateResponse(d)),
      hasMore: filtered.length > limit,
    };
  }

  /**
   * Update a single calendar date
   */
  async updateCalendarDate(
    schoolId: string,
    date: string,
    updateDto: UpdateCalendarDateDto,
    context: RequestContext
  ): Promise<CalendarDateResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const existing = await this.dynamoDBClient.getItem<CalendarDate>(
      client,
      context.tenantId,
      CalendarDateKeyBuilder.calendarDate(schoolId, date)
    );

    if (!existing) {
      throw new NotFoundException(`Calendar date not found: ${date}`);
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};

    if (updateDto.calendarEvents) {
      updates.push('calendarEvents = :calendarEvents');
      values[':calendarEvents'] = updateDto.calendarEvents;
    }
    if (updateDto.calendarId !== undefined) {
      updates.push('calendarId = :calendarId');
      values[':calendarId'] = updateDto.calendarId;
    }
    if (updateDto.isInstructionalDay !== undefined) {
      updates.push('isInstructionalDay = :isInstructionalDay');
      values[':isInstructionalDay'] = updateDto.isInstructionalDay;
    }
    if (updateDto.isHoliday !== undefined) {
      updates.push('isHoliday = :isHoliday');
      values[':isHoliday'] = updateDto.isHoliday;
    }
    if (updateDto.bellScheduleId !== undefined) {
      updates.push('bellScheduleId = :bellScheduleId');
      values[':bellScheduleId'] = updateDto.bellScheduleId;
    }
    if (updateDto.bellScheduleName !== undefined) {
      updates.push('bellScheduleName = :bellScheduleName');
      values[':bellScheduleName'] = updateDto.bellScheduleName;
    }
    if (updateDto.gradingPeriodId !== undefined) {
      updates.push('gradingPeriodId = :gradingPeriodId');
      values[':gradingPeriodId'] = updateDto.gradingPeriodId;
    }
    if (updateDto.gradingPeriodName !== undefined) {
      updates.push('gradingPeriodName = :gradingPeriodName');
      values[':gradingPeriodName'] = updateDto.gradingPeriodName;
    }
    if (updateDto.notes !== undefined) {
      updates.push('notes = :notes');
      values[':notes'] = updateDto.notes;
    }

    if (updates.length === 0) {
      return this.toCalendarDateResponse(existing);
    }

    updates.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;

    const updated = await this.dynamoDBClient.updateItem<CalendarDate>(
      client,
      context.tenantId,
      CalendarDateKeyBuilder.calendarDate(schoolId, date),
      `SET ${updates.join(', ')}`,
      values
    );

    this.logger.log(`Calendar date updated: ${date}`);

    return this.toCalendarDateResponse(updated);
  }

  // ============================================
  // Bulk Operations
  // ============================================

  /**
   * Bulk create calendar dates
   */
  async bulkCreateCalendarDates(
    schoolId: string,
    academicYearId: string,
    dates: CalendarDate[],
    context: RequestContext
  ): Promise<{ created: number }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const putRequests = dates.map(item => ({
      PutRequest: { Item: item },
    }));

    await this.dynamoDBClient.batchWriteItems(client, putRequests);

    this.logger.log(`Bulk created ${dates.length} calendar dates for school ${schoolId}`);

    return { created: dates.length };
  }

  /**
   * Bulk update calendar dates
   */
  async bulkUpdateCalendarDates(
    schoolId: string,
    dto: BulkUpdateCalendarDatesDto,
    context: RequestContext
  ): Promise<{ updated: number }> {
    let updatedCount = 0;

    for (const date of dto.dates) {
      try {
        await this.updateCalendarDate(schoolId, date, dto.updates, context);
        updatedCount++;
      } catch (err) {
        this.logger.warn(`Failed to update calendar date ${date}: ${err}`);
      }
    }

    return { updated: updatedCount };
  }

  /**
   * Delete all calendar dates for an academic year
   */
  async deleteCalendarDatesForYear(
    schoolId: string,
    academicYearId: string,
    context: RequestContext
  ): Promise<{ deleted: number }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Query all dates for this school
    const result = await this.dynamoDBClient.query<CalendarDate>(
      client,
      context.tenantId,
      CalendarDateKeyBuilder.calendarDatesPrefix(schoolId),
      'entityType = :entityType',
      { ':entityType': 'CALENDARDATE' },
      undefined,
      400
    );

    // Filter by academic year
    const toDelete = result.items.filter(d => d.academicYearId === academicYearId);

    if (toDelete.length === 0) {
      return { deleted: 0 };
    }

    const deleteRequests = toDelete.map(item => ({
      DeleteRequest: {
        Key: { tenantId: context.tenantId, entityKey: item.entityKey },
      },
    }));

    await this.dynamoDBClient.batchWriteItems(client, deleteRequests);

    this.logger.log(`Deleted ${toDelete.length} calendar dates for school ${schoolId}, year ${academicYearId}`);

    return { deleted: toDelete.length };
  }

  // ============================================
  // Calendar Generation (Task 2.5)
  // ============================================

  /**
   * Generate calendar dates for an academic year.
   *
   * Ed-Fi alignment: Produces CalendarDate records linked to a Calendar entity,
   * with CalendarEvents for each day. Sessions (Ed-Fi: Session/GradingPeriod)
   * are updated with computed instructional day counts post-generation.
   *
   * Resilience: Session sync failures are captured as warnings — calendar dates
   * are always persisted regardless of session sync outcome.
   */
  async generateCalendar(
    schoolId: string,
    yearId: string,
    dto: GenerateCalendarDto,
    context: RequestContext
  ): Promise<GenerateCalendarResult> {
    const warnings: string[] = [];

    // 1. Validate academic year exists
    const year = await this.academicYearsService.getAcademicYear(schoolId, yearId, context);

    // 2. Get or create default Calendar entity (Ed-Fi: Calendar → CalendarDate)
    const calendar = await this.calendarService.getOrCreateDefaultCalendar(
      schoolId,
      yearId,
      context
    );

    // 3. Delete existing dates for regeneration
    await this.deleteCalendarDatesForYear(schoolId, yearId, context);

    // 4. Generate dates using existing utility
    const calendarDates = generateCalendarDatesForRange(
      context.tenantId,
      schoolId,
      yearId,
      dto.startDate,
      dto.endDate,
      {
        defaultBellScheduleId: dto.defaultBellScheduleId,
        schoolDays: dto.schoolDays,
        holidays: dto.holidays,
        breaks: dto.breaks,
      }
    );

    // 5. Set calendarId on each generated date
    calendarDates.forEach(cd => {
      cd.calendarId = calendar.calendarId;
    });

    // 6. Bulk insert
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const putRequests = calendarDates.map(item => ({
      PutRequest: { Item: item },
    }));
    await this.dynamoDBClient.batchWriteItems(client, putRequests);

    // 7. Sync session instructional day counts (Ed-Fi: Session.totalInstructionalDays)
    const sessionSummaries: Array<{
      sessionId: string;
      sessionName: string;
      instructionalDays: number;
    }> = [];

    try {
      const sessionsResult = await this.academicSessionService.listSessions(schoolId, context, yearId);
      const sessions = sessionsResult.items || [];

      if (sessions.length === 0) {
        warnings.push('No academic sessions found for this year. Create sessions to track per-term instructional days.');
      }

      // Sort sessions by beginDate and track counted dates to prevent
      // double-counting when sessions share a boundary date (e.g., session 1
      // ends Jun 9, session 2 begins Jun 9).
      const sortedSessions = [...sessions].sort((a, b) => a.beginDate.localeCompare(b.beginDate));
      const countedDates = new Set<string>();

      for (const session of sortedSessions) {
        const sessionDates = calendarDates.filter(
          cd => cd.date >= session.beginDate &&
                cd.date <= session.endDate &&
                cd.isInstructionalDay &&
                !countedDates.has(cd.date)
        );
        const count = sessionDates.length;
        sessionDates.forEach(cd => countedDates.add(cd.date));

        await this.academicSessionService.updateInstructionalDays(
          schoolId, session.academicSessionId, count, context
        );

        sessionSummaries.push({
          sessionId: session.academicSessionId,
          sessionName: session.sessionName,
          instructionalDays: count,
        });
      }

      // 8. Detect date-range overrun beyond sessions
      if (sessions.length > 0) {
        const lastSessionEnd = sessions.reduce(
          (max, s) => (s.endDate > max ? s.endDate : max),
          sessions[0].endDate,
        );

        if (dto.endDate > lastSessionEnd) {
          const orphanedDays = calendarDates.filter(cd => cd.date > lastSessionEnd).length;
          const orphanedInstructional = calendarDates.filter(
            cd => cd.date > lastSessionEnd && cd.isInstructionalDay
          ).length;
          warnings.push(
            `Calendar extends ${orphanedDays} days beyond the last session (ends ${lastSessionEnd}). ` +
            `${orphanedInstructional} instructional days are not assigned to any session.`
          );
        }

        // 9. Detect inter-session gaps
        const sorted = [...sessions].sort((a, b) => a.beginDate.localeCompare(b.beginDate));
        for (let i = 0; i < sorted.length - 1; i++) {
          const currentEnd = new Date(sorted[i].endDate + 'T12:00:00Z');
          const nextStart = new Date(sorted[i + 1].beginDate + 'T12:00:00Z');
          const gapDays = Math.floor((nextStart.getTime() - currentEnd.getTime()) / (1000 * 60 * 60 * 24)) - 1;

          if (gapDays > 2) {
            const gapStart = new Date(sorted[i].endDate + 'T12:00:00Z');
            gapStart.setDate(gapStart.getDate() + 1);
            const gapEnd = new Date(sorted[i + 1].beginDate + 'T12:00:00Z');
            gapEnd.setDate(gapEnd.getDate() - 1);
            warnings.push(
              `${gapDays}-day gap between "${sorted[i].sessionName}" (ends ${sorted[i].endDate}) ` +
              `and "${sorted[i + 1].sessionName}" (starts ${sorted[i + 1].beginDate}).`
            );
          }
        }
      }
    } catch (err) {
      this.logger.error(`Session sync failed for school ${schoolId}: ${err}`);
      warnings.push(
        'Calendar generated successfully but session instructional day counts could not be updated. ' +
        'Please regenerate or contact support.'
      );
    }

    // 10. Calculate summary
    const summary = calculateCalendarSummary(calendarDates);
    const weekendCount = calendarDates.filter(d => d.isWeekend).length;

    this.logger.log(
      `Calendar generated for school ${schoolId}: ${summary.totalDays} total, ` +
      `${summary.instructionalDays} instructional, ${summary.holidays} holidays, ` +
      `${sessionSummaries.length} sessions synced, ${warnings.length} warnings`
    );

    return {
      calendarId: calendar.calendarId,
      totalDays: summary.totalDays,
      instructionalDays: summary.instructionalDays,
      holidays: summary.holidays,
      weekends: weekendCount,
      warnings,
      sessions: sessionSummaries,
    };
  }

  // ============================================
  // Statistics and Queries
  // ============================================

  /**
   * Get instructional day count in a date range
   */
  async getInstructionalDayCount(
    schoolId: string,
    startDate: string,
    endDate: string,
    context: RequestContext
  ): Promise<number> {
    const result = await this.listCalendarDates(schoolId, {
      startDate,
      endDate,
      isInstructionalDay: true,
    }, context);

    return result.items.length;
  }

  /**
   * Get calendar summary statistics.
   *
   * S0.5: when `academicYearId` is omitted, default to the school's current
   * academic year (resolved via AcademicYearsService.getCurrentAcademicYear).
   * Prior behavior returned a misleading "Academic year not found" 404 when
   * the query param was missing — see evidence §6 (F8).
   */
  async getCalendarStats(
    schoolId: string,
    academicYearId: string | undefined,
    context: RequestContext
  ): Promise<CalendarSummaryDto> {
    let resolvedYearId = academicYearId;
    if (!resolvedYearId) {
      const currentYear = await this.academicYearsService.getCurrentAcademicYear(
        schoolId,
        context,
      );
      resolvedYearId = currentYear.yearId;
    }
    const year = await this.academicYearsService.getAcademicYear(schoolId, resolvedYearId, context);

    const result = await this.listCalendarDates(schoolId, {
      academicYearId: resolvedYearId,
      limit: 400,
    }, context);

    const dates = result.items;
    const today = new Date().toISOString().split('T')[0];

    const totalDays = dates.length;
    const instructionalDays = dates.filter(d => d.isInstructionalDay).length;
    const nonInstructionalDays = totalDays - instructionalDays;
    const holidays = dates.filter(d => d.isHoliday).length;
    const teacherOnlyDays = dates.filter(d =>
      d.calendarEvents?.some(e => e.eventType === 'teacher_only')
    ).length;

    const daysPassed = dates.filter(d => d.date <= today).length;
    const daysRemaining = dates.filter(d => d.date > today).length;
    const instructionalDaysPassed = dates.filter(d => d.isInstructionalDay && d.date <= today).length;
    const instructionalDaysRemaining = dates.filter(d => d.isInstructionalDay && d.date > today).length;
    const progressPercentage = totalDays > 0 ? Math.round((daysPassed / totalDays) * 100) : 0;

    // Upcoming events (next 10 non-instructional dates)
    const upcomingEvents = dates
      .filter(d => d.date > today && !d.isInstructionalDay && !d.isWeekend)
      .slice(0, 10)
      .map(d => ({
        date: d.date,
        eventType: d.calendarEvents?.[0]?.eventType ?? 'other' as const,
        description: d.calendarEvents?.[0]?.description,
      }));

    return {
      schoolId,
      academicYearId: resolvedYearId,
      academicYearName: year.name,
      totalDays,
      instructionalDays,
      nonInstructionalDays,
      holidays,
      teacherOnlyDays,
      daysPassed,
      daysRemaining,
      instructionalDaysPassed,
      instructionalDaysRemaining,
      progressPercentage,
      upcomingEvents,
    };
  }

  // ============================================
  // Private Helpers
  // ============================================

  private getDayOfWeekFromDate(dateString: string): 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
    const date = new Date(dateString + 'T12:00:00Z');
    return days[date.getUTCDay()];
  }

  private toCalendarDateResponse(cd: CalendarDate): CalendarDateResponseDto {
    return {
      calendarDateId: `${cd.schoolId}::${cd.date}`, // Composite key: globally unique, stable per school+date
      schoolId: cd.schoolId,
      academicYearId: cd.academicYearId,
      tenantId: cd.tenantId,
      date: cd.date,
      calendarEvents: cd.calendarEvents,
      calendarId: cd.calendarId,
      isInstructionalDay: cd.isInstructionalDay,
      isHoliday: cd.isHoliday,
      isWeekend: cd.isWeekend,
      dayOfWeek: cd.dayOfWeek,
      bellScheduleId: cd.bellScheduleId,
      bellScheduleName: cd.bellScheduleName,
      gradingPeriodId: cd.gradingPeriodId,
      gradingPeriodName: cd.gradingPeriodName,
      dayNumber: cd.dayNumber,
      instructionalDayNumber: cd.instructionalDayNumber,
      notes: cd.notes,
      createdAt: cd.createdAt,
      updatedAt: cd.updatedAt,
    };
  }
}
