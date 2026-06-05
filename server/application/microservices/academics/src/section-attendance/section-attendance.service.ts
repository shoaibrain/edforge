/**
 * Section Attendance Service (Ed-Fi: StudentSectionAttendanceEvent)
 *
 * Manages per-section attendance records. Each student gets one record
 * per section per date, keyed by SEC_ATTEND#{date}#{sectionId}#{studentId}.
 *
 * This is the primary attendance entry point for teachers — school-level
 * attendance is derived from section records (Sprint 2).
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
  SectionAttendance,
  createSectionAttendanceEntity,
} from '../common/entities/section-attendance.entity';
import { CourseSection } from '../common/entities/course.entity';
import { Student } from '../common/entities/student.entity';
import {
  EntityKeyBuilder,
  GSIKeyBuilder,
  RequestContext,
  PaginatedResult,
} from '../common/entities/base.entity';
import {
  CreateSectionAttendanceDto,
  BulkSectionAttendanceDto,
  UpdateSectionAttendanceDto,
  SectionAttendanceResponseDto,
  BulkSectionAttendanceResponseDto,
} from '@aibrains/shared-types';
import {
  sectionAttendanceEntityToDto,
  createBulkSectionAttendanceResponse,
} from '../common/mappers/section-attendance.mapper';
import { populateEdFiDescriptors } from '../common/mappers/edfi-attendance-descriptors';
import {
  SectionAttendanceTaken,
  createSectionAttendanceTakenEntity,
} from '../common/entities/section-attendance-taken.entity';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { IdentityClientService, CalendarDateResponse } from '../common/services/identity-client.service';
import { SchoolAttendancDerivationService } from '../common/services/school-attendance-derivation.service';

// In-memory caches
interface CalendarCacheEntry {
  data: CalendarDateResponse | null;
  cachedAt: number;
}
interface StudentNameCacheEntry {
  name: string;
  cachedAt: number;
}

const CALENDAR_CACHE_TTL_MS = 5 * 60 * 1000;
const STUDENT_NAME_CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class SectionAttendanceService {
  private readonly logger = new Logger(SectionAttendanceService.name);
  private readonly calendarCache = new Map<string, CalendarCacheEntry>();
  private readonly studentNameCache = new Map<string, StudentNameCacheEntry>();

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: AcademicsEventsService,
    private readonly identityClient: IdentityClientService,
    private readonly dataScopeService: DataScopeService,
    private readonly derivationService: SchoolAttendancDerivationService,
  ) {}

  // ============================================================================
  // RECORD SINGLE SECTION ATTENDANCE
  // ============================================================================

  async recordSectionAttendance(
    dto: CreateSectionAttendanceDto,
    context: RequestContext,
  ): Promise<SectionAttendanceResponseDto> {
    this.logger.debug(`recordSectionAttendance: entry, sectionId=${dto.sectionId}, studentId=${dto.studentId}, schoolId=${dto.schoolId}, date=${dto.date}, status=${dto.status}`);
    await this.validateInstructionalDay(dto.schoolId, dto.date, context);

    const scope = await this.dataScopeService.resolveScope(context.userId, dto.schoolId, context);
    if (!this.dataScopeService.isStudentInScope(scope, dto.studentId)) {
      throw new ForbiddenException('You do not have access to record attendance for this student');
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const now = new Date().toISOString();

    // Check if record already exists for this student+section+date
    const existing = await this.dynamoDBClient.getItem<SectionAttendance>(
      client,
      context.tenantId,
      EntityKeyBuilder.sectionAttendance(dto.date, dto.sectionId, dto.studentId),
    );

    if (existing) {
      this.logger.debug(`recordSectionAttendance: existing record found, delegating to update`);
      return this.updateSectionAttendance(
        dto.date, dto.sectionId, dto.studentId,
        { status: dto.status, notes: dto.notes, excuseReason: dto.excuseReason },
        context,
      );
    }

    // Resolve student name and course name
    const nameMap = await this.resolveStudentNames(client, context.tenantId, [dto.studentId]);
    const studentName = nameMap.get(dto.studentId);
    const courseName = await this.resolveCourseName(client, context.tenantId, dto.schoolId, dto.sectionId);

    const entity = createSectionAttendanceEntity(
      context.tenantId,
      uuid(),
      dto.studentId,
      dto.schoolId,
      dto.sectionId,
      dto.date,
      {
        status: dto.status,
        studentName,
        courseName,
        academicYearId: dto.academicYearId || '',
        checkInTime: dto.checkInTime,
        checkOutTime: dto.checkOutTime,
        sectionAttendanceDuration: dto.durationMinutes,
        note: dto.notes,
        reason: dto.excuseReason,
        ...populateEdFiDescriptors(dto.status, dto.excuseReason),
        parentNotified: dto.parentNotified,
        parentNotifiedAt: dto.parentNotifiedAt,
        recordedBy: context.userId,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      },
    );

    await this.dynamoDBClient.putItem(client, entity);

    this.eventsService.publishSectionAttendanceRecorded(
      context.tenantId, dto.sectionId, dto.studentId,
      dto.schoolId, dto.date, dto.status,
    ).catch(err => this.logger.error('Failed to publish SectionAttendanceRecorded event', err));

    // Derive school-level attendance (fire-and-forget)
    this.derivationService.deriveSchoolAttendance(
      context.tenantId, dto.studentId, dto.schoolId,
      dto.date, context.jwtToken, context.userId,
    ).catch(err => this.logger.error('Failed to derive school attendance', err));

    this.logger.debug(`recordSectionAttendance: created new record for studentId=${dto.studentId}, sectionId=${dto.sectionId}`);
    return sectionAttendanceEntityToDto(entity);
  }

  // ============================================================================
  // RECORD BULK SECTION ATTENDANCE
  // ============================================================================

  async recordBulkSectionAttendance(
    bulkDto: BulkSectionAttendanceDto,
    context: RequestContext,
  ): Promise<BulkSectionAttendanceResponseDto> {
    this.logger.debug(`recordBulkSectionAttendance: entry, sectionId=${bulkDto.sectionId}, schoolId=${bulkDto.schoolId}, date=${bulkDto.date}, batchSize=${bulkDto.records.length}`);
    if (!bulkDto.sectionId) {
      throw new BadRequestException('sectionId is required for section attendance');
    }

    await this.validateInstructionalDay(bulkDto.schoolId, bulkDto.date, context);

    // Validate all students in data scope
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

    // Resolve courseName from CourseSection
    const courseName = await this.resolveCourseName(client, context.tenantId, bulkDto.schoolId, bulkDto.sectionId);

    const results = {
      created: 0,
      updated: 0,
      errors: [] as Array<{ studentId: string; error: string }>,
    };

    // Resolve student names
    const studentIds = bulkDto.records.map(r => r.studentId);
    const dtoNameMap = new Map<string, string>();
    for (const r of bulkDto.records) {
      if (r.studentName) dtoNameMap.set(r.studentId, r.studentName);
    }
    const idsNeedingLookup = studentIds.filter(id => !dtoNameMap.has(id));
    const resolvedNames = idsNeedingLookup.length > 0
      ? await this.resolveStudentNames(client, context.tenantId, idsNeedingLookup)
      : new Map<string, string>();
    const studentNameMap = new Map([...resolvedNames, ...dtoNameMap]);

    // Batch existence check — keys include sectionId so records are section-scoped
    const existingKeys = bulkDto.records.map(r => ({
      tenantId: context.tenantId,
      entityKey: EntityKeyBuilder.sectionAttendance(bulkDto.date, bulkDto.sectionId, r.studentId),
    }));
    let existingRecords: SectionAttendance[] = [];
    try {
      existingRecords = await this.dynamoDBClient.batchGetItems<SectionAttendance>(client, existingKeys);
    } catch (error) {
      this.logger.warn(`Batch existence check failed, falling back to individual creates: ${error}`);
    }
    const existingMap = new Map<string, SectionAttendance>();
    for (const a of existingRecords) {
      existingMap.set(a.studentId, a);
    }

    for (const record of bulkDto.records) {
      try {
        const resolvedName = studentNameMap.get(record.studentId);
        const existing = existingMap.get(record.studentId);

        // Sprint 1.2–1.4 — normalized attendance reason for this record. Prefer
        // the free-text excuseReason, fall back to the enum excuseType. This is
        // what gets persisted AND what the Ed-Fi descriptors derive from — NOT
        // `notes`, which the bulk path previously mis-used.
        const reason = record.excuseReason ?? record.excuseType;

        if (existing) {
          // No-op detection: skip if nothing changed (don't count as updated).
          // Reason is part of the record's identity — a reason-only edit IS a change.
          if (
            existing.status === record.status &&
            (existing.note || null) === (record.notes || null) &&
            (existing.checkInTime || null) === (record.checkInTime || null) &&
            (existing.reason || null) === (reason || null)
          ) {
            continue;
          }

          // Update existing section attendance record (re-derive Ed-Fi descriptors
          // from the reason, not the free-text note).
          const edfi = populateEdFiDescriptors(record.status, reason);
          const updateExpr =
            'SET #status = :status, checkInTime = :checkInTime, note = :note, reason = :reason, ' +
            'studentName = :studentName, updatedAt = :updatedAt, updatedBy = :updatedBy, ' +
            'attendanceEventCategory = :aec, educationalEnvironment = :ee, attendanceEventReason = :aer, ' +
            '#version = if_not_exists(#version, :zero) + :inc';
          const updateValues: Record<string, any> = {
            ':status': record.status,
            ':checkInTime': record.checkInTime || null,
            ':note': record.notes || null,
            ':reason': reason || null,
            ':studentName': resolvedName,
            ':updatedAt': now,
            ':updatedBy': context.userId,
            ':aec': edfi.attendanceEventCategory,
            ':ee': edfi.educationalEnvironment,
            ':aer': edfi.attendanceEventReason || null,
            ':inc': 1,
            ':zero': 0,
          };

          await this.dynamoDBClient.updateItem(
            client,
            context.tenantId,
            EntityKeyBuilder.sectionAttendance(bulkDto.date, bulkDto.sectionId, record.studentId),
            updateExpr,
            updateValues,
            undefined,
            { '#status': 'status', '#version': 'version' },
          );
          results.updated++;
        } else {
          // Create new record with TOCTOU protection
          const entity = createSectionAttendanceEntity(
            context.tenantId,
            uuid(),
            record.studentId,
            bulkDto.schoolId,
            bulkDto.sectionId,
            bulkDto.date,
            {
              status: record.status,
              studentName: resolvedName,
              courseName,
              academicYearId: bulkDto.academicYearId || '',
              checkInTime: record.checkInTime,
              note: record.notes,
              reason,
              ...populateEdFiDescriptors(record.status, reason),
              recordedBy: context.userId,
              createdAt: now,
              createdBy: context.userId,
              updatedAt: now,
              updatedBy: context.userId,
              version: 1,
            },
          );

          try {
            await this.dynamoDBClient.putItem(client, entity, 'attribute_not_exists(entityKey)');
            results.created++;
          } catch (putError: any) {
            if (putError.name === 'ConditionalCheckFailedException') {
              // Concurrent create — fall through to update
              this.logger.debug(`Concurrent create for student ${record.studentId} in section ${bulkDto.sectionId}, updating`);
              const fallbackEdfi = populateEdFiDescriptors(record.status, reason);
              const fallbackUpdateExpr =
                'SET #status = :status, checkInTime = :checkInTime, note = :note, reason = :reason, ' +
                'studentName = :studentName, updatedAt = :updatedAt, updatedBy = :updatedBy, ' +
                'attendanceEventCategory = :aec, educationalEnvironment = :ee, attendanceEventReason = :aer, ' +
                '#version = if_not_exists(#version, :zero) + :inc';
              await this.dynamoDBClient.updateItem(
                client,
                context.tenantId,
                EntityKeyBuilder.sectionAttendance(bulkDto.date, bulkDto.sectionId, record.studentId),
                fallbackUpdateExpr,
                {
                  ':status': record.status,
                  ':checkInTime': record.checkInTime || null,
                  ':note': record.notes || null,
                  ':reason': reason || null,
                  ':studentName': resolvedName,
                  ':updatedAt': now,
                  ':updatedBy': context.userId,
                  ':aec': fallbackEdfi.attendanceEventCategory,
                  ':ee': fallbackEdfi.educationalEnvironment,
                  ':aer': fallbackEdfi.attendanceEventReason || null,
                  ':inc': 1,
                  ':zero': 0,
                },
                undefined,
                { '#status': 'status', '#version': 'version' },
              );
              results.updated++;
            } else {
              throw putError;
            }
          }
        }
      } catch (error: any) {
        this.logger.error(`Error recording attendance for student ${record.studentId}: ${error.message}`);
        results.errors.push({ studentId: record.studentId, error: error.message });
      }
    }

    // Publish event (non-blocking)
    const presentCount = bulkDto.records.filter(r =>
      ['present', 'late', 'remote'].includes(r.status),
    ).length;
    const absentCount = bulkDto.records.filter(r => r.status === 'absent').length;

    this.eventsService.publishBulkSectionAttendanceRecorded(
      context.tenantId, bulkDto.sectionId, bulkDto.schoolId, bulkDto.date,
      results.created + results.updated, presentCount, absentCount,
    ).catch(err => this.logger.error('Failed to publish BulkSectionAttendanceRecorded event', err));

    // Derive school-level attendance for all processed students (fire-and-forget)
    const processedStudentIds = bulkDto.records
      .filter(r => !results.errors.find(e => e.studentId === r.studentId))
      .map(r => r.studentId);
    for (const sid of processedStudentIds) {
      this.derivationService.deriveSchoolAttendance(
        context.tenantId, sid, bulkDto.schoolId,
        bulkDto.date, context.jwtToken, context.userId,
      ).catch(err => this.logger.error(`Failed to derive school attendance for ${sid}`, err));
    }

    // Record attendance-taken marker (Ed-Fi: SectionAttendanceTakenEvent)
    this.recordAttendanceTaken(
      client, context.tenantId, bulkDto.sectionId, bulkDto.schoolId,
      bulkDto.date, bulkDto.records.length,
      results.created + results.updated, context.userId, now,
    ).catch(err => this.logger.error('Failed to record attendance-taken marker', err));

    this.logger.debug(`recordBulkSectionAttendance: completed, created=${results.created}, updated=${results.updated}, errors=${results.errors.length}`);
    return createBulkSectionAttendanceResponse(
      bulkDto.date, bulkDto.schoolId, bulkDto.sectionId, results,
    );
  }

  // ============================================================================
  // QUERY SECTION ATTENDANCE BY DATE
  // ============================================================================

  async getSectionAttendanceByDate(
    sectionId: string,
    schoolId: string,
    date: string,
    context: RequestContext,
    limit = 100,
  ): Promise<PaginatedResult<SectionAttendanceResponseDto>> {
    this.logger.debug(`getSectionAttendanceByDate: entry, sectionId=${sectionId}, schoolId=${schoolId}, date=${date}, limit=${limit}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const result = await this.dynamoDBClient.queryGSI3<SectionAttendance>(
      client,
      GSIKeyBuilder.attendanceDate(context.tenantId, schoolId, date),
      `SEC_ATTEND#${sectionId}#`,
      'begins_with',
      limit,
    );

    // Data scope filter
    const scope = await this.dataScopeService.resolveScope(context.userId, schoolId, context);
    const filtered = result.items.filter(
      item => this.dataScopeService.isStudentInScope(scope, item.studentId),
    );

    this.logger.debug(`getSectionAttendanceByDate: found ${result.items.length} records, ${filtered.length} after scope filter`);
    return {
      items: filtered.map(entity => sectionAttendanceEntityToDto(entity)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  // ============================================================================
  // UPDATE SECTION ATTENDANCE
  // ============================================================================

  async updateSectionAttendance(
    date: string,
    sectionId: string,
    studentId: string,
    updateDto: UpdateSectionAttendanceDto,
    context: RequestContext,
  ): Promise<SectionAttendanceResponseDto> {
    this.logger.debug(`updateSectionAttendance: entry, sectionId=${sectionId}, studentId=${studentId}, date=${date}, newStatus=${updateDto.status || 'unchanged'}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const existing = await this.dynamoDBClient.getItem<SectionAttendance>(
      client,
      context.tenantId,
      EntityKeyBuilder.sectionAttendance(date, sectionId, studentId),
    );

    if (!existing) {
      throw new NotFoundException('Section attendance record not found');
    }

    // Validate data scope
    const scope = await this.dataScopeService.resolveScope(context.userId, existing.schoolId, context);
    if (!this.dataScopeService.isStudentInScope(scope, studentId)) {
      throw new ForbiddenException('You do not have access to update this attendance record');
    }

    const now = new Date().toISOString();

    // Build dynamic update expression
    const setParts: string[] = ['updatedAt = :updatedAt', 'updatedBy = :updatedBy'];
    const values: Record<string, any> = {
      ':updatedAt': now,
      ':updatedBy': context.userId,
    };
    const names: Record<string, string> = {};

    if (updateDto.status !== undefined) {
      setParts.push('#status = :status');
      values[':status'] = updateDto.status;
      names['#status'] = 'status';

      // Re-derive Ed-Fi descriptors when status changes
      const edfi = populateEdFiDescriptors(updateDto.status, updateDto.excuseReason ?? existing.reason);
      setParts.push('attendanceEventCategory = :aec', 'educationalEnvironment = :ee', 'attendanceEventReason = :aer');
      values[':aec'] = edfi.attendanceEventCategory;
      values[':ee'] = edfi.educationalEnvironment;
      values[':aer'] = edfi.attendanceEventReason || null;
    }
    if (updateDto.checkInTime !== undefined) {
      setParts.push('checkInTime = :checkInTime');
      values[':checkInTime'] = updateDto.checkInTime;
    }
    if (updateDto.checkOutTime !== undefined) {
      setParts.push('checkOutTime = :checkOutTime');
      values[':checkOutTime'] = updateDto.checkOutTime;
    }
    if (updateDto.notes !== undefined) {
      setParts.push('note = :note');
      values[':note'] = updateDto.notes;
    }
    if (updateDto.excuseReason !== undefined) {
      setParts.push('reason = :reason');
      values[':reason'] = updateDto.excuseReason;
      // If status wasn't changed but excuseReason was, update category descriptor
      if (updateDto.status === undefined) {
        const edfi = populateEdFiDescriptors(existing.status, updateDto.excuseReason);
        setParts.push('attendanceEventCategory = :aec', 'attendanceEventReason = :aer');
        values[':aec'] = edfi.attendanceEventCategory;
        values[':aer'] = edfi.attendanceEventReason || null;
      }
    }
    if (updateDto.durationMinutes !== undefined) {
      setParts.push('sectionAttendanceDuration = :duration');
      values[':duration'] = updateDto.durationMinutes;
    }
    if (updateDto.parentNotified !== undefined) {
      setParts.push('parentNotified = :parentNotified');
      values[':parentNotified'] = updateDto.parentNotified;
    }
    if (updateDto.parentNotifiedAt !== undefined) {
      setParts.push('parentNotifiedAt = :parentNotifiedAt');
      values[':parentNotifiedAt'] = updateDto.parentNotifiedAt;
    }

    // Optimistic locking
    setParts.push('#version = #version + :inc');
    values[':inc'] = 1;
    names['#version'] = 'version';

    const expectedVersion = updateDto.expectedVersion ?? existing.version;
    values[':expectedVersion'] = expectedVersion;

    const updateExpr = `SET ${setParts.join(', ')}`;
    const conditionExpr = '#version = :expectedVersion';

    try {
      await this.dynamoDBClient.updateItem(
        client,
        context.tenantId,
        EntityKeyBuilder.sectionAttendance(date, sectionId, studentId),
        updateExpr,
        values,
        conditionExpr,
        names,
      );
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        throw new ConflictException(
          'Record was modified by another user. Refresh and try again.',
        );
      }
      throw error;
    }

    // Return updated entity
    const updated = await this.dynamoDBClient.getItem<SectionAttendance>(
      client,
      context.tenantId,
      EntityKeyBuilder.sectionAttendance(date, sectionId, studentId),
    );

    // Re-derive school attendance after status update (fire-and-forget)
    this.derivationService.deriveSchoolAttendance(
      context.tenantId, studentId, existing.schoolId,
      date, context.jwtToken, context.userId,
    ).catch(err => this.logger.error('Failed to derive school attendance after update', err));

    return sectionAttendanceEntityToDto(updated || existing);
  }

  // ============================================================================
  // STUDENT SECTION ATTENDANCE HISTORY
  // ============================================================================

  async getStudentSectionAttendance(
    studentId: string,
    context: RequestContext,
    sectionId?: string,
    startDate?: string,
    endDate?: string,
    schoolId?: string,
  ): Promise<SectionAttendanceResponseDto[]> {
    this.logger.debug(`getStudentSectionAttendance: entry, studentId=${studentId}, sectionId=${sectionId || 'all'}, startDate=${startDate || 'none'}, endDate=${endDate || 'none'}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Use GSI2 for student-centric query
    const gsi2pk = GSIKeyBuilder.attendanceStudent(context.tenantId, studentId);
    let items: SectionAttendance[];

    if (startDate && endDate) {
      const skStart = sectionId
        ? `SEC_ATTEND#${startDate}#${sectionId}`
        : `SEC_ATTEND#${startDate}`;
      const skEnd = sectionId
        ? `SEC_ATTEND#${endDate}\uffff`
        : `SEC_ATTEND#${endDate}\uffff`;

      items = await this.dynamoDBClient.queryGSI2Range<SectionAttendance>(
        client, gsi2pk, skStart, skEnd, 1000,
      );
    } else {
      const skPrefix = sectionId ? `SEC_ATTEND#` : `SEC_ATTEND#`;
      const result = await this.dynamoDBClient.queryGSI2<SectionAttendance>(
        client, gsi2pk, skPrefix, 'begins_with', 1000,
      );
      items = result.items;
    }

    // Filter by sectionId if provided and using range query (which may include other sections)
    if (sectionId) {
      items = items.filter(item => item.sectionId === sectionId);
    }

    // Data scope filter
    if (schoolId) {
      const scope = await this.dataScopeService.resolveScope(context.userId, schoolId, context);
      if (!this.dataScopeService.isStudentInScope(scope, studentId)) {
        return [];
      }
    }

    this.logger.debug(`getStudentSectionAttendance: returning ${items.length} records`);
    return items.map(entity => sectionAttendanceEntityToDto(entity));
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * Validate that the date is an instructional day
   */
  private async validateInstructionalDay(
    schoolId: string,
    date: string,
    context: RequestContext,
  ): Promise<void> {
    const cacheKey = `${schoolId}:${date}`;
    const cached = this.calendarCache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.cachedAt < CALENDAR_CACHE_TTL_MS) {
      this.logger.debug(`validateInstructionalDay: calendar cache HIT for ${cacheKey}`);
      if (cached.data && !cached.data.isInstructionalDay) {
        throw new BadRequestException(
          `Cannot record attendance for ${date}: not an instructional day`,
        );
      }
      return;
    }

    this.logger.debug(`validateInstructionalDay: calendar cache MISS for ${cacheKey}, fetching`);
    try {
      const calendarDate = await this.identityClient.getCalendarDate(schoolId, date, context);
      this.calendarCache.set(cacheKey, { data: calendarDate, cachedAt: now });

      if (calendarDate && !calendarDate.isInstructionalDay) {
        throw new BadRequestException(
          `Cannot record attendance for ${date}: not an instructional day`,
        );
      }
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      // Graceful degradation: if calendar service is down, allow attendance
      this.logger.warn(`Calendar validation failed for ${date}, allowing attendance: ${error.message}`);
      this.calendarCache.set(cacheKey, { data: null, cachedAt: now });
    }
  }

  /**
   * Batch-resolve student names with in-memory TTL cache
   */
  private async resolveStudentNames(
    client: any,
    tenantId: string,
    studentIds: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const now = Date.now();
    const uncachedIds: string[] = [];

    for (const id of studentIds) {
      const cacheKey = `${tenantId}#${id}`;
      const cached = this.studentNameCache.get(cacheKey);
      if (cached && now - cached.cachedAt < STUDENT_NAME_CACHE_TTL_MS) {
        result.set(id, cached.name);
      } else {
        uncachedIds.push(id);
      }
    }

    this.logger.debug(`resolveStudentNames: ${result.size} cache hits, ${uncachedIds.length} cache misses out of ${studentIds.length} requested`);
    if (uncachedIds.length === 0) return result;

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
      this.logger.debug(`resolveStudentNames: resolved ${students.length} names from DB`);
    } catch (error) {
      this.logger.warn(`Batch student name resolution failed: ${error}`);
    }

    return result;
  }

  /**
   * Resolve courseName from CourseSection entity
   */
  private async resolveCourseName(
    client: any,
    tenantId: string,
    schoolId: string,
    sectionId: string,
  ): Promise<string | undefined> {
    try {
      const section = await this.dynamoDBClient.getItem<CourseSection>(
        client,
        tenantId,
        EntityKeyBuilder.section(schoolId, sectionId),
      );
      return section?.courseName;
    } catch (err) {
      this.logger.warn(`Failed to resolve courseName for section ${sectionId}: ${err}`);
      return undefined;
    }
  }

  /**
   * Record attendance-taken marker (Ed-Fi: SectionAttendanceTakenEvent).
   * Upserts a single record per section per date.
   */
  private async recordAttendanceTaken(
    client: any,
    tenantId: string,
    sectionId: string,
    schoolId: string,
    date: string,
    totalStudents: number,
    studentsRecorded: number,
    userId: string,
    now: string,
  ): Promise<void> {
    const existingKey = EntityKeyBuilder.sectionAttendanceTaken(date, sectionId);
    const existing = await this.dynamoDBClient.getItem<SectionAttendanceTaken>(
      client, tenantId, existingKey,
    );

    if (existing) {
      // Update counts
      await this.dynamoDBClient.updateItem(
        client, tenantId, existingKey,
        'SET studentsRecorded = :recorded, totalStudents = :total, updatedAt = :now, updatedBy = :userId, #version = #version + :inc',
        {
          ':recorded': studentsRecorded,
          ':total': totalStudents,
          ':now': now,
          ':userId': userId,
          ':inc': 1,
        },
        undefined,
        { '#version': 'version' },
      );
    } else {
      const entity = createSectionAttendanceTakenEntity(
        tenantId, sectionId, schoolId, date,
        {
          totalStudents,
          studentsRecorded,
          takenBy: userId,
          takenAt: now,
          createdAt: now,
          createdBy: userId,
          updatedAt: now,
          updatedBy: userId,
          version: 1,
        },
      );
      await this.dynamoDBClient.putItem(client, entity);
    }

    this.logger.debug(`Attendance-taken recorded: section ${sectionId} on ${date} (${studentsRecorded}/${totalStudents})`);
  }
}
