/**
 * Attendance Service - Daily attendance tracking
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import {
  Attendance,
  createAttendanceEntity,
  AttendanceSummary,
} from '../common/entities/attendance.entity';
import {
  EntityKeyBuilder,
  GSIKeyBuilder,
  RequestContext,
  PaginatedResult,
} from '../common/entities/base.entity';
import {
  CreateAttendanceDto,
  BulkAttendanceDto,
  UpdateAttendanceDto,
  AttendanceResponseDto,
  DailyAttendanceSummaryDto,
  StudentAttendanceSummaryDto,
  BulkAttendanceResponseDto,
} from '@aibrains/shared-types';
import {
  attendanceEntityToDto,
  createAttendanceDtoToEntity,
  updateAttendanceDtoToEntity,
  createBulkAttendanceResponse,
} from '../common/mappers';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { IdentityClientService, CalendarDateResponse } from '../common/services/identity-client.service';

// Type alias for backward compatibility
type RecordAttendanceDto = CreateAttendanceDto;

// In-memory calendar date cache entry
interface CalendarCacheEntry {
  data: CalendarDateResponse | null;
  cachedAt: number;
}

const CALENDAR_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);
  private readonly calendarCache = new Map<string, CalendarCacheEntry>();

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: AcademicsEventsService,
    private readonly identityClient: IdentityClientService,
  ) {}

  /**
   * Record attendance for a single student
   */
  async recordAttendance(
    recordDto: RecordAttendanceDto,
    context: RequestContext
  ): Promise<AttendanceResponseDto> {
    // Calendar-aware validation: block attendance on non-instructional days (SP5-2)
    await this.validateInstructionalDay(recordDto.schoolId, recordDto.date, context);

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const now = new Date().toISOString();
    const attendanceId = uuid();

    // Check if attendance already exists for this date
    const existing = await this.dynamoDBClient.getItem<Attendance>(
      client,
      context.tenantId,
      EntityKeyBuilder.attendance(recordDto.date, recordDto.studentId)
    );

    if (existing) {
      // Update existing record
      return this.updateAttendance(
        recordDto.date,
        recordDto.studentId,
        {
          status: recordDto.status,
          checkInTime: recordDto.checkInTime,
          checkOutTime: recordDto.checkOutTime,
          notes: recordDto.notes,
          excuseReason: recordDto.excuseReason,
          periodNumber: recordDto.periodNumber,
        },
        context
      );
    }

    // Convert DTO to entity fields using mapper
    const entityData = createAttendanceDtoToEntity(recordDto);
    
    const attendance = createAttendanceEntity(
      context.tenantId,
      attendanceId,
      recordDto.studentId,
      recordDto.schoolId,
      recordDto.date,
      {
        ...entityData,
        recordedBy: context.userId,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );

    await this.dynamoDBClient.putItem(client, attendance);

    this.logger.log(`Attendance recorded: ${recordDto.studentId} on ${recordDto.date}`);

    // Publish event (non-blocking)
    this.eventsService.publishAttendanceRecorded(
      context.tenantId,
      recordDto.studentId,
      recordDto.schoolId,
      recordDto.date,
      recordDto.status,
    ).catch(err => this.logger.error('Failed to publish AttendanceRecorded event', err));

    return this.toAttendanceResponse(attendance);
  }

  /**
   * Record attendance in bulk (for a class/section)
   */
  async recordBulkAttendance(
    bulkDto: BulkAttendanceDto,
    context: RequestContext
  ): Promise<BulkAttendanceResponseDto> {
    // Calendar-aware validation: block attendance on non-instructional days (SP5-2)
    await this.validateInstructionalDay(bulkDto.schoolId, bulkDto.date, context);

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const now = new Date().toISOString();
    
    const results = {
      created: 0,
      updated: 0,
      errors: [] as Array<{ studentId: string; error: string }>,
    };

    for (const record of bulkDto.records) {
      try {
        // Check for existing attendance
        const existing = await this.dynamoDBClient.getItem<Attendance>(
          client,
          context.tenantId,
          EntityKeyBuilder.attendance(bulkDto.date, record.studentId)
        );

        if (existing) {
          // Update existing - map DTO field names to entity field names
          await this.dynamoDBClient.updateItem(
            client,
            context.tenantId,
            EntityKeyBuilder.attendance(bulkDto.date, record.studentId),
            'SET #status = :status, checkInTime = :checkInTime, note = :note, updatedAt = :updatedAt, updatedBy = :updatedBy',
            {
              ':status': record.status,
              ':checkInTime': record.checkInTime || null,
              ':note': record.notes || null,  // notes (DTO) -> note (entity)
              ':updatedAt': now,
              ':updatedBy': context.userId,
            },
            undefined,
            { '#status': 'status' }
          );
          results.updated++;
        } else {
          // Create new
          const attendanceId = uuid();
          const attendance = createAttendanceEntity(
            context.tenantId,
            attendanceId,
            record.studentId,
            bulkDto.schoolId,
            bulkDto.date,
            {
              academicYearId: '',  // Will be set from context if needed
              status: record.status,
              checkInTime: record.checkInTime,
              note: record.notes,  // notes (DTO) -> note (entity)
              recordedBy: context.userId,
              createdAt: now,
              createdBy: context.userId,
              updatedAt: now,
              updatedBy: context.userId,
              version: 1,
            }
          );

          await this.dynamoDBClient.putItem(client, attendance);
          results.created++;
        }
      } catch (error: any) {
        results.errors.push({
          studentId: record.studentId,
          error: error.message,
        });
      }
    }

    this.logger.log(`Bulk attendance recorded: ${results.created} created, ${results.updated} updated for ${bulkDto.date}`);

    // Publish bulk event (non-blocking)
    const presentCount = bulkDto.records.filter(r => r.status === 'present').length;
    const absentCount = bulkDto.records.filter(r => r.status === 'absent').length;
    this.eventsService.publishBulkAttendanceRecorded(
      context.tenantId,
      bulkDto.schoolId,
      bulkDto.date,
      results.created + results.updated,
      presentCount,
      absentCount,
    ).catch(err => this.logger.error('Failed to publish BulkAttendanceRecorded event', err));

    return createBulkAttendanceResponse(bulkDto.date, bulkDto.schoolId, results);
  }

  /**
   * Get attendance for a specific date
   */
  async getAttendanceByDate(
    schoolId: string,
    date: string,
    context: RequestContext,
    limit: number = 100
  ): Promise<PaginatedResult<AttendanceResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const result = await this.dynamoDBClient.queryGSI<Attendance>(
      client,
      'GSI3',
      GSIKeyBuilder.attendanceDate(context.tenantId, schoolId, date),
      'ATTENDANCE#',
      'begins_with',
      undefined,
      undefined,
      undefined,
      limit
    );

    return {
      items: result.items.map(a => this.toAttendanceResponse(a)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Get attendance for a student over date range
   */
  async getStudentAttendance(
    studentId: string,
    startDate: string,
    endDate: string,
    context: RequestContext
  ): Promise<AttendanceResponseDto[]> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Query by tenant + date range
    const result = await this.dynamoDBClient.query<Attendance>(
      client,
      context.tenantId,
      `ATTENDANCE#`,
      'studentId = :studentId AND #date BETWEEN :startDate AND :endDate',
      {
        ':studentId': studentId,
        ':startDate': startDate,
        ':endDate': endDate,
      },
      { '#date': 'date' },
      365  // Max 1 year
    );

    return result.items
      .filter(a => a.studentId === studentId)
      .map(a => this.toAttendanceResponse(a));
  }

  /**
   * Update attendance record
   */
  async updateAttendance(
    date: string,
    studentId: string,
    updateDto: UpdateAttendanceDto,
    context: RequestContext
  ): Promise<AttendanceResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const attendance = await this.dynamoDBClient.getItem<Attendance>(
      client,
      context.tenantId,
      EntityKeyBuilder.attendance(date, studentId)
    );

    if (!attendance) {
      throw new NotFoundException('Attendance record not found');
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};
    const names: Record<string, string> = {};

    if (updateDto.status) {
      updates.push('#status = :status');
      values[':status'] = updateDto.status;
      names['#status'] = 'status';
    }

    if (updateDto.checkInTime !== undefined) {
      updates.push('checkInTime = :checkInTime');
      values[':checkInTime'] = updateDto.checkInTime;
    }

    if (updateDto.checkOutTime !== undefined) {
      updates.push('checkOutTime = :checkOutTime');
      values[':checkOutTime'] = updateDto.checkOutTime;
    }

    // Map DTO field names to entity field names
    if (updateDto.notes !== undefined) {
      updates.push('note = :note');
      values[':note'] = updateDto.notes;  // notes (DTO) -> note (entity)
    }

    if (updateDto.excuseReason !== undefined) {
      updates.push('reason = :reason');
      values[':reason'] = updateDto.excuseReason;  // excuseReason (DTO) -> reason (entity)
    }

    if (updateDto.periodNumber !== undefined) {
      updates.push('periodAttendance = :periodAttendance');
      values[':periodAttendance'] = [{
        periodNumber: updateDto.periodNumber,
        status: updateDto.status || attendance.status,
      }];
    }

    if (updates.length === 0) {
      return this.toAttendanceResponse(attendance);
    }

    updates.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy', '#version = #version + :inc');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;
    values[':inc'] = 1;
    names['#version'] = 'version';

    const updatedAttendance = await this.dynamoDBClient.updateItem<Attendance>(
      client,
      context.tenantId,
      EntityKeyBuilder.attendance(date, studentId),
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      names
    );

    this.logger.log(`Attendance updated: ${studentId} on ${date}`);

    return this.toAttendanceResponse(updatedAttendance);
  }

  /**
   * Get daily attendance summary for a school
   */
  async getDailyAttendanceSummary(
    schoolId: string,
    date: string,
    context: RequestContext
  ): Promise<DailyAttendanceSummaryDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const result = await this.dynamoDBClient.queryGSI<Attendance>(
      client,
      'GSI3',
      GSIKeyBuilder.attendanceDate(context.tenantId, schoolId, date),
      'ATTENDANCE#',
      'begins_with',
      undefined,
      undefined,
      undefined,
      1000
    );

    const summary: DailyAttendanceSummaryDto = {
      schoolId,
      date,
      totalStudents: result.items.length,
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
      halfDay: 0,
      attendanceRate: 0,
    };

    for (const attendance of result.items) {
      switch (attendance.status) {
        case 'present':
          summary.present++;
          break;
        case 'absent':
          summary.absent++;
          break;
        case 'late':
          summary.late++;
          break;
        case 'excused':
          summary.excused++;
          break;
        case 'half_day':
          summary.halfDay++;
          break;
      }
    }

    // Calculate attendance rate (present + late + half_day count as attending)
    const attending = summary.present + summary.late + summary.halfDay;
    summary.attendanceRate = summary.totalStudents > 0
      ? Math.round((attending / summary.totalStudents) * 100 * 100) / 100
      : 0;

    return summary;
  }

  /**
   * Get student attendance summary
   */
  async getStudentAttendanceSummary(
    studentId: string,
    schoolId: string,
    academicYearId: string,
    startDate: string,
    endDate: string,
    context: RequestContext,
    studentName: string = ''
  ): Promise<StudentAttendanceSummaryDto> {
    const attendanceRecords = await this.getStudentAttendance(
      studentId,
      startDate,
      endDate,
      context
    );

    let present = 0;
    let absent = 0;
    let late = 0;
    let excused = 0;
    let halfDay = 0;

    for (const record of attendanceRecords) {
      switch (record.status) {
        case 'present':
          present++;
          break;
        case 'absent':
          absent++;
          break;
        case 'late':
        case 'tardy':
          late++;
          break;
        case 'excused':
          excused++;
          break;
        case 'half_day':
          halfDay++;
          break;
      }
    }

    const attending = present + late + halfDay;
    const attendanceRate = attendanceRecords.length > 0
      ? Math.round((attending / attendanceRecords.length) * 100 * 100) / 100
      : 0;

    return {
      studentId,
      studentName,
      schoolId,
      academicYearId,
      totalDays: attendanceRecords.length,
      present,
      absent,
      late,
      excused,
      halfDay,
      attendanceRate,
      dateRange: { start: startDate, end: endDate },
    };
  }

  // ============================================
  // Attendance Trend & Alerts (Sprint 5)
  // ============================================

  /**
   * Get attendance trend (daily summaries) over a date range
   */
  async getAttendanceTrend(
    schoolId: string,
    startDate: string,
    endDate: string,
    context: RequestContext,
  ): Promise<DailyAttendanceSummaryDto[]> {
    const summaries: DailyAttendanceSummaryDto[] = [];
    const current = new Date(startDate);
    const end = new Date(endDate);

    // Iterate over each date in the range (max 90 days)
    let count = 0;
    while (current <= end && count < 90) {
      const dateStr = current.toISOString().split('T')[0];
      try {
        const summary = await this.getDailyAttendanceSummary(schoolId, dateStr, context);
        if (summary.totalStudents > 0) {
          summaries.push(summary);
        }
      } catch (error) {
        // Skip dates with errors
        this.logger.warn(`Failed to get attendance summary for ${dateStr}: ${error}`);
      }
      current.setDate(current.getDate() + 1);
      count++;
    }

    return summaries;
  }

  /**
   * Get students below a given attendance rate threshold
   */
  async getAttendanceAlerts(
    schoolId: string,
    academicYearId: string,
    threshold: number,
    startDate: string,
    endDate: string,
    context: RequestContext,
  ): Promise<Array<{
    studentId: string;
    studentName: string;
    attendanceRate: number;
    totalDays: number;
    absentDays: number;
  }>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Get all enrollments for this school/year to get student list
    const enrollments = await this.dynamoDBClient.queryGSI<{
      studentId: string;
      status: string;
      studentName?: string;
    }>(
      client,
      'GSI1',
      GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
      `ENROLLMENT#${academicYearId}#`,
      'begins_with',
      undefined,
      undefined,
      undefined,
      500,
    );

    const activeEnrollments = enrollments.items.filter(
      e => e.status === 'enrolled' || e.status === 'active',
    );

    const alerts: Array<{
      studentId: string;
      studentName: string;
      attendanceRate: number;
      totalDays: number;
      absentDays: number;
    }> = [];

    for (const enrollment of activeEnrollments) {
      try {
        const summary = await this.getStudentAttendanceSummary(
          enrollment.studentId,
          schoolId,
          academicYearId,
          startDate,
          endDate,
          context,
        );

        if (summary.totalDays > 0 && summary.attendanceRate < threshold) {
          alerts.push({
            studentId: enrollment.studentId,
            studentName: summary.studentName || enrollment.studentName || enrollment.studentId,
            attendanceRate: summary.attendanceRate,
            totalDays: summary.totalDays,
            absentDays: summary.absent,
          });
        }
      } catch (error) {
        // Skip students with errors
      }
    }

    // Sort by attendance rate ascending (worst first)
    alerts.sort((a, b) => a.attendanceRate - b.attendanceRate);

    return alerts;
  }

  // ============================================
  // Calendar Validation (Sprint 5)
  // ============================================

  /**
   * Validate that a date is an instructional day for the given school.
   * Uses in-memory cache with 5-minute TTL to reduce cross-service calls.
   * Graceful degradation: if calendar is not configured, attendance is allowed.
   */
  private async validateInstructionalDay(
    schoolId: string,
    date: string,
    context: RequestContext,
  ): Promise<void> {
    const cacheKey = `${schoolId}:${date}`;
    const cached = this.calendarCache.get(cacheKey);

    let calendarDate: CalendarDateResponse | null;

    if (cached && Date.now() - cached.cachedAt < CALENDAR_CACHE_TTL_MS) {
      calendarDate = cached.data;
    } else {
      try {
        calendarDate = await this.identityClient.getCalendarDate(schoolId, date, context);
        this.calendarCache.set(cacheKey, { data: calendarDate, cachedAt: Date.now() });
      } catch (error) {
        // If identity service is down, allow attendance (graceful degradation)
        this.logger.warn(`Calendar validation skipped for ${date}: ${error}`);
        return;
      }
    }

    // If no calendar date configured, allow attendance (calendar may not be set up)
    if (!calendarDate) {
      return;
    }

    // Block attendance on non-instructional days
    if (calendarDate.calendarEventType !== 'instructional') {
      throw new BadRequestException(
        `Attendance cannot be recorded on ${date}: ${calendarDate.description || 'non-instructional day'}`,
      );
    }
  }

  /**
   * Convert Attendance entity to response DTO using mapper
   */
  private toAttendanceResponse(attendance: Attendance): AttendanceResponseDto {
    return attendanceEntityToDto(attendance);
  }
}

