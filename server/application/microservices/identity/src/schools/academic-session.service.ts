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
} from '@aibrains/shared-types';

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
