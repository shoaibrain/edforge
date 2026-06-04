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
import { AuditedWriteService } from '../common/services/audited-write.service';
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
  CalendarDate,
  CalendarDateKeyBuilder,
  createCalendarDateEntity,
  getDayOfWeek,
  isWeekend as isWeekendDate,
} from '../common/entities/calendar-date.entity';
import type { CalendarEvent } from '../common/entities/calendar-date.entity';

/**
 * Sprint S2.1 — non-blocking warning surfaced on createGradingPeriod /
 * updateGradingPeriod when the exam window overlaps existing holidays.
 * Operator may legitimately want make-up exams on traditional holidays,
 * so this is a heads-up, not a rejection. Stable `code` so consumers
 * can switch on it for localized messages.
 */
export interface HolidayOverlapWarning {
  code: 'EXAM_OVERLAPS_HOLIDAY';
  date: string;
  holidayName: string;
}

/**
 * Sprint S2.1 — the response shape returned from createGradingPeriod /
 * updateGradingPeriod. Identical to GradingPeriodResponseDto with an
 * optional `warnings` field appended when holiday overlaps are detected.
 * Local type extension to avoid bumping shared-types twice during S2;
 * promote to shared-types in the S2 cumulative bump at end of sprint.
 */
type GradingPeriodWithWarnings = GradingPeriodResponseDto & {
  warnings?: HolidayOverlapWarning[];
};
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
    private readonly auditedWrite: AuditedWriteService,
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

    // Sprint C4-followup (Saraswati activation block, 2026-05-18) — resolve
    // the `isCurrent` default. Two paths:
    //   1. Operator explicitly passed `setAsCurrent: true` → honor it (clear
    //      any other current AY first, see clearCurrentYear() below).
    //   2. Operator passed `setAsCurrent: false` or omitted it → check if any
    //      AY is currently flagged. If none, auto-promote this one to current.
    //
    // Why: without auto-promote, the operator-driven AY create flow lands a
    // school with N AYs all `isCurrent: false`. Every downstream call to
    // `/schools/:id/academic-years/current` returns 404 NO_CURRENT_AY, which
    // silently breaks dashboards / attendance / etc. The activation gate
    // doesn't detect this (it counts `status='active'`, not `isCurrent`).
    //
    // Saraswati pilot hit this on 2026-05-18 — single AY existed with
    // `status='active' isCurrent=false`. Operator had no way to know they
    // needed to click the ⭐ button. Auto-promote eliminates the trap for the
    // common case (first AY of a school) without overriding explicit operator
    // intent (the rare case of intentionally creating a non-current planning
    // AY survives — operator just has to pass `setAsCurrent: false` AND
    // already have a current AY).
    let resolvedIsCurrent = createDto.setAsCurrent === true;
    if (!resolvedIsCurrent) {
      const existing = await this.listAcademicYears(schoolId, context, 100);
      const hasAnyCurrent = existing.items.some(y => y.isCurrent === true);
      if (!hasAnyCurrent) {
        resolvedIsCurrent = true;
        this.logger.log(
          `Auto-promoted academic year ${yearId} to isCurrent=true ` +
            `(school ${schoolId} had no current AY)`,
        );
      }
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // An omitted calendarType inherits the SCHOOL's configured academicCalendarType
    // (archetype/country-derived — PABSON/NPL → 'annual'), NOT a hardcoded US
    // 'semester'. AcademicYear.calendarType is the authoritative calendar-type
    // source (S0.2), so defaulting a PABSON year to 'semester' would mis-describe
    // its term structure for reporting. 'semester' is only the last-resort fallback
    // for a legacy school with no CONFIG row. (The create schema leaves an omitted
    // calendarType undefined — `.optional()` defeats its `.default('semester')` —
    // so this `||` chain is reached, unlike the masked-default class it mirrors.)
    type AyCalendarType = NonNullable<typeof createDto.calendarType>;
    const schoolConfig = await this.dynamoDBClient.getItem<{ academicCalendarType?: AyCalendarType }>(
      client,
      context.tenantId,
      EntityKeyBuilder.schoolConfig(schoolId),
    );
    const resolvedCalendarType = createDto.calendarType || schoolConfig?.academicCalendarType || 'semester';

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
        isCurrent: resolvedIsCurrent,
        calendarType: resolvedCalendarType,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );

    // If setting as current, clear other current years first. We only run
    // clearCurrentYear when the operator EXPLICITLY asked — the auto-promote
    // path above never collides with an existing current AY (it requires
    // hasAnyCurrent=false to fire).
    if (createDto.setAsCurrent) {
      await this.clearCurrentYear(schoolId, context);
    }

    await this.dynamoDBClient.putItem(client, academicYear);

    this.logger.log(`Academic year created: ${academicYear.name} (${yearId}) for school ${schoolId}`);

    // Sprint S2.3 — audit AcademicYear create. Captures the boundary
    // identification (name + date range + calendarType) so compliance
    // reviewers can answer "when was this AY first created and by whom?"
    // without having to read DDB rows directly.
    await this.auditedWrite.emit(context, {
      schoolId,
      targetEntity: 'ACADEMIC_YEAR',
      targetEntityId: yearId,
      action: 'create',
      changes: [
        { field: 'name', oldValue: null, newValue: createDto.name },
        { field: 'startDate', oldValue: null, newValue: startDate },
        { field: 'endDate', oldValue: null, newValue: endDate },
        { field: 'calendarType', oldValue: null, newValue: resolvedCalendarType },
        { field: 'isCurrent', oldValue: null, newValue: resolvedIsCurrent },
        ...(startDateBS ? [{ field: 'startDateBS', oldValue: null, newValue: startDateBS }] : []),
        ...(endDateBS ? [{ field: 'endDateBS', oldValue: null, newValue: endDateBS }] : []),
      ],
    });

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
   * Update academic year status.
   *
   * Sprint 4 / Ticket 4.1 — also auto-promotes `isCurrent=true` on the
   * first `planning→active` transition when no other AY for the school
   * is currently designated. Symmetric to the `createAcademicYear`
   * auto-promote at lines 140-171; closes the same Saraswati 2026-05-18
   * incident from the activation side: a school could land in
   * `status='active'` with every AY having `isCurrent=false`, leaving
   * `/academic-years/current` to 404 forever.
   *
   * Gated by `AY_AUTO_PROMOTE_ON_ACTIVATE` env var (default 'true').
   * Flip to 'false' via task-def env edit if a misfire is reported —
   * faster than a code rollback and doesn't require an ECR push.
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

    const isPlanningToActive =
      updateDto.status === 'active' && year.status !== 'active';

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

    // Sprint 4 / Ticket 4.1 — auto-promote isCurrent. Runs only on the
    // transition (not on a status=active no-op or any other status edit),
    // only when nothing else is current, and only when the row hasn't
    // already been flipped. The conditional write protects against a
    // narrow race where another concurrent activation flips THIS row's
    // isCurrent between our list and our write — if that happens, the
    // post-state is already what we wanted, so we log and continue.
    //
    // We do NOT roll back the status update on a failed auto-promote.
    // The operator's expressed intent (activate this year) is preserved;
    // the operator-facing UI shipped in PR #101 lets them designate
    // current manually if anything goes wrong here.
    const autoPromoteEnabled =
      process.env.AY_AUTO_PROMOTE_ON_ACTIVATE !== 'false';
    let autoPromoted = false;
    if (isPlanningToActive && autoPromoteEnabled && !year.isCurrent) {
      const existing = await this.listAcademicYears(schoolId, context, 100);
      const hasOtherCurrent = existing.items.some(
        (y) => y.isCurrent === true && y.yearId !== yearId,
      );
      if (!hasOtherCurrent) {
        try {
          await this.dynamoDBClient.updateItem<AcademicYear>(
            client,
            context.tenantId,
            EntityKeyBuilder.academicYear(schoolId, yearId),
            'SET isCurrent = :true',
            { ':true': true, ':false': false },
            'attribute_not_exists(isCurrent) OR isCurrent = :false',
          );
          autoPromoted = true;
          updatedYear.isCurrent = true;
          this.logger.log(
            `Auto-promoted academic year ${yearId} to isCurrent=true ` +
              `(planning→active on school ${schoolId} with no other current AY)`,
          );
        } catch (err: any) {
          if (err.name === 'ConditionalCheckFailedException') {
            // Row's isCurrent was already true (a concurrent flip or a
            // re-entry from a retry). Target state is correct — log and
            // continue, no rollback.
            this.logger.warn(
              `Auto-promote on year ${yearId} skipped — ` +
                `conditional check failed (likely concurrent write or re-entry).`,
            );
          } else {
            // Unexpected error — log and continue. Don't fail the status
            // transition (the operator's primary intent).
            this.logger.error(
              `Auto-promote on year ${yearId} failed: ${err.message ?? err}`,
            );
          }
        }
      } else {
        this.logger.log(
          `Auto-promote on year ${yearId} skipped — another AY already current.`,
        );
      }
    }

    // S0.8: emit a proper audit row through AuditedWriteService alongside
    // the existing CloudWatch-filter log line. Both representations matter:
    // the DDB row is queryable per-tenant for compliance; the log line is
    // load-bearing for existing CloudWatch alarms (filter
    // `{ $.audit.action = "ACADEMIC_YEAR_STATUS_CHANGED" }`).
    //
    // Sprint 4 / Ticket 4.4 — include the isCurrent change in the audit
    // row when auto-promote fired, so compliance can answer "why did
    // isCurrent flip without an explicit set-current call?".
    const changes: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [
      { field: 'status', oldValue: year.status, newValue: updateDto.status },
    ];
    if (autoPromoted) {
      changes.push({ field: 'isCurrent', oldValue: false, newValue: true });
    }
    await this.auditedWrite.emit(context, {
      schoolId,
      targetEntity: 'ACADEMIC_YEAR',
      targetEntityId: yearId,
      action: 'status_change',
      changes,
    });

    // P0.15 audit (log-line variant, kept for CloudWatch filter continuity).
    // Sprint 4 / Ticket 4.4 — adds `isCurrentAutoPromoted` so the alarm
    // surface in Sprint 5 can filter on auto-promote events.
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
          isCurrentAutoPromoted: autoPromoted,
          at: new Date().toISOString(),
        },
      })}`,
    );

    // P0.16 — lock WorkspaceSettings on first planning→active transition.
    // Only fire on the transition (year was not already active). Fail open on
    // settings-write errors (don't block the year activation) but log loudly.
    if (isPlanningToActive) {
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
  ): Promise<GradingPeriodWithWarnings> {
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

    // Sprint S1.2 — validate exam window is inside the term range.
    // Throws BadRequestException with stable errorCode `EXAM_DATES_OUT_OF_TERM_RANGE`.
    this.validateExamDateRange(
      createDto.startDate,
      createDto.endDate,
      createDto.examStartDate,
      createDto.examEndDate,
    );

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
        examStartDate: createDto.examStartDate,
        examEndDate: createDto.examEndDate,
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

    // Sprint S1.2 — audit row on grading-period creation. Captures exam dates
    // if set so retroactive scope reviews can see when an operator first
    // configured them. Best-effort: AuditedWriteService swallows failures.
    await this.auditedWrite.emit(context, {
      schoolId,
      targetEntity: 'GRADING_PERIOD',
      targetEntityId: termId,
      action: 'create',
      changes: [
        { field: 'name', oldValue: null, newValue: createDto.name },
        { field: 'startDate', oldValue: null, newValue: createDto.startDate },
        { field: 'endDate', oldValue: null, newValue: createDto.endDate },
        ...(createDto.examStartDate !== undefined
          ? [{ field: 'examStartDate', oldValue: null, newValue: createDto.examStartDate }]
          : []),
        ...(createDto.examEndDate !== undefined
          ? [{ field: 'examEndDate', oldValue: null, newValue: createDto.examEndDate }]
          : []),
      ],
    });

    // Sprint S1.3 — auto-sync exam_window CalendarDate rows when exam dates set on create.
    // Best-effort, idempotent. Term row is source of truth; failures here log but don't
    // fail the create (the next term update will re-sync from authoritative state).
    let createWarnings: HolidayOverlapWarning[] = [];
    if (createDto.examStartDate !== undefined && createDto.examEndDate !== undefined) {
      await this.syncExamWindowEvents(
        schoolId,
        yearId,
        termId,
        createDto.name,
        undefined,
        undefined,
        createDto.examStartDate,
        createDto.examEndDate,
        context,
      );
      // Sprint S2.1 — detect holiday overlaps within the exam window. Non-blocking;
      // operator may legitimately schedule make-up exams on traditional holidays.
      createWarnings = await this.findHolidayOverlaps(
        schoolId,
        yearId,
        createDto.examStartDate,
        createDto.examEndDate,
        context,
      );
    }

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

    const baseResponse = this.toGradingPeriodResponse(period);
    return createWarnings.length > 0
      ? { ...baseResponse, warnings: createWarnings }
      : baseResponse;
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
  ): Promise<GradingPeriodWithWarnings> {
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

    // Sprint S1.2 — exam window write path.
    // Validate against the EFFECTIVE term range after applying any startDate/
    // endDate change in this same PATCH (so an operator can move a term and its
    // exam window together in one request). Each field uses sentinel handling:
    //   - present in DTO with a value → SET to that value
    //   - present in DTO with explicit null/empty → CLEAR (REMOVE attribute)
    //   - absent from DTO → leave existing value untouched
    // Zod allows undefined+optional in the schema; we model "clear" as the
    // string '' (since DDB strings can't be empty, REMOVE is the right op).
    const effectiveStart = updateDto.startDate ?? period.startDate;
    const effectiveEnd = updateDto.endDate ?? period.endDate;
    const examChanges: { field: string; oldValue: any; newValue: any }[] = [];

    if (updateDto.examStartDate !== undefined || updateDto.examEndDate !== undefined) {
      // Build effective exam window honoring partial-update semantics
      const effectiveExamStart =
        updateDto.examStartDate !== undefined ? updateDto.examStartDate : period.examStartDate;
      const effectiveExamEnd =
        updateDto.examEndDate !== undefined ? updateDto.examEndDate : period.examEndDate;

      this.validateExamDateRange(
        effectiveStart,
        effectiveEnd,
        effectiveExamStart,
        effectiveExamEnd,
      );
    }

    if (updateDto.examStartDate !== undefined && updateDto.examStartDate !== period.examStartDate) {
      updates.push('examStartDate = :examStartDate');
      values[':examStartDate'] = updateDto.examStartDate;
      examChanges.push({
        field: 'examStartDate',
        oldValue: period.examStartDate ?? null,
        newValue: updateDto.examStartDate,
      });
    }
    if (updateDto.examEndDate !== undefined && updateDto.examEndDate !== period.examEndDate) {
      updates.push('examEndDate = :examEndDate');
      values[':examEndDate'] = updateDto.examEndDate;
      examChanges.push({
        field: 'examEndDate',
        oldValue: period.examEndDate ?? null,
        newValue: updateDto.examEndDate,
      });
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

    // Sprint S1.2 — emit audit on exam-date change. We isolate exam-date
    // changes from other field changes so downstream consumers (S1.3
    // auto-sync, future analytics) can filter cleanly on
    // `targetEntity=GRADING_PERIOD AND action=exam_dates_updated`.
    if (examChanges.length > 0) {
      await this.auditedWrite.emit(context, {
        schoolId,
        targetEntity: 'GRADING_PERIOD',
        targetEntityId: termId,
        action: 'exam_dates_updated',
        changes: examChanges,
      });

      // Sprint S1.3 — auto-sync CalendarDate rows to match the new exam window.
      // Computes set diff between old and new ranges; only touches dates that
      // changed. Preserves operator-added events on the same dates (filters by
      // sourceTermId). Best-effort: failure does not roll back the term update.
      await this.syncExamWindowEvents(
        schoolId,
        yearId,
        termId,
        updatedPeriod.name,
        period.examStartDate,
        period.examEndDate,
        updatedPeriod.examStartDate,
        updatedPeriod.examEndDate,
        context,
      );
    }

    // Sprint S2.1 — detect holiday overlaps after exam dates change.
    // Returns even on no-op exam-date PUTs because the operator may have
    // changed the term's date range while the exam dates remain (and that
    // shift could move the exam window onto a holiday).
    let updateWarnings: HolidayOverlapWarning[] = [];
    if (updatedPeriod.examStartDate && updatedPeriod.examEndDate) {
      updateWarnings = await this.findHolidayOverlaps(
        schoolId,
        yearId,
        updatedPeriod.examStartDate,
        updatedPeriod.examEndDate,
        context,
      );
    }

    const baseResponse = this.toGradingPeriodResponse(updatedPeriod);
    return updateWarnings.length > 0
      ? { ...baseResponse, warnings: updateWarnings }
      : baseResponse;
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
      examStartDate: period.examStartDate,
      examEndDate: period.examEndDate,
      isActive: period.isActive,
      academicSessionId: period.academicSessionId,
      createdAt: period.createdAt,
      updatedAt: period.updatedAt,
    };
  }

  /**
   * Sprint S1.3 — sync exam_window CalendarDate rows to mirror a term's
   * exam window. Idempotent: re-running with unchanged ranges = no-op.
   *
   * Invariants:
   *   1. Term row is the source of truth. CalendarDate rows are derived state.
   *   2. Only events authored by THIS termId are touched (filtered by
   *      `event.sourceTermId === termId`). Operator-added events on the same
   *      date are preserved. Events from sibling terms (overlapping exam
   *      windows from a different term) are preserved.
   *   3. Best-effort: failure to sync logs an error but does NOT throw to the
   *      caller — the term mutation has already committed and we won't roll
   *      it back. The next term update will re-sync from authoritative state.
   *   4. Includes weekends in the range (operator can manually remove specific
   *      dates afterward; backend doesn't second-guess the operator's range).
   *
   * @param oldExamStart undefined ⇒ no prior window (newly setting)
   * @param oldExamEnd   undefined ⇒ no prior window (newly setting)
   * @param newExamStart undefined ⇒ clearing the window (operator removed it)
   * @param newExamEnd   undefined ⇒ clearing the window
   */
  /**
   * Sprint S2.1 — scan the [examStart, examEnd] date range for existing
   * CalendarDate rows that carry a `holiday` event, and return a list of
   * warnings. Closes V1 finding F-V1-S2-COLLISION where an operator could
   * schedule an exam on Phulpati (Dashain) with no system feedback.
   *
   * Invariants:
   *   - NEVER throws. Read-only query; failures log and return empty array.
   *   - Only checks rows that ALREADY exist in DDB at the time of the call.
   *     Holidays added AFTER this call won't surface — that's an acceptable
   *     race because the auto-sync runs before this helper, so the calendar
   *     state read here is the same state the operator committed to.
   *   - Operator-added events (eventType=holiday WITHOUT sourceTermId) and
   *     seed-loaded holidays both trigger warnings — both are "real" holidays
   *     from the operator's perspective.
   *   - Excludes exam_window events from the holiday list (since the auto-sync
   *     just wrote them; they're not pre-existing holidays).
   */
  private async findHolidayOverlaps(
    schoolId: string,
    academicYearId: string,
    examStart: string,
    examEnd: string,
    context: RequestContext,
  ): Promise<HolidayOverlapWarning[]> {
    try {
      const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
      const warnings: HolidayOverlapWarning[] = [];

      // Enumerate dates and read each CalendarDate row directly (small range,
      // typically 5-7 days). Avoids a range scan + filter on the calendar GSI.
      const cursor = new Date(examStart + 'T12:00:00Z');
      const stop = new Date(examEnd + 'T12:00:00Z');
      while (cursor <= stop) {
        const date = cursor.toISOString().split('T')[0];
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        const row = await this.dynamoDBClient.getItem<CalendarDate>(
          client,
          context.tenantId,
          CalendarDateKeyBuilder.calendarDate(schoolId, date),
        );
        if (!row) continue;
        const holidayEvent = (row.calendarEvents ?? []).find(
          (e: CalendarEvent) => e.eventType === 'holiday',
        );
        if (holidayEvent) {
          warnings.push({
            code: 'EXAM_OVERLAPS_HOLIDAY',
            date,
            holidayName: holidayEvent.description ?? 'Holiday',
          });
        }
      }
      if (warnings.length > 0) {
        this.logger.log(
          `Holiday-exam overlap detected: ${warnings.length} date(s) in range ` +
          `${examStart}..${examEnd}: [${warnings.map(w => w.date).join(', ')}]`,
        );
      }
      return warnings;
    } catch (err) {
      // Non-blocking: warnings are advisory. Log and continue with empty.
      this.logger.warn(
        `findHolidayOverlaps failed for ${examStart}..${examEnd}: ${(err as Error).message}`,
      );
      return [];
    }
  }

  private async syncExamWindowEvents(
    schoolId: string,
    academicYearId: string,
    termId: string,
    termName: string,
    oldExamStart: string | undefined,
    oldExamEnd: string | undefined,
    newExamStart: string | undefined,
    newExamEnd: string | undefined,
    context: RequestContext,
  ): Promise<{ added: number; removed: number; skipped: number }> {
    const enumerateRange = (start?: string, end?: string): string[] => {
      if (!start || !end) return [];
      const out: string[] = [];
      const cursor = new Date(start + 'T12:00:00Z');
      const stop = new Date(end + 'T12:00:00Z');
      while (cursor <= stop) {
        out.push(cursor.toISOString().split('T')[0]);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      return out;
    };

    const oldDates = new Set<string>(enumerateRange(oldExamStart, oldExamEnd));
    const newDates = new Set<string>(enumerateRange(newExamStart, newExamEnd));
    const toAdd = [...newDates].filter(d => !oldDates.has(d));
    const toRemove = [...oldDates].filter(d => !newDates.has(d));

    if (toAdd.length === 0 && toRemove.length === 0) {
      return { added: 0, removed: 0, skipped: 0 };
    }

    let added = 0;
    let removed = 0;
    let skipped = 0;

    try {
      const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

      // === REMOVALS ===
      // For each date no longer in the window, strip the exam_window event
      // tagged with our termId. If the row's only remaining event was ours,
      // delete the row (it was auto-created by us). Otherwise putItem the
      // updated row.
      for (const date of toRemove) {
        try {
          const existing = await this.dynamoDBClient.getItem<CalendarDate>(
            client,
            context.tenantId,
            CalendarDateKeyBuilder.calendarDate(schoolId, date),
          );
          if (!existing) {
            skipped++;
            continue;
          }
          const filteredEvents = existing.calendarEvents.filter(
            e => !(e.eventType === 'exam_window' && e.sourceTermId === termId),
          );
          if (filteredEvents.length === existing.calendarEvents.length) {
            // Our event was already gone — idempotent no-op
            skipped++;
            continue;
          }
          if (filteredEvents.length === 0) {
            // Row was auto-created by us and has no other events — delete it.
            await this.dynamoDBClient.deleteItem(
              client,
              context.tenantId,
              CalendarDateKeyBuilder.calendarDate(schoolId, date),
            );
          } else {
            // Other events remain (operator-added or sibling term) — preserve them
            existing.calendarEvents = filteredEvents;
            existing.updatedAt = new Date().toISOString();
            existing.updatedBy = context.userId;
            await this.dynamoDBClient.putItem(client, existing);
          }
          removed++;
        } catch (err) {
          this.logger.warn(
            `Failed to remove exam_window from ${date} (term ${termId}): ${(err as Error).message}`,
          );
        }
      }

      // === ADDITIONS ===
      // For each new date, append our exam_window event if not already present.
      // If the row doesn't exist, create it with this single event.
      for (const date of toAdd) {
        try {
          const existing = await this.dynamoDBClient.getItem<CalendarDate>(
            client,
            context.tenantId,
            CalendarDateKeyBuilder.calendarDate(schoolId, date),
          );
          const examEvent: CalendarEvent = {
            eventType: 'exam_window',
            description: `${termName} exam`,
            isAllDay: true,
            sourceTermId: termId,
            category: 'assessment',
          };

          if (!existing) {
            const now = new Date().toISOString();
            const dayOfWeek = getDayOfWeek(date);
            const newRow = createCalendarDateEntity(context.tenantId, schoolId, {
              date,
              academicYearId,
              calendarEvents: [examEvent],
              isInstructionalDay: true, // exam days are still instructional
              isHoliday: false,
              isWeekend: isWeekendDate(date),
              dayOfWeek,
              gradingPeriodId: termId,
              gradingPeriodName: termName,
              createdAt: now,
              createdBy: context.userId,
              updatedAt: now,
              updatedBy: context.userId,
              version: 1,
            });
            await this.dynamoDBClient.putItem(client, newRow);
            added++;
          } else {
            // Idempotency — skip if our event is already on this date
            const alreadyHasOurs = existing.calendarEvents.some(
              e => e.eventType === 'exam_window' && e.sourceTermId === termId,
            );
            if (alreadyHasOurs) {
              skipped++;
              continue;
            }
            existing.calendarEvents.push(examEvent);
            existing.updatedAt = new Date().toISOString();
            existing.updatedBy = context.userId;
            // Preserve gradingPeriodId if missing — likely the operator manually
            // created this row without linking the term
            if (!existing.gradingPeriodId) {
              existing.gradingPeriodId = termId;
              existing.gradingPeriodName = termName;
            }
            await this.dynamoDBClient.putItem(client, existing);
            added++;
          }
        } catch (err) {
          this.logger.warn(
            `Failed to add exam_window to ${date} (term ${termId}): ${(err as Error).message}`,
          );
        }
      }

      this.logger.log(
        `Exam-window sync for term ${termId} (${termName}): added=${added} removed=${removed} skipped=${skipped}`,
      );
    } catch (err) {
      // Catastrophic failure (e.g. DDB client unavailable). Term row already
      // committed; log loudly so on-call can investigate. The next term update
      // will retry the sync.
      this.logger.error(
        `Exam-window sync FAILED for term ${termId} (${termName}). ` +
        `Term row is correct but CalendarDate rows may be stale until next term update. ` +
        `error=${(err as Error).message}`,
      );
    }

    return { added, removed, skipped };
  }

  /**
   * Sprint S1.2 — assert the exam window is inside the term range.
   *
   * Invariants enforced:
   *   - If examStartDate is set, it must be >= termStart.
   *   - If examEndDate is set, it must be <= termEnd.
   *   - If both are set, examStart <= examEnd.
   *   - If only one is set, it must still respect the term bound on that side.
   *     (We allow asymmetric configurations — operator might enter the start
   *      first and the end later.)
   *
   * ISO YYYY-MM-DD strings sort lexicographically, so string comparison is
   * correct for date math here.
   *
   * Throws BadRequestException with stable `errorCode: EXAM_DATES_OUT_OF_TERM_RANGE`
   * to give the frontend a hook for localized error messages.
   */
  private validateExamDateRange(
    termStart: string,
    termEnd: string,
    examStart: string | undefined,
    examEnd: string | undefined,
  ): void {
    if (examStart === undefined && examEnd === undefined) return;

    const violations: string[] = [];
    if (examStart !== undefined && examStart < termStart) {
      violations.push(`examStartDate (${examStart}) is before term startDate (${termStart})`);
    }
    if (examEnd !== undefined && examEnd > termEnd) {
      violations.push(`examEndDate (${examEnd}) is after term endDate (${termEnd})`);
    }
    if (examStart !== undefined && examEnd !== undefined && examEnd < examStart) {
      violations.push(`examEndDate (${examEnd}) is before examStartDate (${examStart})`);
    }

    if (violations.length > 0) {
      throw new BadRequestException({
        message:
          `Exam window is not inside the term range. ` +
          `Term: [${termStart} .. ${termEnd}]. Exam: [${examStart ?? '?'} .. ${examEnd ?? '?'}]. ` +
          violations.join('; ') + '.',
        errorCode: 'EXAM_DATES_OUT_OF_TERM_RANGE',
        details: {
          termStartDate: termStart,
          termEndDate: termEnd,
          examStartDate: examStart ?? null,
          examEndDate: examEnd ?? null,
          violations,
        },
      });
    }
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

