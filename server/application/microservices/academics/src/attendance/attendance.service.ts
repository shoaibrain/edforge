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
  ServiceUnavailableException,
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
import { SectionAttendanceTaken, createSectionAttendanceTakenEntity } from '../common/entities/section-attendance-taken.entity';
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
  RecordDailyAttendanceDto,
  RecordDailyAttendanceResponseDto,
  toEdfiAttendanceEvent,
  attendanceRateWeight,
  PLATFORM_ATTENDANCE_COUNTING_POLICY,
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

/**
 * UTC-safe date enumeration. `new Date('YYYY-MM-DD')` parses as UTC midnight;
 * using UTC getters/setters avoids the TZ shift that bites `setDate` on
 * negative-offset hosts (same family as the gregorianToBs C3.7 fix).
 * Returns inclusive [startDate, endDate]. Exported for spec coverage.
 */
export function enumerateDatesUTC(startDate: string, endDate: string): string[] {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return [];
  const out: string[] = [];
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().split('T')[0]);
  }
  return out;
}

export function midpointDateUTC(startDate: string, endDate: string): string {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const mid = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);
  return mid.toISOString().split('T')[0];
}

export function dayBeforeUTC(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0];
}

/**
 * Count "attending" (present + late + tardy + half_day + remote) and absent
 * across a record set. Mirrors the per-record switch in the original
 * `getStudentAttendanceSummary` so semantics are byte-equivalent.
 */
export function countAttendingAbsent(
  records: ReadonlyArray<SchoolAttendance>,
): { attending: number; absent: number } {
  let attending = 0;
  let absent = 0;
  for (const r of records) {
    switch (r.status) {
      case 'present':
      case 'late':
      case 'tardy':
      case 'half_day':
      case 'remote':
        attending++;
        break;
      case 'absent':
        absent++;
        break;
      // 'excused' is neither attending nor absent — same as the old code,
      // which excluded it from both counts.
    }
  }
  return { attending, absent };
}

export function addDaysUTC(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Per-student attendance trend: a RECENT window vs a BASELINE window, both
 * anchored on `endDate`. Replaces the prior "first vs second half of the whole
 * window" split, which over a long (e.g. 90-day) window with sparse pilot data
 * collapsed to `stable` for everyone (either half had < 5 records). Comparing
 * the last `recentDays` against the prior `baselineDays` reflects the student's
 * *current* direction and is robust to sparse history.
 *
 * Gates to `stable` when either window has fewer than `minRecords` records
 * (insufficient signal). Thresholds: Δ(recent − baseline) ≥ +5pp → improving,
 * ≤ −5pp → declining, else stable.
 */
export function computeRecentVsBaselineTrend(
  records: ReadonlyArray<SchoolAttendance>,
  endDate: string,
  opts: { recentDays?: number; baselineDays?: number; minRecords?: number } = {},
): 'improving' | 'declining' | 'stable' {
  const recentDays = opts.recentDays ?? 7;
  const baselineDays = opts.baselineDays ?? 30;
  const minRecords = opts.minRecords ?? 3;

  const recentStart = addDaysUTC(endDate, -(recentDays - 1));
  const baselineEnd = addDaysUTC(recentStart, -1);
  const baselineStart = addDaysUTC(endDate, -(baselineDays - 1));

  const recent = records.filter((r) => r.date >= recentStart && r.date <= endDate);
  const baseline = records.filter((r) => r.date >= baselineStart && r.date <= baselineEnd);
  if (recent.length < minRecords || baseline.length < minRecords) return 'stable';

  const recentRate = (countAttendingAbsent(recent).attending / recent.length) * 100;
  const baselineRate = (countAttendingAbsent(baseline).attending / baseline.length) * 100;
  const delta = recentRate - baselineRate;
  if (delta >= 5) return 'improving';
  if (delta <= -5) return 'declining';
  return 'stable';
}

/**
 * Per-student trend payload for the roster sparkline (Sprint 2). Pure transform
 * over a single student's window records: aggregate rate (attending / records),
 * chronological per-date daily-rate series, direction trend, and totals.
 */
export function computeStudentTrendFromRecords(
  records: ReadonlyArray<SchoolAttendance>,
  endDate: string,
): { rate: number; series: number[]; trend: 'improving' | 'declining' | 'stable'; totalDays: number; absentDays: number } {
  const stats = countAttendingAbsent(records);
  const rate = records.length === 0 ? 0 : Math.round((stats.attending / records.length) * 100 * 100) / 100;

  const byDate = new Map<string, SchoolAttendance[]>();
  for (const r of records) {
    let arr = byDate.get(r.date);
    if (!arr) { arr = []; byDate.set(r.date, arr); }
    arr.push(r);
  }
  const series = [...byDate.keys()].sort().map((d) => {
    const dayRecs = byDate.get(d)!;
    return Math.round((countAttendingAbsent(dayRecs).attending / dayRecs.length) * 100);
  });

  return {
    rate,
    series,
    trend: computeRecentVsBaselineTrend(records, endDate),
    totalDays: records.length,
    absentDays: stats.absent,
  };
}

/**
 * Sprint 1 / S1.T5 — structured recording-coverage telemetry.
 *
 * Emits one parseable line per daily summary so a CloudWatch metric filter can
 * track `attendance.coverage = recorded ÷ enrolled`. Low coverage (only a
 * fraction of enrolled students recorded on a day) is the root cause of the
 * misleading ~16% dashboard rate today; making it observable lets us prove the
 * daily roll-call workflow (Sprint 4) closes the gap. `enrolled` is the same
 * denominator the rate uses, so coverage is the share of that denominator that
 * actually has a record.
 */
export function formatAttendanceCoverageMetric(args: {
  schoolId: string;
  date: string;
  recorded: number;
  enrolled: number;
  attendanceRate: number;
}): string {
  const { schoolId, date, recorded, enrolled, attendanceRate } = args;
  const coveragePct = enrolled > 0
    ? Math.round((recorded / enrolled) * 100 * 100) / 100
    : 0;
  return `metric=attendance.coverage schoolId=${schoolId} date=${date} recorded=${recorded} enrolled=${enrolled} coveragePct=${coveragePct} attendanceRatePct=${attendanceRate}`;
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
   * Record a homeroom's DAILY roll-call (Sprint 4 / S4.T1).
   *
   * Roster-scoped to a homeroom Section: every active SectionEnrollment student
   * gets an authoritative SCH_ATTEND row (derivedFrom:'direct') for the date —
   * marked students take the supplied status, every unmarked student defaults to
   * present (the "absentees-only" fast path). Ed-Fi descriptors + eventDuration
   * are populated from the shared toEdfiAttendanceEvent projection. Idempotent:
   * re-saving the same marks is a no-op per student.
   */
  async recordDailyAttendance(
    dto: RecordDailyAttendanceDto,
    context: RequestContext,
  ): Promise<RecordDailyAttendanceResponseDto> {
    this.logger.debug(`recordDailyAttendance: homeroom=${dto.homeroomSectionId}, date=${dto.date}, marks=${dto.marks.length}`);

    // No attendance on non-instructional days (calendar-aware).
    await this.validateInstructionalDay(dto.schoolId, dto.date, context);

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // The target section must be a homeroom — daily roll-call is homeroom-scoped.
    const section = await this.dynamoDBClient.getItem<CourseSection>(
      client,
      context.tenantId,
      EntityKeyBuilder.section(dto.schoolId, dto.homeroomSectionId),
    );
    if (!section) {
      throw new NotFoundException(`Section ${dto.homeroomSectionId} not found`);
    }
    if (section.sectionType !== 'homeroom') {
      throw new BadRequestException(
        `Section ${dto.homeroomSectionId} is not a homeroom; daily roll-call is homeroom-scoped`,
      );
    }

    // Write authorization: the user must have write access to this homeroom.
    const scope = await this.dataScopeService.resolveScope(context.userId, dto.schoolId, context);
    if (!this.dataScopeService.isSectionInScope(scope, dto.homeroomSectionId)) {
      throw new ForbiddenException('You do not have access to record attendance for this homeroom');
    }

    // Roster = active SectionEnrollment rows for the homeroom (what the UI lists).
    const rosterResult = await this.dynamoDBClient.queryGSI<SectionEnrollment>(
      client,
      'GSI1',
      GSIKeyBuilder.schoolScope(context.tenantId, dto.schoolId),
      `SEC_ENROLL#${dto.homeroomSectionId}#`,
      'begins_with',
      'isActive = :isActive',
      { ':isActive': true },
      undefined,
      500,
    );
    const roster = rosterResult.items;
    if (roster.length === 0) {
      throw new BadRequestException(`Homeroom ${dto.homeroomSectionId} has no enrolled students`);
    }

    const markByStudent = new Map(dto.marks.map(m => [m.studentId, m]));
    const nameByStudent = new Map<string, string>();
    for (const r of roster) if (r.studentName) nameByStudent.set(r.studentId, r.studentName);

    const now = new Date().toISOString();

    // Batch existence check for idempotent re-save (skip unchanged rows).
    const existingKeys = roster.map(r => ({
      tenantId: context.tenantId,
      entityKey: EntityKeyBuilder.schoolAttendance(dto.date, r.studentId),
    }));
    let existing: SchoolAttendance[];
    try {
      existing = await this.dynamoDBClient.batchGetItems<SchoolAttendance>(client, existingKeys);
    } catch (err) {
      // Fail closed: without prior state we cannot honor the S4.T3 no-clobber
      // guarantee. Degrading would default-present every unmarked student via an
      // unconditional putItem and silently overwrite a manual mark, so abort with
      // a retryable error instead of writing destructively.
      this.logger.error(`recordDailyAttendance: existence check failed; aborting to avoid clobbering manual marks: ${err}`);
      throw new ServiceUnavailableException('Could not read existing attendance; please retry');
    }
    const existingByStudent = new Map(existing.map(a => [a.studentId, a]));

    let marked = 0;
    let defaultedPresent = 0;
    let recordsWritten = 0;

    for (const r of roster) {
      const studentId = r.studentId;
      const mark = markByStudent.get(studentId);
      const prior = existingByStudent.get(studentId);

      // S4.T3 (don't clobber): an unmarked student who already has a record keeps
      // it — a prior/manual mark is never overwritten by the default-present
      // expansion. Only explicitly-marked students and brand-new (roster-added)
      // students are written; removed students aren't iterated, so their record
      // is untouched too.
      if (!mark && prior) {
        continue;
      }

      const status = mark?.status ?? 'present';
      if (mark) marked++; else defaultedPresent++;

      const edfi = toEdfiAttendanceEvent(status);
      const note = mark?.notes;
      const checkInTime = mark?.checkInTime;
      const studentName = nameByStudent.get(studentId);

      if (prior) {
        // No-op when this authoritative record already matches. checkInTime is
        // part of the comparison because the update path writes it — omitting it
        // would silently drop a re-save that only corrects the check-in time.
        if (prior.status === status &&
            prior.derivedFrom === 'direct' &&
            (prior.note || null) === (note || null) &&
            (prior.checkInTime || null) === (checkInTime || null) &&
            (prior.eventDuration ?? null) === edfi.eventDuration) {
          continue;
        }
        await this.dynamoDBClient.updateItem(
          client,
          context.tenantId,
          EntityKeyBuilder.schoolAttendance(dto.date, studentId),
          'SET #status = :status, derivedFrom = :direct, attendanceEventCategory = :cat, eventDuration = :dur, note = :note, checkInTime = :checkIn, studentName = :name, academicYearId = :ay, updatedAt = :now, updatedBy = :uid, #version = if_not_exists(#version, :zero) + :inc',
          {
            ':status': status,
            ':direct': 'direct',
            ':cat': edfi.attendanceEventCategory,
            ':dur': edfi.eventDuration,
            ':note': note || null,
            ':checkIn': checkInTime || null,
            ':name': studentName,
            ':ay': dto.academicYearId,
            ':now': now,
            ':uid': context.userId,
            ':inc': 1,
            ':zero': 0,
          },
          undefined,
          { '#status': 'status', '#version': 'version' },
        );
        recordsWritten++;
      } else {
        const attendance = createSchoolAttendanceEntity(
          context.tenantId,
          uuid(),
          studentId,
          dto.schoolId,
          dto.date,
          {
            academicYearId: dto.academicYearId,
            status,
            studentName,
            attendanceEventCategory: edfi.attendanceEventCategory,
            eventDuration: edfi.eventDuration,
            note,
            checkInTime,
            recordedBy: context.userId,
            createdAt: now,
            createdBy: context.userId,
            updatedAt: now,
            updatedBy: context.userId,
            version: 1,
          },
        );
        await this.dynamoDBClient.putItem(client, attendance);
        recordsWritten++;
      }
    }

    // S4.T2 — mark the homeroom's daily attendance as "taken" (Ed-Fi
    // SectionAttendanceTakenEvent), keyed to the homeroom section. Idempotent upsert.
    const takenKey = EntityKeyBuilder.sectionAttendanceTaken(dto.date, dto.homeroomSectionId);
    const existingTaken = await this.dynamoDBClient.getItem<SectionAttendanceTaken>(client, context.tenantId, takenKey);
    if (existingTaken) {
      await this.dynamoDBClient.updateItem(
        client,
        context.tenantId,
        takenKey,
        'SET studentsRecorded = :n, totalStudents = :n, takenBy = :uid, takenAt = :now, updatedAt = :now, updatedBy = :uid, #version = if_not_exists(#version, :zero) + :inc',
        { ':n': roster.length, ':uid': context.userId, ':now': now, ':inc': 1, ':zero': 0 },
        undefined,
        { '#version': 'version' },
      );
    } else {
      await this.dynamoDBClient.putItem(client, createSectionAttendanceTakenEntity(
        context.tenantId,
        dto.homeroomSectionId,
        dto.schoolId,
        dto.date,
        {
          sectionNumber: section.sectionNumber,
          totalStudents: roster.length,
          studentsRecorded: roster.length,
          takenBy: context.userId,
          takenAt: now,
          createdAt: now,
          createdBy: context.userId,
          updatedAt: now,
          updatedBy: context.userId,
          version: 1,
        },
      ));
    }

    this.logger.log(`Daily roll-call: homeroom ${dto.homeroomSectionId} ${dto.date} — roster=${roster.length}, marked=${marked}, default-present=${defaultedPresent}, written=${recordsWritten}`);

    return {
      success: true,
      schoolId: dto.schoolId,
      homeroomSectionId: dto.homeroomSectionId,
      date: dto.date,
      rosterSize: roster.length,
      marked,
      defaultedPresent,
      recordsWritten,
    };
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

    // S4.T5: rate numerator is policy-weighted (half_day=0.5, excused per the
    // policy's excusedTreatment) via the single shared `attendanceRateWeight`
    // helper, rather than counting every "attending" bucket as a whole day.
    let attendingWeight = 0;

    for (const attendance of scopedAttendance) {
      attendingWeight += attendanceRateWeight(attendance.status, PLATFORM_ATTENDANCE_COUNTING_POLICY);

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
    // S4.T5: rate numerator is the policy-weighted attending total (half_day=0.5,
    // excused per excusedTreatment); denominator stays the enrolled count so a
    // partial-day student is "half present" against a full expected day.
    summary.attendanceRate = totalStudents > 0
      ? Math.round((attendingWeight / totalStudents) * 100 * 100) / 100
      : 0;

    // S4.T5: surface recording coverage (recorded ÷ enrolled) in the response —
    // the same denominator the rate uses — so the UI can distinguish a low rate
    // caused by sparse recording from one caused by genuine absence.
    summary.coveragePct = totalStudents > 0
      ? Math.round((scopedAttendance.length / totalStudents) * 100 * 100) / 100
      : 0;

    // S1.T5: structured coverage telemetry (recorded ÷ enrolled) so a metric
    // filter can surface recording sparsity — the root cause of the low rate.
    this.logger.log(formatAttendanceCoverageMetric({
      schoolId,
      date,
      recorded: scopedAttendance.length,
      enrolled: totalStudents,
      attendanceRate: summary.attendanceRate,
    }));

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
   * Get students below a given attendance rate threshold.
   *
   * C3.1 phase 2: bulk-scan rewrite. Was N-student × up to 3 DDB queries
   * (one summary + two trend halves per breaching student). Now one
   * GSI3 query per date in range (parallel, batched 10) + in-memory
   * group-by-student + in-memory trend on top-20 (zero extra queries).
   *
   * Old: ~1,092 DDB queries / request at pilot scale (780 students, 20% breach)
   * New: ~6–9 sequential batches of GSI3 queries (one per date) ≈ 60 queries
   *      for a 60-day window, no per-student fan-out.
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

    // 1. Enrollment list (one GSI1 query) + scope + name/grade resolution
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

    const scope = await this.dataScopeService.resolveScope(context.userId, schoolId, context);
    const scopedEnrollments = this.dataScopeService.filterByStudentScope(scope, enrollments.items);
    const activeEnrollments = scopedEnrollments.filter(
      e => e.status === 'enrolled' || e.status === 'active',
    );

    if (activeEnrollments.length === 0) {
      this.logger.debug('getAttendanceAlerts: no active enrollments in scope — returning empty');
      return { alerts: [], totalAtRiskCount: 0 };
    }

    const enrolledStudentIds = new Set(activeEnrollments.map(e => e.studentId));
    const studentGradeMap = new Map<string, string>();
    for (const enrollment of activeEnrollments) {
      studentGradeMap.set(enrollment.studentId, enrollment.gradeLevel || 'Unclassified');
    }
    const studentNameMap = await this.resolveStudentNames(
      client, context.tenantId, [...enrolledStudentIds],
    );

    // 2. Bulk attendance fetch — one GSI3 query per date, parallel batches of 10
    const dates = enumerateDatesUTC(startDate, endDate);
    const FETCH_BATCH_SIZE = 10;
    const allRecords: SchoolAttendance[] = [];

    for (let i = 0; i < dates.length; i += FETCH_BATCH_SIZE) {
      const batch = dates.slice(i, i + FETCH_BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (date) => {
          try {
            const r = await this.dynamoDBClient.queryGSI<SchoolAttendance>(
              client,
              'GSI3',
              GSIKeyBuilder.attendanceDate(context.tenantId, schoolId, date),
              'SCH_ATTEND#',
              'begins_with',
              undefined,
              undefined,
              undefined,
              1000,
            );
            return r.items;
          } catch (err) {
            this.logger.warn(`getAttendanceAlerts: GSI3 query failed for date=${date}: ${err}`);
            return [];
          }
        }),
      );
      for (const items of batchResults) allRecords.push(...items);
    }

    // Apply scope by intersecting with the (already-scoped) enrollment set
    const scopedRecords = allRecords.filter(r => enrolledStudentIds.has(r.studentId));

    // 3. Group records by studentId
    const recordsByStudent = new Map<string, SchoolAttendance[]>();
    for (const r of scopedRecords) {
      let arr = recordsByStudent.get(r.studentId);
      if (!arr) { arr = []; recordsByStudent.set(r.studentId, arr); }
      arr.push(r);
    }

    // 4. Per-student rate; keep only the breaching ones
    type Breaching = {
      studentId: string;
      attendanceRate: number;
      totalDays: number;
      absentDays: number;
      records: SchoolAttendance[];
    };
    const breaching: Breaching[] = [];
    for (const enrollment of activeEnrollments) {
      const recs = recordsByStudent.get(enrollment.studentId);
      if (!recs || recs.length === 0) continue; // no data: skip (mirrors old behavior)
      const stats = countAttendingAbsent(recs);
      const attendanceRate =
        Math.round((stats.attending / recs.length) * 100 * 100) / 100;
      if (attendanceRate < threshold) {
        breaching.push({
          studentId: enrollment.studentId,
          attendanceRate,
          totalDays: recs.length,
          absentDays: stats.absent,
          records: recs,
        });
      }
    }

    // 5. Sort ascending by rate (worst first), slice top-20
    breaching.sort((a, b) => a.attendanceRate - b.attendanceRate);
    const top = breaching.slice(0, 20);

    // 6. Trend per top-20 entry, computed from records already in memory (no DDB):
    // recent (last 7 days) vs baseline (prior ~30) anchored on endDate.
    const alerts = top.map((b) => ({
      studentId: b.studentId,
      studentName: studentNameMap.get(b.studentId) || 'Unknown Student',
      gradeLevel: studentGradeMap.get(b.studentId),
      attendanceRate: b.attendanceRate,
      totalDays: b.totalDays,
      absentDays: b.absentDays,
      trend: computeRecentVsBaselineTrend(b.records, endDate),
    }));

    this.logger.debug(
      `getAttendanceAlerts(bulk): days=${dates.length}, records=${scopedRecords.length}, ` +
      `breaching=${breaching.length}, returning=${alerts.length}`,
    );

    return { alerts, totalAtRiskCount: breaching.length };
  }

  /**
   * Batch per-student attendance trend for the roster sparkline (Sprint 2).
   *
   * One bulk fetch over the window (GSI3 per date, scope-filtered) → per-student
   * daily-rate series + aggregate rate + trend. Bounded to ≤50 studentIds so a
   * single page of the roster resolves in one request (no N+1). Mirrors the
   * getAttendanceAlerts fetch pattern; students with no records in the window
   * are simply absent from the result.
   */
  async getStudentTrends(
    schoolId: string,
    studentIds: string[],
    startDate: string,
    endDate: string,
    context: RequestContext,
  ): Promise<{
    trends: Record<
      string,
      {
        rate: number;
        series: number[];
        trend: 'improving' | 'declining' | 'stable';
        totalDays: number;
        absentDays: number;
      }
    >;
  }> {
    const requested = [...new Set(studentIds)].filter(Boolean).slice(0, 50);
    if (requested.length === 0 || !startDate || !endDate) {
      return { trends: {} };
    }
    const requestedSet = new Set(requested);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Bulk attendance fetch — one GSI3 query per date, parallel batches of 10.
    const dates = enumerateDatesUTC(startDate, endDate);
    const FETCH_BATCH_SIZE = 10;
    const allRecords: SchoolAttendance[] = [];
    for (let i = 0; i < dates.length; i += FETCH_BATCH_SIZE) {
      const batch = dates.slice(i, i + FETCH_BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (date) => {
          try {
            const r = await this.dynamoDBClient.queryGSI<SchoolAttendance>(
              client,
              'GSI3',
              GSIKeyBuilder.attendanceDate(context.tenantId, schoolId, date),
              'SCH_ATTEND#',
              'begins_with',
              undefined,
              undefined,
              undefined,
              1000,
            );
            return r.items;
          } catch (err) {
            this.logger.warn(`getStudentTrends: GSI3 query failed for date=${date}: ${err}`);
            return [];
          }
        }),
      );
      for (const items of batchResults) allRecords.push(...items);
    }

    // Row-level security: restrict to students the caller may see, then to the
    // requested page.
    const scope = await this.dataScopeService.resolveScope(context.userId, schoolId, context);
    const scopedRecords = this.dataScopeService.filterByStudentScope(scope, allRecords);
    const relevant = scopedRecords.filter((r) => requestedSet.has(r.studentId));

    const byStudent = new Map<string, SchoolAttendance[]>();
    for (const r of relevant) {
      let arr = byStudent.get(r.studentId);
      if (!arr) {
        arr = [];
        byStudent.set(r.studentId, arr);
      }
      arr.push(r);
    }

    const trends: Record<
      string,
      { rate: number; series: number[]; trend: 'improving' | 'declining' | 'stable'; totalDays: number; absentDays: number }
    > = {};
    for (const [studentId, recs] of byStudent) {
      if (recs.length === 0) continue;
      trends[studentId] = computeStudentTrendFromRecords(recs, endDate);
    }

    this.logger.debug(
      `getStudentTrends: requested=${requested.length}, days=${dates.length}, records=${relevant.length}, withData=${Object.keys(trends).length}`,
    );
    return { trends };
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
