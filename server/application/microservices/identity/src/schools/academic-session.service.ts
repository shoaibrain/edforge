/**
 * Academic Session Service - AcademicSession CRUD
 *
 * Ed-Fi: Session models a term/semester within an academic year.
 * Named AcademicSession to avoid collision with auth Session entity.
 */

import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  forwardRef,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import {
  AcademicSession,
  AcademicSessionKeyBuilder,
  createAcademicSessionEntity,
} from '../common/entities/academic-session.entity';
import { RequestContext, PaginatedResult } from '../common/entities/base.entity';
import { AcademicYearsService } from '../academic-years/academic-years.service';
import type {
  CreateAcademicSessionDto,
  UpdateAcademicSessionDto,
  AcademicSessionResponseDto,
  TermDescriptor,
  TermType,
} from '@aibrains/shared-types';

// =============================================================================
// Helpers — map AcademicSession.termDescriptor to GradingPeriod.{sequence,termType}
// =============================================================================
//
// V1 PABSON archetype pairs every AcademicSession 1:1 with a GradingPeriod (see
// `createSession` below + the C4-followup retro in
// docs/saraswati-session-pair-fix.md). These two helpers map a Session's
// operator-facing `termDescriptor` to the GradingPeriod's required `sequence`
// and `termType` fields. Kept local to this service so the mapping is colocated
// with its only caller — if we ever need it elsewhere, lift to shared-types.

/**
 * Map `termDescriptor` to a stable 1-based `sequence` for the paired
 * GradingPeriod. Quarters get 1..4; semesters get 1..3 (fall, spring, summer);
 * year_round is treated as the single sequence-1 period.
 */
function termDescriptorToSequence(d: TermDescriptor): number {
  switch (d) {
    case 'first_quarter':
      return 1;
    case 'second_quarter':
      return 2;
    case 'third_quarter':
      return 3;
    case 'fourth_quarter':
      return 4;
    case 'fall_semester':
      return 1;
    case 'spring_semester':
      return 2;
    case 'summer':
      return 3;
    case 'year_round':
      return 1;
  }
}

/**
 * Map `termDescriptor` to the GradingPeriod's required `termType`. The two
 * concepts overlap heavily in Ed-Fi v6 — termDescriptor is the operator-facing
 * label, termType is the structural class. Quarters → 'quarter', semesters/
 * summer → 'semester', year_round → 'year'. There is no PABSON-specific
 * 'trimester' descriptor in V1; if added later, extend here.
 */
function termDescriptorToTermType(d: TermDescriptor): TermType {
  switch (d) {
    case 'first_quarter':
    case 'second_quarter':
    case 'third_quarter':
    case 'fourth_quarter':
      return 'quarter';
    case 'fall_semester':
    case 'spring_semester':
    case 'summer':
      return 'semester';
    case 'year_round':
      return 'year';
  }
}

@Injectable()
export class AcademicSessionService {
  private readonly logger = new Logger(AcademicSessionService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    @Inject(forwardRef(() => AcademicYearsService))
    private readonly academicYearsService: AcademicYearsService,
  ) {}

  /**
   * Create a new academic session
   */
  async createSession(
    schoolId: string,
    createDto: CreateAcademicSessionDto,
    context: RequestContext
  ): Promise<AcademicSessionResponseDto> {
    const now = new Date().toISOString();
    const sessionId = uuid();

    // Validate academic year exists and dates are within year bounds
    const year = await this.academicYearsService.getAcademicYear(
      schoolId,
      createDto.academicYearId,
      context
    );

    if (createDto.beginDate < year.startDate || createDto.endDate > year.endDate) {
      throw new BadRequestException(
        `Session dates must fall within academic year (${year.startDate} to ${year.endDate})`
      );
    }

    // Check for overlapping sessions
    await this.validateNoOverlap(schoolId, createDto.beginDate, createDto.endDate, context);

    const session = createAcademicSessionEntity(
      context.tenantId,
      schoolId,
      sessionId,
      {
        academicYearId: createDto.academicYearId,
        sessionName: createDto.sessionName,
        beginDate: createDto.beginDate,
        endDate: createDto.endDate,
        totalInstructionalDays: 0,  // Will be computed after calendar dates exist
        termDescriptor: createDto.termDescriptor,
        gradingPeriodIds: createDto.gradingPeriodIds,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    await this.dynamoDBClient.putItem(client, session);

    this.logger.log(`Academic session created: ${session.sessionName} (${sessionId}) for school ${schoolId}`);

    // Sprint C4-followup (Saraswati activation block, 2026-05-18) — auto-pair
    // a GradingPeriod with the new Session. Reason: the activation requirement
    // check counts GradingPeriods (`entityType='TERM'`), NOT Sessions. Without
    // this pairing, the operator-driven UI path (PABSON 4-term template OR
    // manual session form) produces 4 SESSIONs but 0 TERMs and the school
    // cannot be activated. Pre-fix workaround was a hand-run seeder script
    // (`scripts/pilot-greenlight/seed-pilot-terms.ts`) that only engineers had
    // access to — that's the technical-debt this fix retires. Full retro:
    // docs/saraswati-session-pair-fix.md.
    //
    // Ed-Fi v6 model — Session and GradingPeriod are distinct entities with a
    // 1:N relationship (one Session can contain multiple GradingPeriods, e.g.
    // a US semester containing 3 six-week reporting periods). V1 PABSON
    // collapses this to 1:1 — each quarter is its own grading period. The
    // pairing here enforces that invariant. V2+ can layer multi-GP support on
    // top of this without changing the auto-create contract.
    //
    // Auto-pair semantics:
    //   - One GP per Session, same name/dates as the Session.
    //   - `sequence` and `termType` derived from `termDescriptor`.
    //   - `examStartDate`/`examEndDate` intentionally omitted — operator picks
    //     these later via the "Edit exam window" UI. Setting defaults here
    //     would write wrong exam_window CalendarDate rows the operator would
    //     have to undo manually.
    //   - Back-reference: GP.academicSessionId → Session.academicSessionId.
    //     The UI's pairing logic checks this direction first; the forward
    //     reference (Session.gradingPeriodIds) is omitted since the UI's
    //     fallback is the back-reference. Adding the forward reference would
    //     require a second putItem on the Session, doubling the write cost
    //     for no functional gain.
    //
    // Failure mode: if the GP write fails (rare — same tenant, same DDB), the
    // Session row exists alone. Recovery: operator can re-trigger by deleting
    // and re-creating the session, OR engineering can run a backfill script
    // mirroring the Saraswati one-off fix (see retro doc). The window for
    // failure is microseconds; activation requires all 4 GPs so a partial
    // state would surface immediately at the activation gate.
    try {
      await this.academicYearsService.createGradingPeriod(
        schoolId,
        createDto.academicYearId,
        {
          name: createDto.sessionName,
          termType: termDescriptorToTermType(createDto.termDescriptor),
          sequence: termDescriptorToSequence(createDto.termDescriptor),
          startDate: createDto.beginDate,
          endDate: createDto.endDate,
          academicSessionId: sessionId,
        },
        context,
      );
      this.logger.log(
        `Auto-paired GradingPeriod created for session ${sessionId} ` +
          `(termDescriptor=${createDto.termDescriptor})`,
      );
    } catch (err: any) {
      // Best-effort: log the failure but DON'T fail the session create. The
      // operator already has a usable Session; activation will fail loudly via
      // the existing `grading_periods < 4` requirement check if the GP didn't
      // land. Worst case is the same orphan state we're fixing — recovery is
      // straightforward (re-trigger or backfill). Failing the session create
      // would be worse: half-state where the Session DDB write succeeded but
      // we'd have to compensate-delete it on this error path.
      this.logger.error(
        `Auto-pair GradingPeriod failed for session ${sessionId}: ${err?.message ?? err}. ` +
          `Session exists; operator can re-create OR engineering can backfill via ` +
          `POST /schools/${schoolId}/academic-years/${createDto.academicYearId}/grading-periods.`,
      );
    }

    return this.toSessionResponse(session);
  }

  /**
   * Get academic session by ID
   */
  async getSession(
    schoolId: string,
    sessionId: string,
    context: RequestContext
  ): Promise<AcademicSessionResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const session = await this.dynamoDBClient.getItem<AcademicSession>(
      client,
      context.tenantId,
      AcademicSessionKeyBuilder.academicSession(schoolId, sessionId)
    );

    if (!session) {
      throw new NotFoundException('Academic session not found');
    }

    return this.toSessionResponse(session);
  }

  /**
   * List academic sessions for a school
   */
  async listSessions(
    schoolId: string,
    context: RequestContext,
    academicYearId?: string
  ): Promise<PaginatedResult<AcademicSessionResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const result = await this.dynamoDBClient.query<AcademicSession>(
      client,
      context.tenantId,
      AcademicSessionKeyBuilder.academicSessionsPrefix(schoolId),
      'entityType = :entityType',
      { ':entityType': 'ACADEMIC_SESSION' },
      undefined,
      50
    );

    let sessions = result.items;

    // Filter by academic year if provided
    if (academicYearId) {
      sessions = sessions.filter(s => s.academicYearId === academicYearId);
    }

    // Sort by beginDate
    sessions.sort((a, b) => a.beginDate.localeCompare(b.beginDate));

    return {
      items: sessions.map(s => this.toSessionResponse(s)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Update academic session
   */
  async updateSession(
    schoolId: string,
    sessionId: string,
    updateDto: UpdateAcademicSessionDto,
    context: RequestContext
  ): Promise<AcademicSessionResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const session = await this.dynamoDBClient.getItem<AcademicSession>(
      client,
      context.tenantId,
      AcademicSessionKeyBuilder.academicSession(schoolId, sessionId)
    );

    if (!session) {
      throw new NotFoundException('Academic session not found');
    }

    // If dates are being updated, validate no overlap (excluding self)
    const newBeginDate = updateDto.beginDate || session.beginDate;
    const newEndDate = updateDto.endDate || session.endDate;

    if (updateDto.beginDate || updateDto.endDate) {
      // Validate within academic year
      const year = await this.academicYearsService.getAcademicYear(
        schoolId,
        session.academicYearId,
        context
      );

      if (newBeginDate < year.startDate || newEndDate > year.endDate) {
        throw new BadRequestException(
          `Session dates must fall within academic year (${year.startDate} to ${year.endDate})`
        );
      }

      await this.validateNoOverlap(schoolId, newBeginDate, newEndDate, context, sessionId);
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};

    if (updateDto.sessionName) {
      updates.push('sessionName = :sessionName');
      values[':sessionName'] = updateDto.sessionName;
    }
    if (updateDto.beginDate) {
      updates.push('beginDate = :beginDate');
      values[':beginDate'] = updateDto.beginDate;
    }
    if (updateDto.endDate) {
      updates.push('endDate = :endDate');
      values[':endDate'] = updateDto.endDate;
    }
    if (updateDto.termDescriptor) {
      updates.push('termDescriptor = :termDescriptor');
      values[':termDescriptor'] = updateDto.termDescriptor;
    }
    if (updateDto.gradingPeriodIds !== undefined) {
      updates.push('gradingPeriodIds = :gradingPeriodIds');
      values[':gradingPeriodIds'] = updateDto.gradingPeriodIds;
    }

    if (updates.length === 0) {
      return this.toSessionResponse(session);
    }

    updates.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;

    const updatedSession = await this.dynamoDBClient.updateItem<AcademicSession>(
      client,
      context.tenantId,
      AcademicSessionKeyBuilder.academicSession(schoolId, sessionId),
      `SET ${updates.join(', ')}`,
      values
    );

    this.logger.log(`Academic session updated: ${sessionId}`);

    return this.toSessionResponse(updatedSession);
  }

  /**
   * Delete academic session
   */
  async deleteSession(
    schoolId: string,
    sessionId: string,
    context: RequestContext
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const session = await this.dynamoDBClient.getItem<AcademicSession>(
      client,
      context.tenantId,
      AcademicSessionKeyBuilder.academicSession(schoolId, sessionId)
    );

    if (!session) {
      throw new NotFoundException('Academic session not found');
    }

    await this.dynamoDBClient.deleteItem(
      client,
      context.tenantId,
      AcademicSessionKeyBuilder.academicSession(schoolId, sessionId)
    );

    this.logger.log(`Academic session deleted: ${sessionId}`);
  }

  /**
   * Update total instructional days (computed from CalendarDates)
   */
  async updateInstructionalDays(
    schoolId: string,
    sessionId: string,
    totalInstructionalDays: number,
    context: RequestContext
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      AcademicSessionKeyBuilder.academicSession(schoolId, sessionId),
      'SET totalInstructionalDays = :days, updatedAt = :updatedAt',
      {
        ':days': totalInstructionalDays,
        ':updatedAt': new Date().toISOString(),
      }
    );
  }

  // ============================================
  // Validation Helpers
  // ============================================

  /**
   * Validate no overlap with existing sessions
   */
  private async validateNoOverlap(
    schoolId: string,
    beginDate: string,
    endDate: string,
    context: RequestContext,
    excludeSessionId?: string
  ): Promise<void> {
    const existing = await this.listSessions(schoolId, context);

    for (const session of existing.items) {
      if (excludeSessionId && session.academicSessionId === excludeSessionId) {
        continue;
      }

      // Check overlap: (newStart < existingEnd) && (newEnd > existingStart)
      if (beginDate < session.endDate && endDate > session.beginDate) {
        throw new ConflictException(
          `Session dates overlap with existing session "${session.sessionName}" (${session.beginDate} to ${session.endDate})`
        );
      }
    }
  }

  // ============================================
  // Response Mapper
  // ============================================

  private toSessionResponse(session: AcademicSession): AcademicSessionResponseDto {
    return {
      academicSessionId: session.academicSessionId,
      schoolId: session.schoolId,
      academicYearId: session.academicYearId,
      sessionName: session.sessionName,
      beginDate: session.beginDate,
      endDate: session.endDate,
      totalInstructionalDays: session.totalInstructionalDays,
      termDescriptor: session.termDescriptor,
      gradingPeriodIds: session.gradingPeriodIds,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }
}
