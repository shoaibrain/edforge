/**
 * Academic Years Service - Academic year management for Identity Service
 */

import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicSessionService } from '../schools/academic-session.service';
import {
  AcademicYear,
  GradingPeriod,
  Holiday,
  createAcademicYearEntity,
  createGradingPeriodEntity,
  createHolidayEntity,
} from '../common/entities/academic-year.entity';
import {
  EntityKeyBuilder,
  RequestContext,
  PaginatedResult,
} from '../common/entities/base.entity';
import type {
  CreateAcademicYearDto,
  UpdateAcademicYearDto,
  UpdateAcademicYearStatusDto,
  AcademicYearResponseDto,
  CreateGradingPeriodDto,
  UpdateGradingPeriodDto,
  GradingPeriodResponseDto,
  CreateHolidayDto,
  HolidayResponseDto,
  TermType,
  TermDescriptor,
} from '@aibrains/shared-types';
import { parseBsDate, gregorianToBs } from '@aibrains/shared-types';

@Injectable()
export class AcademicYearsService {
  private readonly logger = new Logger(AcademicYearsService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    @Optional() @Inject(forwardRef(() => AcademicSessionService))
    private readonly academicSessionService?: AcademicSessionService,
  ) {}

  // ============================================
  // Academic Year Operations
  // ============================================

  /**
   * Create a new academic year
   */
  async createAcademicYear(
    schoolId: string,
    createDto: CreateAcademicYearDto,
    context: RequestContext
  ): Promise<AcademicYearResponseDto> {
    const now = new Date().toISOString();
    const yearId = uuid();

    // BS-date handling (P0.11): when the caller supplies startDateBS/endDateBS
    // but not startDate/endDate, convert BS → AD. When both are present, AD is
    // canonical — log if they disagree but trust AD.
    let startDate = createDto.startDate;
    let endDate = createDto.endDate;
    const startDateBS = (createDto as any).startDateBS as string | undefined;
    const endDateBS = (createDto as any).endDateBS as string | undefined;
    try {
      if (!startDate && startDateBS) startDate = parseBsDate(startDateBS);
      if (!endDate && endDateBS) endDate = parseBsDate(endDateBS);
    } catch (e: any) {
      throw new BadRequestException(`Invalid Bikram Sambat date: ${e.message}`);
    }
    if (!startDate || !endDate) {
      throw new BadRequestException(
        'startDate/endDate required (either Gregorian or startDateBS/endDateBS)',
      );
    }

    // Validate dates
    if (new Date(endDate) <= new Date(startDate)) {
      throw new BadRequestException('End date must be after start date');
    }

    // S0.12: reject AYs with date ranges that overlap an existing AY for
    // this school. Two AYs can have OVERLAPPING STATUSES during the
    // cross-year transition window (see Part C of the sprint plan) — but
    // the calendar date ranges themselves must be disjoint.
    await this.validateNoDateRangeOverlap(
      schoolId,
      startDate,
      endDate,
      undefined,
      context,
    );

    const academicYear = createAcademicYearEntity(
      context.tenantId,
      schoolId,
      yearId,
      {
        name: createDto.name,
        shortName: createDto.shortName,
        startDate,
        endDate,
        // Persist BS display hints when provided; callers can recompute from
        // startDate/endDate via `gregorianToBs` if absent.
        startDateBS: startDateBS,
        endDateBS: endDateBS,
        status: 'planning',
        isCurrent: createDto.setAsCurrent || false,
        calendarType: createDto.calendarType || 'semester',
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // If setting as current, clear other current years first
    if (createDto.setAsCurrent) {
      await this.clearCurrentYear(schoolId, context);
    }

    await this.dynamoDBClient.putItem(client, academicYear);

    this.logger.log(`Academic year created: ${academicYear.name} (${yearId}) for school ${schoolId}`);

    return this.toAcademicYearResponse(academicYear);
  }

  /**
   * Get academic year by ID
   */
  async getAcademicYear(
    schoolId: string,
    yearId: string,
    context: RequestContext
  ): Promise<AcademicYearResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const year = await this.dynamoDBClient.getItem<AcademicYear>(
      client,
      context.tenantId,
      EntityKeyBuilder.academicYear(schoolId, yearId)
    );

    if (!year) {
      throw new NotFoundException('Academic year not found');
    }

    return this.toAcademicYearResponse(year);
  }

  /**
   * Get current academic year for school.
   *
   * S0.1: Strictly honors `isCurrent`. Returns 404 with structured
   * `errorCode: NO_CURRENT_AY` when no year has the flag set. The prior
   * implementation matched on `status === 'active'`, which silently
   * masked the missing flag and produced surprising data — see evidence
   * §4.2 in docs/saraswati-academic-setup-evidence.md.
   */
  async getCurrentAcademicYear(
    schoolId: string,
    context: RequestContext
  ): Promise<AcademicYearResponseDto> {
    const years = await this.listAcademicYears(schoolId, context);
    const current = years.items.find(y => y.isCurrent === true);

    if (!current) {
      throw new NotFoundException({
        message:
          'No academic year is marked as current for this school. ' +
          'Use PUT /schools/:schoolId/academic-years/:yearId/set-current to designate one.',
        errorCode: 'NO_CURRENT_AY',
        details: { schoolId },
      });
    }

    return current;
  }

  /**
   * List academic years for a school
   */
  async listAcademicYears(
    schoolId: string,
    context: RequestContext,
    limit: number = 20
  ): Promise<PaginatedResult<AcademicYearResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const result = await this.dynamoDBClient.query<AcademicYear>(
      client,
      context.tenantId,
      `SCHOOL#${schoolId}#YEAR#`,
      'entityType = :entityType',
      { ':entityType': 'ACADEMIC_YEAR' },
      undefined,
      limit
    );

    return {
      items: result.items.map(y => this.toAcademicYearResponse(y)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Update academic year
   */
  async updateAcademicYear(
    schoolId: string,
    yearId: string,
    updateDto: UpdateAcademicYearDto,
    context: RequestContext
  ): Promise<AcademicYearResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const year = await this.dynamoDBClient.getItem<AcademicYear>(
      client,
      context.tenantId,
      EntityKeyBuilder.academicYear(schoolId, yearId)
    );

    if (!year) {
      throw new NotFoundException('Academic year not found');
    }

    // S0.12: if either start or end date is changing, validate the resulting
    // range against existing AYs (excluding this one). Also re-validate the
    // start<end invariant for the post-update pair, since the prior code
    // could silently let an inverted range through if only one side changed.
    if (updateDto.startDate || updateDto.endDate) {
      const effectiveStart = updateDto.startDate ?? year.startDate;
      const effectiveEnd = updateDto.endDate ?? year.endDate;
      if (new Date(effectiveEnd) <= new Date(effectiveStart)) {
        throw new BadRequestException('End date must be after start date');
      }
      await this.validateNoDateRangeOverlap(
        schoolId,
        effectiveStart,
        effectiveEnd,
        yearId,
        context,
      );
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};

    if (updateDto.name) {
      updates.push('name = :name');
      values[':name'] = updateDto.name;
    }
    if (updateDto.shortName !== undefined) {
      updates.push('shortName = :shortName');
      values[':shortName'] = updateDto.shortName;
    }
    if (updateDto.startDate) {
      updates.push('startDate = :startDate');
      values[':startDate'] = updateDto.startDate;
    }
    if (updateDto.endDate) {
      updates.push('endDate = :endDate');
      values[':endDate'] = updateDto.endDate;
    }
    if (updateDto.calendarType) {
      updates.push('calendarType = :calendarType');
      values[':calendarType'] = updateDto.calendarType;
    }

    if (updates.length === 0) {
      return this.toAcademicYearResponse(year);
    }

    updates.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy', '#version = #version + :inc');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;
    values[':inc'] = 1;

    const updatedYear = await this.dynamoDBClient.updateItem<AcademicYear>(
      client,
      context.tenantId,
      EntityKeyBuilder.academicYear(schoolId, yearId),
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      { '#version': 'version' }
    );

    this.logger.log(`Academic year updated: ${yearId}`);

    return this.toAcademicYearResponse(updatedYear);
  }

  /**
   * Update academic year status
   */
  async updateAcademicYearStatus(
    schoolId: string,
    yearId: string,
    updateDto: UpdateAcademicYearStatusDto,
    context: RequestContext
  ): Promise<AcademicYearResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const year = await this.dynamoDBClient.getItem<AcademicYear>(
      client,
      context.tenantId,
      EntityKeyBuilder.academicYear(schoolId, yearId)
    );

    if (!year) {
      throw new NotFoundException('Academic year not found');
    }

    const updatedYear = await this.dynamoDBClient.updateItem<AcademicYear>(
      client,
      context.tenantId,
      EntityKeyBuilder.academicYear(schoolId, yearId),
      'SET #status = :status, updatedAt = :updatedAt, updatedBy = :updatedBy',
      {
        ':status': updateDto.status,
        ':updatedAt': new Date().toISOString(),
        ':updatedBy': context.userId,
      },
      undefined,
      { '#status': 'status' }
    );

    this.logger.log(`Academic year ${yearId} status updated to ${updateDto.status}`);

    // P0.15 audit — status transitions are high-signal (e.g. year activation
    // triggers downstream locks and financial cutoffs). Filter with
    // `{ $.audit.action = "ACADEMIC_YEAR_STATUS_CHANGED" }`.
    this.logger.log(
      `AUDIT ${JSON.stringify({
        audit: {
          action: 'ACADEMIC_YEAR_STATUS_CHANGED',
          actor: context.userId,
          tenantId: context.tenantId,
          schoolId,
          yearId,
          from: year.status,
          to: updateDto.status,
          at: new Date().toISOString(),
        },
      })}`,
    );

    // P0.16 — lock WorkspaceSettings on first planning→active transition.
    // Only fire on the transition (year was not already active). Fail open on
    // settings-write errors (don't block the year activation) but log loudly.
    if (updateDto.status === 'active' && year.status !== 'active') {
      try {
        await this.lockWorkspaceSettingsIfUnlocked(context);
      } catch (err: any) {
        this.logger.error(
          `Failed to lock WorkspaceSettings after activating year ${yearId}: ${err.message}`,
        );
      }
    }

    return this.toAcademicYearResponse(updatedYear);
  }

  /**
   * P0.16 — Set `WorkspaceSettings.isLocked=true` on first academic year
   * activation. Idempotent (no-op if already locked). Uses a conditional
   * write so concurrent activations don't race.
   */
  private async lockWorkspaceSettingsIfUnlocked(context: RequestContext): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const now = new Date().toISOString();
    try {
      await this.dynamoDBClient.updateItem(
        client,
        context.tenantId,
        EntityKeyBuilder.workspaceSettings(),
        'SET isLocked = :locked, lockReason = :reason, updatedAt = :now, updatedBy = :by',
        {
          ':locked': true,
          ':reason': 'Academic year activated — regional settings frozen',
          ':now': now,
          ':by': context.userId,
          ':false': false,
        },
        'isLocked = :false OR attribute_not_exists(isLocked)',
      );
      this.logger.log(`WorkspaceSettings locked for tenant ${context.tenantId}`);
    } catch (err: any) {
      // ConditionalCheckFailedException means it was already locked — fine.
      if (err.name === 'ConditionalCheckFailedException') {
        this.logger.debug(`WorkspaceSettings already locked for tenant ${context.tenantId}`);
        return;
      }
      throw err;
    }
  }

  /**
   * Set academic year as current
   */
  async setCurrentAcademicYear(
    schoolId: string,
    yearId: string,
    context: RequestContext
  ): Promise<AcademicYearResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const year = await this.dynamoDBClient.getItem<AcademicYear>(
      client,
      context.tenantId,
      EntityKeyBuilder.academicYear(schoolId, yearId)
    );

    if (!year) {
      throw new NotFoundException('Academic year not found');
    }

    // Clear current flag from other years
    await this.clearCurrentYear(schoolId, context);

    // Set this year as current
    const updatedYear = await this.dynamoDBClient.updateItem<AcademicYear>(
      client,
      context.tenantId,
      EntityKeyBuilder.academicYear(schoolId, yearId),
      'SET isCurrent = :isCurrent, updatedAt = :updatedAt, updatedBy = :updatedBy',
      {
        ':isCurrent': true,
        ':updatedAt': new Date().toISOString(),
        ':updatedBy': context.userId,
      }
    );

    this.logger.log(`Academic year ${yearId} set as current for school ${schoolId}`);

    return this.toAcademicYearResponse(updatedYear);
  }

  /**
   * Clear current year flag from all years
   */
  private async clearCurrentYear(schoolId: string, context: RequestContext): Promise<void> {
    const years = await this.listAcademicYears(schoolId, context);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    for (const year of years.items) {
      if (year.isCurrent) {
        await this.dynamoDBClient.updateItem(
          client,
          context.tenantId,
          EntityKeyBuilder.academicYear(schoolId, year.yearId),
          'SET isCurrent = :isCurrent',
          { ':isCurrent': false }
        );
      }
    }
  }

  // ============================================
  // Grading Period Operations
  // ============================================

  /**
   * Create a grading period
   */
  async createGradingPeriod(
    schoolId: string,
    yearId: string,
    createDto: CreateGradingPeriodDto,
    context: RequestContext
  ): Promise<GradingPeriodResponseDto> {
    const now = new Date().toISOString();
    const termId = uuid();

    // Validate year exists
    const year = await this.getAcademicYear(schoolId, yearId, context);
    if (!year) {
      throw new NotFoundException('Academic year not found');
    }

    // Validate dates
    if (new Date(createDto.endDate) <= new Date(createDto.startDate)) {
      throw new BadRequestException('End date must be after start date');
    }

    // Validate against linked academic session if provided
    if (createDto.academicSessionId && this.academicSessionService) {
      const session = await this.academicSessionService.getSession(
        schoolId,
        createDto.academicSessionId,
        context
      );
      if (createDto.startDate < session.beginDate || createDto.endDate > session.endDate) {
        throw new BadRequestException(
          `Grading period dates must fall within linked session "${session.sessionName}" (${session.beginDate} to ${session.endDate})`
        );
      }
    }

    const period = createGradingPeriodEntity(
      context.tenantId,
      schoolId,
      yearId,
      termId,
      {
        name: createDto.name,
        shortName: createDto.shortName,
        termType: createDto.termType,
        sequence: createDto.sequence,
        startDate: createDto.startDate,
        endDate: createDto.endDate,
        gradesDueDate: createDto.gradesDueDate,
        reportCardDate: createDto.reportCardDate,
        isActive: true,
        academicSessionId: createDto.academicSessionId,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    await this.dynamoDBClient.putItem(client, period);

    this.logger.log(`Grading period created: ${period.name} (${termId}) for year ${yearId}`);

    // Auto-create a corresponding AcademicSession if none was linked.
    // This ensures calendar generation can find sessions without requiring
    // the user to manually create them as a separate step.
    if (!createDto.academicSessionId && this.academicSessionService) {
      try {
        const termDescriptor = this.mapTermTypeToDescriptor(createDto.termType, createDto.sequence);
        const session = await this.academicSessionService.createSession(
          schoolId,
          {
            academicYearId: yearId,
            sessionName: createDto.name,
            beginDate: createDto.startDate,
            endDate: createDto.endDate,
            termDescriptor,
            gradingPeriodIds: [termId],
          },
          context,
        );

        // Link session back to the grading period
        await this.dynamoDBClient.updateItem(
          client,
          context.tenantId,
          EntityKeyBuilder.term(schoolId, yearId, termId),
          'SET academicSessionId = :sid',
          { ':sid': session.academicSessionId },
        );
        period.academicSessionId = session.academicSessionId;

        this.logger.log(
          `Auto-created AcademicSession "${session.sessionName}" (${session.academicSessionId}) for grading period ${termId}`
        );
      } catch (err) {
        this.logger.warn(
          `Failed to auto-create AcademicSession for grading period ${termId}: ${(err as Error).message}`
        );
      }
    }

    return this.toGradingPeriodResponse(period);
  }

  /**
   * List grading periods for an academic year
   */
  async listGradingPeriods(
    schoolId: string,
    yearId: string,
    context: RequestContext
  ): Promise<PaginatedResult<GradingPeriodResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const result = await this.dynamoDBClient.query<GradingPeriod>(
      client,
      context.tenantId,
      `SCHOOL#${schoolId}#YEAR#${yearId}#TERM#`,
      'entityType = :entityType',
      { ':entityType': 'TERM' },
      undefined,
      50
    );

    // Sort by sequence
    const sorted = result.items.sort((a, b) => a.sequence - b.sequence);

    return {
      items: sorted.map(p => this.toGradingPeriodResponse(p)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Update grading period
   */
  async updateGradingPeriod(
    schoolId: string,
    yearId: string,
    termId: string,
    updateDto: UpdateGradingPeriodDto,
    context: RequestContext
  ): Promise<GradingPeriodResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const period = await this.dynamoDBClient.getItem<GradingPeriod>(
      client,
      context.tenantId,
      EntityKeyBuilder.term(schoolId, yearId, termId)
    );

    if (!period) {
      throw new NotFoundException('Grading period not found');
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};

    if (updateDto.name) {
      updates.push('name = :name');
      values[':name'] = updateDto.name;
    }
    if (updateDto.shortName !== undefined) {
      updates.push('shortName = :shortName');
      values[':shortName'] = updateDto.shortName;
    }
    if (updateDto.startDate) {
      updates.push('startDate = :startDate');
      values[':startDate'] = updateDto.startDate;
    }
    if (updateDto.endDate) {
      updates.push('endDate = :endDate');
      values[':endDate'] = updateDto.endDate;
    }
    if (updateDto.gradesDueDate !== undefined) {
      updates.push('gradesDueDate = :gradesDueDate');
      values[':gradesDueDate'] = updateDto.gradesDueDate;
    }
    if (updateDto.reportCardDate !== undefined) {
      updates.push('reportCardDate = :reportCardDate');
      values[':reportCardDate'] = updateDto.reportCardDate;
    }
    if (updateDto.isActive !== undefined) {
      updates.push('isActive = :isActive');
      values[':isActive'] = updateDto.isActive;
    }
    if ((updateDto as any).academicSessionId !== undefined) {
      // Validate session dates if linking to a session
      const sessionId = (updateDto as any).academicSessionId;
      if (sessionId && this.academicSessionService) {
        const session = await this.academicSessionService.getSession(schoolId, sessionId, context);
        const startDate = updateDto.startDate || period.startDate;
        const endDate = updateDto.endDate || period.endDate;
        if (startDate < session.beginDate || endDate > session.endDate) {
          throw new BadRequestException(
            `Grading period dates must fall within linked session "${session.sessionName}" (${session.beginDate} to ${session.endDate})`
          );
        }
      }
      updates.push('academicSessionId = :academicSessionId');
      values[':academicSessionId'] = sessionId;
    }

    if (updates.length === 0) {
      return this.toGradingPeriodResponse(period);
    }

    updates.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;

    const updatedPeriod = await this.dynamoDBClient.updateItem<GradingPeriod>(
      client,
      context.tenantId,
      EntityKeyBuilder.term(schoolId, yearId, termId),
      `SET ${updates.join(', ')}`,
      values
    );

    this.logger.log(`Grading period updated: ${termId}`);

    return this.toGradingPeriodResponse(updatedPeriod);
  }

  // ============================================
  // Holiday Operations
  // ============================================

  /**
   * Create a holiday
   */
  async createHoliday(
    schoolId: string,
    yearId: string,
    createDto: CreateHolidayDto,
    context: RequestContext
  ): Promise<HolidayResponseDto> {
    const now = new Date().toISOString();
    const holidayId = uuid();

    const holiday = createHolidayEntity(
      context.tenantId,
      schoolId,
      yearId,
      holidayId,
      {
        name: createDto.name,
        date: createDto.date,
        endDate: createDto.endDate,
        holidayType: createDto.holidayType,
        affectsStudents: createDto.affectsStudents !== false,
        affectsStaff: createDto.affectsStaff !== false,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    await this.dynamoDBClient.putItem(client, holiday);

    this.logger.log(`Holiday created: ${holiday.name} (${createDto.date}) for year ${yearId}`);

    return this.toHolidayResponse(holiday);
  }

  /**
   * List holidays for an academic year
   */
  async listHolidays(
    schoolId: string,
    yearId: string,
    context: RequestContext
  ): Promise<PaginatedResult<HolidayResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const result = await this.dynamoDBClient.query<Holiday>(
      client,
      context.tenantId,
      `SCHOOL#${schoolId}#YEAR#${yearId}#HOLIDAY#`,
      'entityType = :entityType',
      { ':entityType': 'HOLIDAY' },
      undefined,
      100
    );

    // Sort by date
    const sorted = result.items.sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    return {
      items: sorted.map(h => this.toHolidayResponse(h)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Delete holiday
   */
  async deleteHoliday(
    schoolId: string,
    yearId: string,
    holidayId: string,
    context: RequestContext
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    
    // Find the holiday first to get the date for the key
    const holidays = await this.listHolidays(schoolId, yearId, context);
    const holiday = holidays.items.find(h => h.holidayId === holidayId);
    
    if (!holiday) {
      throw new NotFoundException('Holiday not found');
    }

    await this.dynamoDBClient.deleteItem(
      client,
      context.tenantId,
      `SCHOOL#${schoolId}#YEAR#${yearId}#HOLIDAY#${holiday.date}`
    );

    this.logger.log(`Holiday deleted: ${holidayId}`);
  }

  // ============================================
  // Validation helpers
  // ============================================

  /**
   * S0.12: ensure a candidate [startDate, endDate] range does not overlap
   * any existing AY for this school. Inclusive-bounds overlap test:
   *
   *     a.start <= b.end && b.start <= a.end
   *
   * Pass `excludeYearId` when validating during an update so the AY being
   * updated isn't compared against itself. ISO YYYY-MM-DD strings sort
   * lexicographically, so string comparison is correct for date comparisons.
   */
  private async validateNoDateRangeOverlap(
    schoolId: string,
    startDate: string,
    endDate: string,
    excludeYearId: string | undefined,
    context: RequestContext,
  ): Promise<void> {
    const existing = await this.listAcademicYears(schoolId, context, 100);
    for (const other of existing.items) {
      if (excludeYearId && other.yearId === excludeYearId) continue;
      const overlaps = startDate <= other.endDate && other.startDate <= endDate;
      if (overlaps) {
        throw new BadRequestException({
          message:
            `Academic year date range [${startDate} .. ${endDate}] overlaps ` +
            `with existing AY "${other.name}" [${other.startDate} .. ${other.endDate}]. ` +
            `Two AYs can have overlapping statuses during cross-year transitions, ` +
            `but the calendar date ranges themselves must be disjoint.`,
          errorCode: 'AY_DATE_RANGE_OVERLAP',
          details: {
            conflictingYearId: other.yearId,
            conflictingYearName: other.name,
            conflictingStartDate: other.startDate,
            conflictingEndDate: other.endDate,
            requestedStartDate: startDate,
            requestedEndDate: endDate,
          },
        });
      }
    }
  }

  // ============================================
  // Response Mappers
  // ============================================

  private toAcademicYearResponse(year: AcademicYear): AcademicYearResponseDto {
    // Compute BS strings on read so consumers always get both representations
    // for PABSON tenants. Falls back to stored display hint if present; else
    // computes from canonical Gregorian. Best-effort — if the date is outside
    // the supported BS window (2000–2090), return the stored string or undefined.
    const bs = this.computeBsDatesOnRead(year);
    return {
      yearId: year.yearId,
      schoolId: year.schoolId,
      name: year.name,
      shortName: year.shortName,
      startDate: year.startDate,
      endDate: year.endDate,
      startDateBS: bs.startDateBS,
      endDateBS: bs.endDateBS,
      status: year.status,
      isCurrent: year.isCurrent,
      calendarType: year.calendarType,
      createdAt: year.createdAt,
      updatedAt: year.updatedAt,
    };
  }

  /**
   * Compute BS date strings for a year on read. Preference order:
   *   1. Stored display hint (year.startDateBS / year.endDateBS)
   *   2. Computed from year.startDate / year.endDate via gregorianToBs
   *   3. undefined (BS year out of supported range or conversion error)
   */
  private computeBsDatesOnRead(year: AcademicYear): {
    startDateBS?: string;
    endDateBS?: string;
  } {
    const fmt = (bs: { year: number; month: number; day: number }) =>
      `${bs.year}/${String(bs.month).padStart(2, '0')}/${String(bs.day).padStart(2, '0')}`;
    let startDateBS = year.startDateBS;
    let endDateBS = year.endDateBS;
    try {
      if (!startDateBS && year.startDate) startDateBS = fmt(gregorianToBs(year.startDate));
      if (!endDateBS && year.endDate) endDateBS = fmt(gregorianToBs(year.endDate));
    } catch {
      // BS year out of range — leave as stored (may be undefined).
    }
    return { startDateBS, endDateBS };
  }

  private toGradingPeriodResponse(period: GradingPeriod): GradingPeriodResponseDto {
    return {
      termId: period.termId,
      yearId: period.yearId,
      schoolId: period.schoolId,
      name: period.name,
      shortName: period.shortName,
      termType: period.termType,
      sequence: period.sequence,
      startDate: period.startDate,
      endDate: period.endDate,
      gradesDueDate: period.gradesDueDate,
      reportCardDate: period.reportCardDate,
      isActive: period.isActive,
      academicSessionId: period.academicSessionId,
      createdAt: period.createdAt,
      updatedAt: period.updatedAt,
    };
  }

  /**
   * Map GradingPeriod termType + sequence to Ed-Fi TermDescriptor
   * for auto-created AcademicSession entities.
   */
  private mapTermTypeToDescriptor(termType: string, sequence: number): TermDescriptor {
    switch (termType) {
      case 'semester':
        return sequence === 1 ? 'fall_semester' : 'spring_semester';
      case 'quarter': {
        const quarters: TermDescriptor[] = ['first_quarter', 'second_quarter', 'third_quarter', 'fourth_quarter'];
        return quarters[sequence - 1] || 'first_quarter';
      }
      case 'trimester': {
        const trimesters: TermDescriptor[] = ['first_quarter', 'second_quarter', 'third_quarter'];
        return trimesters[sequence - 1] || 'first_quarter';
      }
      default:
        return 'year_round';
    }
  }

  private toHolidayResponse(holiday: Holiday): HolidayResponseDto {
    return {
      holidayId: holiday.holidayId,
      yearId: holiday.yearId,
      schoolId: holiday.schoolId,
      name: holiday.name,
      date: holiday.date,
      endDate: holiday.endDate,
      holidayType: holiday.holidayType,
      affectsStudents: holiday.affectsStudents,
      affectsStaff: holiday.affectsStaff,
      createdAt: holiday.createdAt,
    };
  }
}

