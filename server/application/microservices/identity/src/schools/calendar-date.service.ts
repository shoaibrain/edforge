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
import { AuditedWriteService } from '../common/services/audited-write.service';
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
import { normalizeGenerateCalendarDtoToAd } from '@aibrains/shared-types';

/**
 * Pure helper for C3.8 merge mode: split a CalendarDate row set into
 * the rows safe to delete (both audit fields still 'SYSTEM') and the
 * date keys of rows the operator has touched (either field non-SYSTEM).
 *
 * Exported so the unit spec can exercise it without DDB. The dual-field
 * test (createdBy AND updatedBy must equal 'SYSTEM' to be eligible for
 * deletion) is intentional: an operator who edits one field on an
 * auto-generated row promotes `updatedBy` to a userId, and that's
 * enough signal to preserve.
 */
export function partitionRowsBySource(
  rows: ReadonlyArray<CalendarDate>,
): { systemRowKeys: string[]; preservedDates: Set<string> } {
  const systemRowKeys: string[] = [];
  const preservedDates = new Set<string>();
  for (const row of rows) {
    const isSystem = row.createdBy === 'SYSTEM' && row.updatedBy === 'SYSTEM';
    if (isSystem) {
      systemRowKeys.push(row.entityKey);
    } else {
      preservedDates.add(row.date);
    }
  }
  return { systemRowKeys, preservedDates };
}

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
    private readonly auditedWrite: AuditedWriteService,
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
   * List calendar dates with filtering.
   *
   * Sprint S3.1 — closes F-V2-CALENDAR-PAGINATION.
   *
   * When `academicYearId` filter is provided (the common case for the
   * wizard month-grid + FullCalendar view), we query GSI1
   * (gsi1pk=ACADYEAR#{ayId}) directly instead of scanning the school's
   * full DATE prefix. GSI1 is precisely-scoped to one AY, so:
   *   - No 400-row cap to worry about
   *   - No in-memory filter pass for academicYearId
   *   - Multi-AY schools see ALL of their target AY's rows
   *
   * GSI1 supports the date-range narrowing too via `gsi1sk` =
   * CALDATE#{date}; we use `between` here so a startDate/endDate filter
   * pushes the date narrowing down to DDB.
   *
   * When `academicYearId` is NOT provided, fall back to the legacy
   * school-prefix scan — but with cursor-pagination so the operator can
   * page through ALL rows instead of being truncated at 400. The cursor
   * is opaque to the caller (DDB ExclusiveStartKey base64-encoded).
   */
  async listCalendarDates(
    schoolId: string,
    params: Partial<CalendarDateFilterDto>,
    context: RequestContext
  ): Promise<PaginatedResult<CalendarDateResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const limit = params.limit ?? 100;

    let items: CalendarDate[];

    if (params.academicYearId) {
      // ───── Fast path — GSI1 lookup scoped to the AY ─────
      const ayPk = `ACADYEAR#${params.academicYearId}`;
      // Build the sk range for date narrowing. If startDate and/or
      // endDate are present, push the filter to DDB via gsi1sk range.
      // The DDB GSI uses `between` via two ExpressionAttributeValues
      // — we approximate with begins_with when no range, or use
      // attribute filtering for the range (slightly less efficient than
      // a native between but works with the existing queryGSI surface).
      const filterParts: string[] = [];
      const filterValues: Record<string, any> = {};

      if (params.startDate) {
        filterParts.push('#dt >= :startDate');
        filterValues[':startDate'] = params.startDate;
      }
      if (params.endDate) {
        filterParts.push('#dt <= :endDate');
        filterValues[':endDate'] = params.endDate;
      }

      const filterExpr = filterParts.length > 0 ? filterParts.join(' AND ') : undefined;
      const filterNames = filterParts.length > 0 ? { '#dt': 'date' } : undefined;

      // Page through ALL results — GSI1 is AY-scoped so volume is bounded
      // to one AY's calendar (~365 rows). One paged query is enough in
      // practice but we loop for safety against future high-volume cases.
      const collected: CalendarDate[] = [];
      let cursor: any | undefined = undefined;
      const PAGE_SIZE = 400;
      const MAX_PAGES = 5; // safety cap: 2000 rows = ~5.5 AYs worth

      for (let i = 0; i < MAX_PAGES; i++) {
        const result = await this.dynamoDBClient.queryGSI<CalendarDate>(
          client,
          'GSI1',
          ayPk,
          undefined,
          'eq',
          filterExpr,
          filterValues,
          filterNames,
          PAGE_SIZE,
          cursor,
        );
        collected.push(...result.items);
        if (!result.hasMore || !result.lastEvaluatedKey) break;
        try {
          cursor = JSON.parse(Buffer.from(result.lastEvaluatedKey, 'base64').toString());
        } catch {
          break;
        }
      }
      items = collected;
    } else {
      // ───── Fallback — full school-prefix scan ─────
      // (Pre-S3.1 behavior, but with the 400-row hardcode replaced by
      // bounded pagination so callers without academicYearId can still
      // browse beyond 400 rows for very-old schools.)
      const collected: CalendarDate[] = [];
      let cursor: Record<string, any> | undefined = undefined;
      const PAGE_SIZE = 400;
      const MAX_PAGES = 5;

      for (let i = 0; i < MAX_PAGES; i++) {
        const result = await this.dynamoDBClient.query<CalendarDate>(
          client,
          context.tenantId,
          CalendarDateKeyBuilder.calendarDatesPrefix(schoolId),
          'entityType = :entityType',
          { ':entityType': 'CALENDARDATE' },
          undefined, // expressionAttributeNames — none
          PAGE_SIZE,
          cursor,
        );
        collected.push(...result.items);
        if (!result.hasMore || !result.lastEvaluatedKey) break;
        try {
          cursor = JSON.parse(Buffer.from(result.lastEvaluatedKey, 'base64').toString());
        } catch {
          break;
        }
      }
      items = collected;
    }

    // In-memory filters (eventType, isInstructionalDay, isHoliday,
    // month). These can't be cheaply pushed to DDB given the row shape
    // (eventType lives inside a list of events, not as a top-level
    // attribute). Acceptable because items here is already AY-scoped
    // (typically <400 rows), so the filter is O(small N).
    let filtered = items;

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

    // Sort by date (GSI1SK already sorts by date, but the fallback path
    // doesn't, and in-memory filters may have reshuffled).
    filtered.sort((a, b) => a.date.localeCompare(b.date));

    // Final caller-side pagination on the filtered set.
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
  /**
   * Partition the year's CalendarDate rows for merge-mode regeneration.
   *
   * - `systemRowKeys`: entity keys of rows where BOTH `createdBy` and
   *   `updatedBy` equal `'SYSTEM'`. Safe to delete on regenerate — they
   *   were last written by the generator with no operator touch.
   * - `preservedDates`: AD date strings (`YYYY-MM-DD`) for the rows the
   *   operator either created from scratch or edited after generation.
   *   Generated rows for these dates are dropped so the operator's row
   *   wins.
   *
   * The "operator-touched" test is intentionally generous — any
   * deviation of either createdBy or updatedBy from `'SYSTEM'` counts —
   * so an operator who edits a single field on an auto-generated row
   * still keeps the row. Matches the spirit of "preserve overrides".
   */
  private async partitionCalendarDatesForMerge(
    schoolId: string,
    academicYearId: string,
    context: RequestContext,
  ): Promise<{ systemRowKeys: string[]; preservedDates: Set<string> }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const result = await this.dynamoDBClient.query<CalendarDate>(
      client,
      context.tenantId,
      CalendarDateKeyBuilder.calendarDatesPrefix(schoolId),
      'entityType = :entityType',
      { ':entityType': 'CALENDARDATE' },
      undefined,
      400,
    );

    const inYear = result.items.filter(d => d.academicYearId === academicYearId);
    return partitionRowsBySource(inYear);
  }

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

    // C3.6 — normalize BS-or-AD inputs to AD before the generator runs.
    // `bsToGregorian` (via resolveAdDate) is TZ-safe as of shared-types 0.45.0.
    const ad = normalizeGenerateCalendarDtoToAd(dto);
    const mode = ad.mode;
    this.logger.log(
      `generateCalendar: schoolId=${schoolId} yearId=${yearId} mode=${mode} ` +
      `window=${ad.startDate}..${ad.endDate}`,
    );

    // 1. Validate academic year exists
    const year = await this.academicYearsService.getAcademicYear(schoolId, yearId, context);

    // 2. Get or create default Calendar entity (Ed-Fi: Calendar → CalendarDate)
    const calendar = await this.calendarService.getOrCreateDefaultCalendar(
      schoolId,
      yearId,
      context
    );

    // 3. Snapshot existing rows so we can either fully replace (Danger Zone)
    //    or merge — preserving operator-touched rows. Source-of-truth for
    //    "operator-touched" is the entity's createdBy/updatedBy fields:
    //    SYSTEM-generated rows carry 'SYSTEM' in both; once an operator
    //    creates or edits a row, at least one of the two becomes a userId.
    let preservedDates = new Set<string>();
    let preservedCount = 0;
    if (mode === 'replace') {
      const { deleted } = await this.deleteCalendarDatesForYear(schoolId, yearId, context);
      this.logger.log(
        `generateCalendar(replace): deleted=${deleted} (operator overrides destroyed)`,
      );
    } else {
      // mode === 'merge': partition + delete only the SYSTEM rows
      const partition = await this.partitionCalendarDatesForMerge(schoolId, yearId, context);
      if (partition.systemRowKeys.length > 0) {
        const deleteRequests = partition.systemRowKeys.map(key => ({
          DeleteRequest: { Key: { tenantId: context.tenantId, entityKey: key } },
        }));
        const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
        await this.dynamoDBClient.batchWriteItems(client, deleteRequests);
      }
      preservedDates = partition.preservedDates;
      preservedCount = preservedDates.size;
      this.logger.log(
        `generateCalendar(merge): deleted=${partition.systemRowKeys.length} system rows; ` +
        `preserved=${preservedCount} operator rows`,
      );
    }

    // 4. Generate dates using existing utility (AD inputs)
    let calendarDates = generateCalendarDatesForRange(
      context.tenantId,
      schoolId,
      yearId,
      ad.startDate,
      ad.endDate,
      {
        defaultBellScheduleId: ad.defaultBellScheduleId,
        schoolDays: ad.schoolDays,
        holidays: ad.holidays,
        breaks: ad.breaks,
      }
    );

    // In merge mode, drop generated rows for any date with a preserved
    // operator row — the operator's row wins.
    if (mode === 'merge' && preservedDates.size > 0) {
      const before = calendarDates.length;
      calendarDates = calendarDates.filter(cd => !preservedDates.has(cd.date));
      this.logger.debug(
        `generateCalendar(merge): yielded ${before - calendarDates.length} ` +
        `generated rows to preserved operator rows`,
      );
    }

    // 5. Set calendarId on each generated date
    calendarDates.forEach(cd => {
      cd.calendarId = calendar.calendarId;
    });

    // 6. Bulk insert
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const putRequests = calendarDates.map(item => ({
      PutRequest: { Item: item },
    }));
    if (putRequests.length > 0) {
      await this.dynamoDBClient.batchWriteItems(client, putRequests);
    }

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

        if (ad.endDate > lastSessionEnd) {
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

    // Sprint S2.3 — audit calendar generation. Captures range, totals, and
    // holiday count so compliance reviewers can answer "what was generated
    // when?" without DDB inspection. This includes regenerations (since the
    // current state of CalendarDate rows reflects the latest generation).
    // Tagged `severity: high` because `replace` mode deletes operator
    // overrides; `merge` mode preserves them. The `mode` + `preservedCount`
    // fields are the post-hoc record of which path ran.
    await this.auditedWrite.emit(context, {
      schoolId,
      targetEntity: 'CALENDAR',
      targetEntityId: calendar.calendarId,
      action: 'create',
      severity: 'high',
      changes: [
        { field: 'academicYearId', oldValue: null, newValue: yearId },
        { field: 'startDate', oldValue: null, newValue: ad.startDate },
        { field: 'endDate', oldValue: null, newValue: ad.endDate },
        { field: 'mode', oldValue: null, newValue: mode },
        { field: 'preservedOperatorRows', oldValue: null, newValue: preservedCount },
        { field: 'totalDays', oldValue: null, newValue: summary.totalDays },
        { field: 'instructionalDays', oldValue: null, newValue: summary.instructionalDays },
        { field: 'holidays', oldValue: null, newValue: summary.holidays },
        { field: 'weekends', oldValue: null, newValue: weekendCount },
        { field: 'sessionsSynced', oldValue: null, newValue: sessionSummaries.length },
      ],
    });

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
