/**
 * Attendance Service - Daily attendance tracking
 *
 * Sprint 1 improvements:
 * - Task 1.1: totalStudents uses enrollment count, not record count
 * - Task 1.2: tardy/late normalization, remote status handling
 * - Task 1.4: studentName via cached batch resolution (Option C hybrid)
 * - Task 1.6: byGradeLevel computed from enrollment data
 * - Task 1.7: Parallelized trend queries (batches of 10)
 * - Task 1.8: Optimized alerts with batch queries + trend computation
 * - Task 1.10-1.11: getAttendanceOverview aggregate endpoint
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { DataScopeService } from '../common/services/data-scope.service';
import {
  SchoolAttendance,
  createSchoolAttendanceEntity,
} from '../common/entities/school-attendance.entity';
import { Enrollment } from '../common/entities/enrollment.entity';
import { CourseSection } from '../common/entities/course.entity';
import { SectionEnrollment } from '../common/entities/section-enrollment.entity';
import { Student } from '../common/entities/student.entity';
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

// In-memory overview cache entry
interface OverviewCacheEntry {
  data: any;
  cachedAt: number;
}

// In-memory student name cache entry (Option C: hybrid denormalization)
interface StudentNameCacheEntry {
  name: string;
  cachedAt: number;
}

const CALENDAR_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OVERVIEW_CACHE_TTL_MS = 60 * 1000; // 60 seconds
const STUDENT_NAME_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Reason taxonomy for DATE_NOT_INSTRUCTIONAL — mirrors the classification
 * exposed by @edforge/pilot-fixtures (`shiftProfileForDate`).
 */
export type NonInstructionalReason =
  | 'holiday'
  | 'vacation'
  | 'weekend'
  | 'break'
  | 'non_instructional';

/**
 * Derive the most specific reason a calendar-date row is non-instructional.
 *
 * Precedence (intentionally aligned with identity's ShiftResolverService):
 *   1. isWeekend                   → 'weekend'
 *   2. event.eventType='break'     → 'vacation'  (school vacation block)
 *   3. isHoliday                   → 'holiday'   (national/religious)
 *   4. otherwise                   → 'non_instructional'  (fall-through:
 *                                    e.g. teacher_only days carried as
 *                                    isInstructionalDay=false)
 *
 * Exported for spec coverage. Pure — no I/O.
 */
export function deriveNonInstructionalReason(
  cd: CalendarDateResponse,
): NonInstructionalReason {
  if (cd.isWeekend) return 'weekend';
  const events = cd.calendarEvents ?? [];
  if (events.some((e) => e.eventType === 'break')) return 'vacation';
  if (cd.isHoliday) return 'holiday';
  return 'non_instructional';
}

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);
  private readonly calendarCache = new Map<string, CalendarCacheEntry>();
  private readonly overviewCache = new Map<string, OverviewCacheEntry>();
  // Option C: Keyed by "tenantId#studentId" → { name, cachedAt }
  private readonly studentNameCache = new Map<string, StudentNameCacheEntry>();

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: AcademicsEventsService,
    private readonly identityClient: IdentityClientService,
    private readonly dataScopeService: DataScopeService,
  ) {}

  /**
   * Batch-resolve student names using batchGetItems + in-memory TTL cache.
   * Returns a Map<studentId, displayName>. Cache misses are fetched in a
   * single DynamoDB BatchGetItem call (max 100 per chunk, handled by client).
   */
  private async resolveStudentNames(
    client: any,
    tenantId: string,
    studentIds: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const now = Date.now();
    const uncachedIds: string[] = [];

    // 1. Check cache for each student
    for (const id of studentIds) {
      const cacheKey = `${tenantId}#${id}`;
      const cached = this.studentNameCache.get(cacheKey);
      if (cached && now - cached.cachedAt < STUDENT_NAME_CACHE_TTL_MS) {
        result.set(id, cached.name);
      } else {
        uncachedIds.push(id);
      }
    }

    if (uncachedIds.length === 0) return result;

    // 2. Batch-fetch uncached students
    try {
      const keys = uncachedIds.map(id => ({
        tenantId,
        entityKey: EntityKeyBuilder.student(id),
      }));
      const students = await this.dynamoDBClient.batchGetItems<Student>(client, keys);

      for (const student of students) {
        const name = [student.firstName, student.lastName].filter(Boolean).join(' ');
        if (name) {
          result.set(student.studentId, name);
          this.studentNameCache.set(`${tenantId}#${student.studentId}`, { name, cachedAt: now });
        }
      }
    } catch (error) {
      this.logger.warn(`Batch student name resolution failed: ${error}`);
    }

    return result;
  }

  /**
   * Record attendance for a single student
   * Task 1.4: Denormalizes studentName from enrollment lookup
   */
  async recordAttendance(
    recordDto: RecordAttendanceDto,
    context: RequestContext
  ): Promise<AttendanceResponseDto> {
    this.logger.debug(`recordAttendance: entry, studentId=${recordDto.studentId}, schoolId=${recordDto.schoolId}, date=${recordDto.date}, status=${recordDto.status}`);

    // Calendar-aware validation: block attendance on non-instructional days (SP5-2)
    await this.validateInstructionalDay(recordDto.schoolId, recordDto.date, context);

    // Write authorization: verify student is in user's data scope
    const scope = await this.dataScopeService.resolveScope(context.userId, recordDto.schoolId, context);
    if (!this.dataScopeService.isStudentInScope(scope, recordDto.studentId)) {
      throw new ForbiddenException('You do not have access to record attendance for this student');
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const now = new Date().toISOString();
    const attendanceId = uuid();

    // Check if attendance already exists for this date
    const existing = await this.dynamoDBClient.getItem<SchoolAttendance>(
      client,
      context.tenantId,
      EntityKeyBuilder.schoolAttendance(recordDto.date, recordDto.studentId)
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
        },
        context
      );
    }

    // Resolve student name via cached batch lookup
    const nameMap = await this.resolveStudentNames(client, context.tenantId, [recordDto.studentId]);
    const studentName = nameMap.get(recordDto.studentId);

    // Convert DTO to entity fields using mapper
    const entityData = createAttendanceDtoToEntity(recordDto);

    const attendance = createSchoolAttendanceEntity(
      context.tenantId,
      attendanceId,
      recordDto.studentId,
      recordDto.schoolId,
      recordDto.date,
      {
        ...entityData,
        studentName,
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
   * Task 1.4: Denormalizes studentName from enrollment records
   */
  async recordBulkAttendance(
    bulkDto: BulkAttendanceDto,
    context: RequestContext
  ): Promise<BulkAttendanceResponseDto> {
    this.logger.debug(`recordBulkAttendance: entry, schoolId=${bulkDto.schoolId}, date=${bulkDto.date}, batchSize=${bulkDto.records.length}`);

    // Calendar-aware validation: block attendance on non-instructional days (SP5-2)
    await this.validateInstructionalDay(bulkDto.schoolId, bulkDto.date, context);

    // Write authorization: verify all students are in user's data scope (reject entire batch if any is out of scope)
    const writeScope = await this.dataScopeService.resolveScope(context.userId, bulkDto.schoolId, context);
    for (const record of bulkDto.records) {
      if (!this.dataScopeService.isStudentInScope(writeScope, record.studentId)) {
        throw new ForbiddenException(
          `You do not have access to record attendance for student ${record.studentId}`,
        );
      }
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const now = new Date().toISOString();

    const results = {
      created: 0,
      updated: 0,
      errors: [] as Array<{ studentId: string; error: string }>,
    };

    // Resolve student names via cached batch lookup (replaces N+1 getItem calls)
    const studentIds = bulkDto.records.map(r => r.studentId);
    // Prefer DTO-provided names, then fall back to cached batch resolution
    const dtoNameMap = new Map<string, string>();
    for (const r of bulkDto.records) {
      if ((r as any).studentName) dtoNameMap.set(r.studentId, (r as any).studentName);
    }
    const idsNeedingLookup = studentIds.filter(id => !dtoNameMap.has(id));
    const resolvedNames = idsNeedingLookup.length > 0
      ? await this.resolveStudentNames(client, context.tenantId, idsNeedingLookup)
      : new Map<string, string>();
    // Merge: DTO names take priority
    const studentNameMap = new Map([...resolvedNames, ...dtoNameMap]);

    // Ticket 10: Batch-check existence instead of N sequential getItem calls
    const existingKeys = bulkDto.records.map(r => ({
      tenantId: context.tenantId,
      entityKey: EntityKeyBuilder.schoolAttendance(bulkDto.date, r.studentId),
    }));
    let existingRecords: SchoolAttendance[] = [];
    try {
      existingRecords = await this.dynamoDBClient.batchGetItems<SchoolAttendance>(client, existingKeys);
    } catch (error) {
      this.logger.warn(`Batch existence check failed, falling back to individual checks: ${error}`);
    }
    // Build lookup map for no-op detection (Ticket 15)
    const existingMap = new Map<string, SchoolAttendance>();
    for (const a of existingRecords) {
      existingMap.set(a.studentId, a);
    }

    for (const record of bulkDto.records) {
      try {
        const resolvedName = studentNameMap.get(record.studentId);
        const existing = existingMap.get(record.studentId);

        if (existing) {
          // Skip update if nothing changed (no-op detection)
          if (existing.status === record.status &&
              (existing.note || null) === (record.notes || null) &&
              (existing.checkInTime || null) === (record.checkInTime || null)) {
            results.updated++;
            continue;
          }

          const updateExpr = 'SET #status = :status, checkInTime = :checkInTime, note = :note, studentName = :studentName, updatedAt = :updatedAt, updatedBy = :updatedBy, #version = if_not_exists(#version, :zero) + :inc';
          const updateValues: Record<string, any> = {
            ':status': record.status,
            ':checkInTime': record.checkInTime || null,
            ':note': record.notes || null,
            ':studentName': resolvedName,
            ':updatedAt': now,
            ':updatedBy': context.userId,
            ':inc': 1,
            ':zero': 0,
          };
          await this.dynamoDBClient.updateItem(
            client,
            context.tenantId,
            EntityKeyBuilder.schoolAttendance(bulkDto.date, record.studentId),
            updateExpr,
            updateValues,
            undefined,
            { '#status': 'status', '#version': 'version' }
          );
          results.updated++;
        } else {
          // Create new — use condition expression to prevent TOCTOU race
          // If another concurrent request created this record between our batchGetItems
          // and this putItem, the condition fails and we fall through to update.
          const attendanceId = uuid();
          const attendance = createSchoolAttendanceEntity(
            context.tenantId,
            attendanceId,
            record.studentId,
            bulkDto.schoolId,
            bulkDto.date,
            {
              academicYearId: '',
              status: record.status,
              studentName: resolvedName,
              checkInTime: record.checkInTime,
              note: record.notes,
              recordedBy: context.userId,
              createdAt: now,
              createdBy: context.userId,
              updatedAt: now,
              updatedBy: context.userId,
              version: 1,
            }
          );

          try {
            await this.dynamoDBClient.putItem(
              client,
              attendance,
              'attribute_not_exists(entityKey)',
            );
            results.created++;
          } catch (putError: any) {
            if (putError.name === 'ConditionalCheckFailedException') {
              // Record was created by a concurrent request — fall through to update
              this.logger.debug(`Concurrent create detected for student ${record.studentId} on ${bulkDto.date}, falling through to update`);
              const updateExpr = 'SET #status = :status, checkInTime = :checkInTime, note = :note, studentName = :studentName, updatedAt = :updatedAt, updatedBy = :updatedBy, #version = if_not_exists(#version, :zero) + :inc';
              const updateValues: Record<string, any> = {
                ':status': record.status,
                ':checkInTime': record.checkInTime || null,
                ':note': record.notes || null,
                ':studentName': resolvedName,
                ':updatedAt': now,
                ':updatedBy': context.userId,
                ':inc': 1,
                ':zero': 0,
              };
              await this.dynamoDBClient.updateItem(
                client,
                context.tenantId,
                EntityKeyBuilder.schoolAttendance(bulkDto.date, record.studentId),
                updateExpr,
                updateValues,
                undefined,
                { '#status': 'status', '#version': 'version' }
              );
              results.updated++;
            } else {
              throw putError;
            }
          }
        }
      } catch (error: any) {
        results.errors.push({
          studentId: record.studentId,
          error: error.message,
        });
      }
    }

    this.logger.debug(`recordBulkAttendance: completed, created=${results.created}, updated=${results.updated}, errors=${results.errors.length}`);
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
    this.logger.debug(`getAttendanceByDate: entry, schoolId=${schoolId}, date=${date}, limit=${limit}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const result = await this.dynamoDBClient.queryGSI<SchoolAttendance>(
      client,
      'GSI3',
      GSIKeyBuilder.attendanceDate(context.tenantId, schoolId, date),
      'SCH_ATTEND#',
      'begins_with',
      undefined,
      undefined,
      undefined,
      limit
    );

    // Row-level security: filter by user's data scope
    const scope = await this.dataScopeService.resolveScope(context.userId, schoolId, context);
    const scopedItems = this.dataScopeService.filterByStudentScope(scope, result.items);

    this.logger.debug(`getAttendanceByDate: found ${result.items.length} records, ${scopedItems.length} after scope filter`);

    return {
      items: scopedItems.map(a => this.toAttendanceResponse(a)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Get attendance for a student over date range.
   * Uses SK range query (BETWEEN) for efficient date-bounded lookups.
   * SK format: SCH_ATTEND#{date}#{studentId}
   * then filter by studentId. This reduces DynamoDB scanned items from O(all_attendance) to O(date_range).
   */
  async getStudentAttendance(
    studentId: string,
    startDate: string | undefined,
    endDate: string | undefined,
    context: RequestContext,
    schoolId?: string,
  ): Promise<AttendanceResponseDto[]> {
    this.logger.debug(`getStudentAttendance: entry, studentId=${studentId}, startDate=${startDate}, endDate=${endDate}, schoolId=${schoolId || 'not provided'}`);
    // Row-level security: if schoolId is available, check scope
    if (schoolId) {
      const scope = await this.dataScopeService.resolveScope(context.userId, schoolId, context);
      if (!this.dataScopeService.isStudentInScope(scope, studentId)) {
        return []; // Out of scope — return empty for graceful degradation
      }
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Task 3.3: Use range query when dates are provided (most common path)
    if (startDate && endDate) {
      const skStart = `SCH_ATTEND#${startDate}`;
      const skEnd = `SCH_ATTEND#${endDate}\uffff`; // \uffff sorts after any studentId suffix

      const result = await this.dynamoDBClient.queryRange<SchoolAttendance>(
        client,
        context.tenantId,
        skStart,
        skEnd,
        'studentId = :studentId',
        { ':studentId': studentId },
        undefined,
        365,
      );

      return result.items.map(a => this.toAttendanceResponse(a));
    }

    // Fallback: no date range — query all attendance records for this student
    // This is less efficient but rarely used (only when dates are omitted)
    const result = await this.dynamoDBClient.query<SchoolAttendance>(
      client,
      context.tenantId,
      `SCH_ATTEND#`,
      'studentId = :studentId',
      { ':studentId': studentId },
      undefined,
      365,
    );

    return result.items.map(a => this.toAttendanceResponse(a));
  }

  /**
   * Update attendance record
   * Task 4.7: Includes optimistic locking via version condition
   */
  async updateAttendance(
    date: string,
    studentId: string,
    updateDto: UpdateAttendanceDto,
    context: RequestContext
  ): Promise<AttendanceResponseDto> {
    this.logger.debug(`updateAttendance: entry, studentId=${studentId}, date=${date}, newStatus=${updateDto.status || 'unchanged'}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const attendance = await this.dynamoDBClient.getItem<SchoolAttendance>(
      client,
      context.tenantId,
      EntityKeyBuilder.schoolAttendance(date, studentId)
    );

    if (!attendance) {
      throw new NotFoundException('Attendance record not found');
    }

    // Write authorization: verify student is in user's data scope
    if (attendance.schoolId) {
      const scope = await this.dataScopeService.resolveScope(context.userId, attendance.schoolId, context);
      if (!this.dataScopeService.isStudentInScope(scope, studentId)) {
        throw new ForbiddenException('You do not have access to update attendance for this student');
      }
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

    // Task 4.5: Map excuseType from DTO
    if ((updateDto as any).excuseType !== undefined) {
      updates.push('excuseType = :excuseType');
      values[':excuseType'] = (updateDto as any).excuseType;
    }

    if (updates.length === 0) {
      return this.toAttendanceResponse(attendance);
    }

    updates.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy', '#version = #version + :inc');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;
    values[':inc'] = 1;
    names['#version'] = 'version';

    // Task 4.7: Optimistic locking - check version matches
    const expectedVersion = (updateDto as any).expectedVersion;
    let conditionExpression: string | undefined;
    if (expectedVersion !== undefined) {
      conditionExpression = '#version = :expectedVersion';
      values[':expectedVersion'] = expectedVersion;
    }

    try {
      const updatedAttendance = await this.dynamoDBClient.updateItem<SchoolAttendance>(
        client,
        context.tenantId,
        EntityKeyBuilder.schoolAttendance(date, studentId),
        `SET ${updates.join(', ')}`,
        values,
        conditionExpression,
        names
      );

      this.logger.log(`Attendance updated: ${studentId} on ${date}`);

      return this.toAttendanceResponse(updatedAttendance);
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        throw new ConflictException('Record was modified by another user. Please refresh to see their changes.');
      }
      throw error;
    }
  }

  /**
   * Get daily attendance summary for a school
   *
   * Task 1.1: Uses enrollment count for totalStudents denominator
   * Task 1.2: Handles tardy (→ late) and remote statuses
   * Task 1.6: Computes byGradeLevel from enrollment data
   */
  async getDailyAttendanceSummary(
    schoolId: string,
    date: string,
    context: RequestContext,
    academicYearId?: string,
    /** Ticket 11: Pre-fetched enrollments to avoid redundant queries in trend loops */
    cachedEnrollments?: Enrollment[],
  ): Promise<DailyAttendanceSummaryDto> {
    this.logger.debug(`getDailyAttendanceSummary: entry, schoolId=${schoolId}, date=${date}, academicYearId=${academicYearId || 'none'}, hasCachedEnrollments=${!!cachedEnrollments}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Query attendance records for this school+date
    const result = await this.dynamoDBClient.queryGSI<SchoolAttendance>(
      client,
      'GSI3',
      GSIKeyBuilder.attendanceDate(context.tenantId, schoolId, date),
      'SCH_ATTEND#',
      'begins_with',
      undefined,
      undefined,
      undefined,
      1000
    );

    // Row-level security: filter attendance records by user's data scope
    const scope = await this.dataScopeService.resolveScope(context.userId, schoolId, context);
    const scopedAttendance = this.dataScopeService.filterByStudentScope(scope, result.items);

    // Task 1.1: Query enrollment records to get actual student count
    // Ticket 11: Use pre-fetched enrollments if provided (avoids N redundant queries in trend)
    let enrolledStudents: Enrollment[] = cachedEnrollments || [];
    if (enrolledStudents.length === 0 && academicYearId) {
      try {
        const enrollmentResult = await this.dynamoDBClient.queryGSI<Enrollment>(
          client,
          'GSI1',
          GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
          `ENROLLMENT#${academicYearId}`,
          'begins_with',
          'entityType = :entityType',
          { ':entityType': 'ENROLLMENT' },
          undefined,
          1000,
        );
        enrolledStudents = enrollmentResult.items.filter(
          e => e.status === 'enrolled' || e.status === 'active',
        );
      } catch (error) {
        this.logger.warn(`Failed to fetch enrollments for totalStudents: ${error}`);
      }
    }

    // Apply scope to enrollments too (Teacher only sees their students)
    enrolledStudents = this.dataScopeService.filterByStudentScope(scope, enrolledStudents);

    // Task 1.1: totalStudents = enrollment count (falls back to record count if no enrollment data)
    const totalStudents = enrolledStudents.length > 0
      ? enrolledStudents.length
      : scopedAttendance.length;

    const summary: DailyAttendanceSummaryDto & { totalRecorded: number; remote: number } = {
      schoolId,
      date,
      totalStudents,
      totalRecorded: scopedAttendance.length,
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
      halfDay: 0,
      remote: 0,
      attendanceRate: 0,
    };

    // Task 1.6: Build grade-level map from enrollment data
    const studentGradeMap = new Map<string, string>();
    if (enrolledStudents.length > 0) {
      for (const enrollment of enrolledStudents) {
        studentGradeMap.set(enrollment.studentId, enrollment.gradeLevel || 'Unclassified');
      }
    }

    // Grade-level aggregation
    const gradeLevelAgg = new Map<string, { total: number; present: number; absent: number }>();

    for (const attendance of scopedAttendance) {
      // Task 1.2: Normalize tardy → late, handle remote
      switch (attendance.status) {
        case 'present':
          summary.present++;
          break;
        case 'absent':
          summary.absent++;
          break;
        case 'late':
        case 'tardy':  // Task 1.2: tardy falls through to late
          summary.late++;
          break;
        case 'excused':
          summary.excused++;
          break;
        case 'half_day':
          summary.halfDay++;
          break;
        case 'remote':  // Task 1.2: remote counts as attending
          summary.remote++;
          break;
      }

      // Task 1.6: Aggregate by grade level
      if (studentGradeMap.size > 0) {
        const grade = studentGradeMap.get(attendance.studentId) || 'Unclassified';
        let gradeData = gradeLevelAgg.get(grade);
        if (!gradeData) {
          gradeData = { total: 0, present: 0, absent: 0 };
          gradeLevelAgg.set(grade, gradeData);
        }
        gradeData.total++;
        if (attendance.status === 'present' || attendance.status === 'late' ||
            attendance.status === 'tardy' || attendance.status === 'half_day' ||
            attendance.status === 'remote') {
          gradeData.present++;
        } else if (attendance.status === 'absent') {
          gradeData.absent++;
        }
      }
    }

    this.logger.debug(`getDailyAttendanceSummary: totalStudents=${totalStudents}, totalRecorded=${scopedAttendance.length}, enrolledCount=${enrolledStudents.length}`);
    // Task 1.2: Rate includes present + late + halfDay + remote as "attending"
    const attending = summary.present + summary.late + summary.halfDay + summary.remote;
    summary.attendanceRate = totalStudents > 0
      ? Math.round((attending / totalStudents) * 100 * 100) / 100
      : 0;

    // Task 1.6: Convert grade aggregation to DTO format
    if (gradeLevelAgg.size > 0) {
      const byGradeLevel: Record<string, { total: number; present: number; absent: number; rate: number }> = {};
      // Also include grades from enrollment that may have no attendance records yet
      for (const enrollment of enrolledStudents) {
        const grade = enrollment.gradeLevel || 'Unclassified';
        if (!gradeLevelAgg.has(grade)) {
          gradeLevelAgg.set(grade, { total: 0, present: 0, absent: 0 });
        }
      }
      for (const [grade, data] of gradeLevelAgg) {
        // Get enrolled count for this grade
        const enrolledInGrade = enrolledStudents.filter(
          e => (e.gradeLevel || 'Unclassified') === grade
        ).length;
        const gradeTotal = enrolledInGrade > 0 ? enrolledInGrade : data.total;
        byGradeLevel[grade] = {
          total: gradeTotal,
          present: data.present,
          absent: data.absent,
          rate: gradeTotal > 0 ? Math.round((data.present / gradeTotal) * 100 * 100) / 100 : 0,
        };
      }
      summary.byGradeLevel = byGradeLevel;
    }

    return summary;
  }

  /**
   * Get student attendance summary
   * Task 1.2: Handles tardy and remote statuses
   */
  async getStudentAttendanceSummary(
    studentId: string,
    schoolId: string,
    academicYearId: string,
    startDate: string | undefined,
    endDate: string | undefined,
    context: RequestContext,
    studentName: string = ''
  ): Promise<StudentAttendanceSummaryDto> {
    this.logger.debug(`getStudentAttendanceSummary: entry, studentId=${studentId}, schoolId=${schoolId}, academicYearId=${academicYearId}`);
    // Row-level security: check scope (schoolId is always available here)
    if (schoolId) {
      const scope = await this.dataScopeService.resolveScope(context.userId, schoolId, context);
      if (!this.dataScopeService.isStudentInScope(scope, studentId)) {
        // Return empty summary for out-of-scope students (graceful degradation)
        return {
          studentId, studentName, schoolId, academicYearId,
          totalDays: 0, present: 0, absent: 0, late: 0, excused: 0, halfDay: 0,
          attendanceRate: 0, dateRange: { start: startDate ?? '', end: endDate ?? '' },
        };
      }
    }

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
    let remote = 0;

    for (const record of attendanceRecords) {
      switch (record.status) {
        case 'present':
          present++;
          break;
        case 'absent':
          absent++;
          break;
        case 'late':
        case 'tardy':  // Task 1.2: tardy falls through to late
          late++;
          break;
        case 'excused':
          excused++;
          break;
        case 'half_day':
          halfDay++;
          break;
        case 'remote':  // Task 1.2: remote counts as attending
          remote++;
          break;
      }
    }

    // Task 1.2: Include remote in attending count
    const attending = present + late + halfDay + remote;
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
      dateRange: { start: startDate ?? '', end: endDate ?? '' },
    };
  }

  // ============================================
  // Attendance Trend & Alerts
  // ============================================

  /**
   * Get attendance trend (daily summaries) over a date range
   * Task 1.7: Parallelized with bounded concurrency (batches of 10)
   */
  async getAttendanceTrend(
    schoolId: string,
    startDate: string,
    endDate: string,
    context: RequestContext,
    academicYearId?: string,
  ): Promise<DailyAttendanceSummaryDto[]> {
    this.logger.debug(`getAttendanceTrend: entry, schoolId=${schoolId}, startDate=${startDate}, endDate=${endDate}, academicYearId=${academicYearId || 'none'}`);
    const dates: string[] = [];
    const current = new Date(startDate);
    const end = new Date(endDate);

    // Collect all dates (max 90)
    let count = 0;
    while (current <= end && count < 90) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
      count++;
    }

    // Ticket 11: Pre-fetch enrollments once for the entire trend period
    let cachedEnrollments: Enrollment[] | undefined;
    if (academicYearId) {
      try {
        const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
        const enrollmentResult = await this.dynamoDBClient.queryGSI<Enrollment>(
          client,
          'GSI1',
          GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
          `ENROLLMENT#${academicYearId}`,
          'begins_with',
          'entityType = :entityType',
          { ':entityType': 'ENROLLMENT' },
          undefined,
          1000,
        );
        cachedEnrollments = enrollmentResult.items.filter(
          e => e.status === 'enrolled' || e.status === 'active',
        );
      } catch (error) {
        this.logger.warn(`Failed to pre-fetch enrollments for trend: ${error}`);
      }
    }

    // Task 1.7: Process in parallel batches of 10
    const summaries: DailyAttendanceSummaryDto[] = [];
    const BATCH_SIZE = 10;

    for (let i = 0; i < dates.length; i += BATCH_SIZE) {
      const batch = dates.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (dateStr) => {
          try {
            const summary = await this.getDailyAttendanceSummary(schoolId, dateStr, context, academicYearId, cachedEnrollments);
            // Only include days with actual attendance records (filters weekends/holidays/no-data)
            return (summary as any).totalRecorded > 0 ? summary : null;
          } catch (error) {
            this.logger.warn(`Failed to get attendance summary for ${dateStr}: ${error}`);
            return null;
          }
        })
      );
      for (const result of batchResults) {
        if (result) summaries.push(result);
      }
    }

    this.logger.debug(`getAttendanceTrend: completed, ${summaries.length} daily summaries returned`);
    return summaries;
  }

  /**
   * Get students below a given attendance rate threshold
   * Task 1.8: Optimized with batch queries, denormalized names, capped to 20, trend computation
   */
  async getAttendanceAlerts(
    schoolId: string,
    academicYearId: string,
    threshold: number,
    startDate: string,
    endDate: string,
    context: RequestContext,
  ): Promise<{
    alerts: Array<{
      studentId: string;
      studentName: string;
      gradeLevel?: string;
      attendanceRate: number;
      totalDays: number;
      absentDays: number;
      trend: 'improving' | 'declining' | 'stable';
    }>;
    totalAtRiskCount: number;
  }> {
    this.logger.debug(`getAttendanceAlerts: entry, schoolId=${schoolId}, academicYearId=${academicYearId}, threshold=${threshold}, startDate=${startDate}, endDate=${endDate}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Get all enrollments for this school/year to get student list
    const enrollments = await this.dynamoDBClient.queryGSI<Enrollment>(
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

    // Row-level security: filter enrollments by user's data scope
    const scope = await this.dataScopeService.resolveScope(context.userId, schoolId, context);
    const scopedEnrollments = this.dataScopeService.filterByStudentScope(scope, enrollments.items);

    const activeEnrollments = scopedEnrollments.filter(
      e => e.status === 'enrolled' || e.status === 'active',
    );

    // Build grade map from enrollment data
    const studentGradeMap = new Map<string, string>();
    for (const enrollment of activeEnrollments) {
      studentGradeMap.set(enrollment.studentId, enrollment.gradeLevel || 'Unclassified');
    }

    // Resolve student names via cached batch lookup
    const enrolledStudentIds = activeEnrollments.map(e => e.studentId);
    const studentNameMap = await this.resolveStudentNames(client, context.tenantId, enrolledStudentIds);

    // Compute per-student summaries
    const allAlerts: Array<{
      studentId: string;
      studentName: string;
      gradeLevel?: string;
      attendanceRate: number;
      totalDays: number;
      absentDays: number;
      trend: 'improving' | 'declining' | 'stable';
    }> = [];

    // Calculate midpoint for trend computation
    // Ticket 13: Use day before midpoint for first half end to avoid overlap
    const start = new Date(startDate);
    const end = new Date(endDate);
    const midpoint = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);
    const midpointStr = midpoint.toISOString().split('T')[0];
    // First half: startDate..dayBeforeMidpoint, Second half: midpoint..endDate
    const dayBeforeMidpoint = new Date(midpoint);
    dayBeforeMidpoint.setDate(dayBeforeMidpoint.getDate() - 1);
    const firstHalfEnd = dayBeforeMidpoint.toISOString().split('T')[0];

    // Ticket 14: Parallelize with bounded concurrency (batches of 10)
    const ALERT_BATCH_SIZE = 10;
    for (let i = 0; i < activeEnrollments.length; i += ALERT_BATCH_SIZE) {
      const batch = activeEnrollments.slice(i, i + ALERT_BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (enrollment) => {
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
              let trend: 'improving' | 'declining' | 'stable' = 'stable';
              try {
                const [firstHalf, secondHalf] = await Promise.all([
                  this.getStudentAttendanceSummary(
                    enrollment.studentId, schoolId, academicYearId,
                    startDate, firstHalfEnd, context,
                  ),
                  this.getStudentAttendanceSummary(
                    enrollment.studentId, schoolId, academicYearId,
                    midpointStr, endDate, context,
                  ),
                ]);
                if (firstHalf.totalDays >= 5 && secondHalf.totalDays >= 5) {
                  const delta = secondHalf.attendanceRate - firstHalf.attendanceRate;
                  if (delta > 5) trend = 'improving';
                  else if (delta < -5) trend = 'declining';
                }
              } catch {
                // Keep stable if trend computation fails
              }

              return {
                studentId: enrollment.studentId,
                studentName: studentNameMap.get(enrollment.studentId) || 'Unknown Student',
                gradeLevel: studentGradeMap.get(enrollment.studentId),
                attendanceRate: summary.attendanceRate,
                totalDays: summary.totalDays,
                absentDays: summary.absent,
                trend,
              };
            }
            return null;
          } catch {
            return null;
          }
        })
      );
      for (const result of batchResults) {
        if (result) allAlerts.push(result);
      }
    }

    // Sort by attendance rate ascending (worst first)
    allAlerts.sort((a, b) => a.attendanceRate - b.attendanceRate);

    // Task 1.8: Cap to top 20 worst cases
    this.logger.debug(`getAttendanceAlerts: completed, totalAtRisk=${allAlerts.length}, returning top ${Math.min(allAlerts.length, 20)}`);
    return {
      alerts: allAlerts.slice(0, 20),
      totalAtRiskCount: allAlerts.length,
    };
  }

  // ============================================
  // Attendance Overview (Tasks 1.10-1.11)
  // ============================================

  /**
   * Get comprehensive attendance overview for a school
   * Single aggregate endpoint for the dashboard
   */
  async getAttendanceOverview(
    schoolId: string,
    academicYearId: string,
    date: string,
    context: RequestContext,
  ): Promise<any> {
    this.logger.debug(`getAttendanceOverview: entry, schoolId=${schoolId}, academicYearId=${academicYearId}, date=${date}`);
    // Check cache first — include tenantId and userId to prevent cross-tenant/cross-role leakage
    const cacheKey = `${context.tenantId}:${context.userId}:${schoolId}:${date}:${academicYearId}`;
    const cached = this.overviewCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < OVERVIEW_CACHE_TTL_MS) {
      this.logger.debug(`getAttendanceOverview: cache HIT`);
      return cached.data;
    }
    this.logger.debug(`getAttendanceOverview: cache MISS, computing`);

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Resolve data scope for row-level security (Teacher → section-scoped)
    const scope = await this.dataScopeService.resolveScope(context.userId, schoolId, context);

    // Pre-compute date strings
    const thirtyDaysAgo = new Date(date);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

    const ninetyDaysAgo = new Date(date);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const ninetyDaysAgoStr = ninetyDaysAgo.toISOString().split('T')[0];

    // ---- Run 3 independent tracks in parallel ----
    const [trendTrack, sectionCompletion, alertsResult] = await Promise.all([

      // Track A: 30-day trend + academic year avg + today's summary
      (async () => {
        // Pre-fetch academic year info in parallel with trend
        const [trend, academicYear] = await Promise.all([
          this.getAttendanceTrend(schoolId, thirtyDaysAgoStr, date, context, academicYearId),
          this.identityClient.getCurrentAcademicYear(schoolId, context).catch(() => null),
        ]);

        // Extract today's summary from trend data (eliminates redundant query)
        const todaySummary = trend.find(d => d.date === date)
          ?? await this.getDailyAttendanceSummary(schoolId, date, context, academicYearId);

        // Compute period averages
        const last7 = trend.slice(-7);
        const last30 = trend;

        // Ticket 4: Compute academic year average
        let academicYearAvg = 0;
        try {
          if (academicYear?.startDate) {
            const yearStart = new Date(academicYear.startDate);
            if (yearStart < thirtyDaysAgo) {
              const extendedTrend = await this.getAttendanceTrend(
                schoolId, academicYear.startDate, thirtyDaysAgoStr, context, academicYearId,
              );
              const allDays = [...extendedTrend, ...trend];
              academicYearAvg = allDays.length > 0
                ? Math.round(allDays.reduce((sum, d) => sum + d.attendanceRate, 0) / allDays.length * 100) / 100
                : 0;
            } else {
              academicYearAvg = last30.length > 0
                ? Math.round(last30.reduce((sum, d) => sum + d.attendanceRate, 0) / last30.length * 100) / 100
                : 0;
            }
          }
        } catch (error) {
          this.logger.warn(`Failed to compute academic year average: ${error}`);
          academicYearAvg = last30.length > 0
            ? Math.round(last30.reduce((sum, d) => sum + d.attendanceRate, 0) / last30.length * 100) / 100
            : 0;
        }

        const periodAverages = {
          last7Days: last7.length > 0
            ? Math.round(last7.reduce((sum, d) => sum + d.attendanceRate, 0) / last7.length * 100) / 100
            : 0,
          last30Days: last30.length > 0
            ? Math.round(last30.reduce((sum, d) => sum + d.attendanceRate, 0) / last30.length * 100) / 100
            : 0,
          academicYear: academicYearAvg,
        };

        return { trend, todaySummary, periodAverages };
      })(),

      // Track B: Section completion (with batched enrollment queries)
      (async () => {
        const result = {
          totalSections: 0,
          sectionsWithAttendance: 0,
          sections: [] as Array<{
            sectionId: string;
            sectionNumber: string;
            courseName: string;
            studentCount: number;
            recordedCount: number;
            isComplete: boolean;
          }>,
        };

        try {
          // Query sections and today's attendance in parallel
          const [sectionsResult, todayAttendanceResult] = await Promise.all([
            this.dynamoDBClient.queryGSI<CourseSection>(
              client, 'GSI1',
              GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
              'SECTION#', 'begins_with',
              'entityType = :entityType AND isActive = :isActive',
              { ':entityType': 'SECTION', ':isActive': true },
              undefined, 200,
            ),
            this.dynamoDBClient.queryGSI<SchoolAttendance>(
              client, 'GSI3',
              GSIKeyBuilder.attendanceDate(context.tenantId, schoolId, date),
              'SCH_ATTEND#', 'begins_with',
              undefined, undefined, undefined, 1000,
            ),
          ]);

          // Apply section scope filtering (Teacher → only their assigned sections)
          const sections = scope.type === 'section'
            ? sectionsResult.items.filter(s => this.dataScopeService.isSectionInScope(scope, s.sectionId))
            : sectionsResult.items;
          result.totalSections = sections.length;
          const recordedStudentIds = new Set(todayAttendanceResult.items.map(a => a.studentId));

          // Batched enrollment queries (10 at a time instead of sequential)
          const SEC_BATCH_SIZE = 10;
          for (let i = 0; i < sections.length; i += SEC_BATCH_SIZE) {
            const batch = sections.slice(i, i + SEC_BATCH_SIZE);
            const batchResults = await Promise.all(
              batch.map(section =>
                this.dynamoDBClient.queryGSI<SectionEnrollment>(
                  client, 'GSI1',
                  GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
                  `SEC_ENROLL#${section.sectionId}#`, 'begins_with',
                  'isActive = :isActive', { ':isActive': true },
                  undefined, 500,
                ),
              ),
            );

            for (let j = 0; j < batch.length; j++) {
              const secEnrollResult = batchResults[j];
              const studentCount = secEnrollResult.items.length;
              const recordedCount = secEnrollResult.items.filter(e => recordedStudentIds.has(e.studentId)).length;
              const isComplete = studentCount > 0 && recordedCount >= studentCount;
              if (isComplete) result.sectionsWithAttendance++;

              result.sections.push({
                sectionId: batch[j].sectionId,
                sectionNumber: batch[j].sectionNumber,
                courseName: batch[j].courseName || batch[j].courseCode || 'Section',
                studentCount,
                recordedCount,
                isComplete,
              });
            }
          }
        } catch (error) {
          this.logger.warn(`Failed to compute section completion: ${error}`);
        }

        return result;
      })(),

      // Track C: At-risk alerts
      this.getAttendanceAlerts(schoolId, academicYearId, 90, ninetyDaysAgoStr, date, context)
        .catch(error => {
          this.logger.warn(`Failed to compute at-risk students: ${error}`);
          return { alerts: [] as any[], totalAtRiskCount: 0 };
        }),
    ]);

    // Destructure parallel results
    const { trend, todaySummary, periodAverages } = trendTrack;
    const atRiskStudents = alertsResult.alerts;
    const totalAtRiskCount = alertsResult.totalAtRiskCount;

    // 6. Absence breakdown from today's summary (no extra queries)
    const absenceBreakdown = {
      unexcused: todaySummary.absent,
      excused: todaySummary.excused,
      late: todaySummary.late,
      halfDay: todaySummary.halfDay,
      remote: (todaySummary as any).remote || 0,
    };

    // 7. Day-of-week pattern from trend data (pure computation, no queries)
    const dayOfWeekPattern: Record<string, { avgRate: number; avgAbsent: number }> = {};
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayGroups = new Map<string, { rates: number[]; absents: number[] }>();

    for (const dayData of trend) {
      const dayOfWeek = new Date(dayData.date).getDay();
      const dayName = dayNames[dayOfWeek];
      let group = dayGroups.get(dayName);
      if (!group) {
        group = { rates: [], absents: [] };
        dayGroups.set(dayName, group);
      }
      group.rates.push(dayData.attendanceRate);
      group.absents.push(dayData.absent);
    }

    for (const [day, group] of dayGroups) {
      dayOfWeekPattern[day] = {
        avgRate: group.rates.length > 0
          ? Math.round(group.rates.reduce((s, r) => s + r, 0) / group.rates.length * 100) / 100
          : 0,
        avgAbsent: group.absents.length > 0
          ? Math.round(group.absents.reduce((s, a) => s + a, 0) / group.absents.length * 100) / 100
          : 0,
      };
    }

    const overview = {
      todaySummary,
      sectionCompletion,
      trend,
      periodAverages,
      atRiskStudents,
      totalAtRiskCount,
      absenceBreakdown,
      dayOfWeekPattern,
    };

    // Cache the result
    this.overviewCache.set(cacheKey, { data: overview, cachedAt: Date.now() });

    return overview;
  }

  // ============================================
  // Calendar Validation
  // ============================================

  /**
   * Validate that a date is an instructional day for the given school.
   * Uses in-memory cache with 5-minute TTL to reduce cross-service calls.
   * Graceful degradation: if calendar is not configured, attendance is allowed.
   *
   * Sprint C2 PR-B — when a non-instructional day is blocked, throws a
   * structured BadRequestException with `errorCode: DATE_NOT_INSTRUCTIONAL`
   * and a `details` payload carrying { date, reason, description? } so the
   * UI can render a specific reason ("Dashain holiday", "weekend", "Winter
   * Break vacation") instead of a generic 400.
   *
   * Reason taxonomy mirrors @edforge/pilot-fixtures' classification:
   *   holiday | vacation | weekend | break | non_instructional
   * (the last is the fall-through when nothing more specific can be derived
   * from the calendar event types.)
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
    if (!calendarDate.isInstructionalDay) {
      const reason = deriveNonInstructionalReason(calendarDate);
      const description = calendarDate.calendarEvents?.[0]?.description;
      throw new BadRequestException({
        message:
          `Attendance cannot be recorded on a non-instructional day ` +
          `(${date}: ${description || reason}).`,
        errorCode: 'DATE_NOT_INSTRUCTIONAL',
        details: {
          date,
          reason,
          description,
        },
      });
    }
  }

  /**
   * Convert Attendance entity to response DTO using mapper
   */
  private toAttendanceResponse(attendance: SchoolAttendance): AttendanceResponseDto {
    return attendanceEntityToDto(attendance);
  }
}
