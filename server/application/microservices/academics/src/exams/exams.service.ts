/**
 * Exams Service — Sprint A.3.5 + A.3.8
 *
 * Term-end Exam CRUD + state-machine lifecycle. The Exam entity is the
 * Ed-Fi `Assessment` analogue (Core; archetype-blind). Per-archetype
 * narrowing of valid `examType` values happens at validation time via
 * `archetypeDefaults[archetype].examPattern` (read from TenantMetadataReader).
 *
 * @see docs/pilot-greenlight/a3-sprint-plan.md §4 A.3.5 + A.3.8
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { TenantMetadataReaderService } from '../common/services/tenant-metadata-reader.service';
import {
  Exam,
  createExamEntity,
  refreshExamGsi2sk,
} from '../common/entities/exam.entity';
import {
  EntityKeyBuilder,
  GSIKeyBuilder,
  RequestContext,
  PaginatedResult,
} from '../common/entities/base.entity';
import {
  CreateExamDto,
  UpdateExamDto,
  ExamResponseDto,
  ExamStatusTransitionDto,
  getArchetypeDefaults,
  examPatternKeySchema,
  type ExamPatternKey,
} from '@aibrains/shared-types';
import { examEntityToDto } from '../common/mappers/exam.mapper';
import {
  validateTransition,
} from './exam-state-machine';

@Injectable()
export class ExamsService {
  private readonly logger = new Logger(ExamsService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: AcademicsEventsService,
    private readonly identityClient: IdentityClientService,
    private readonly tenantMetadataReader: TenantMetadataReaderService,
  ) {}

  // ============================================================================
  // CREATE
  // ============================================================================

  async createExam(dto: CreateExamDto, context: RequestContext): Promise<ExamResponseDto> {
    this.logger.debug(`createExam: schoolId=${dto.schoolId} examType=${dto.examType}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Validate school exists
    const schoolExists = await this.identityClient.validateSchoolExists(
      dto.schoolId,
      { userId: context.userId, jwtToken: context.jwtToken, tenantId: context.tenantId },
    );
    if (!schoolExists) {
      throw new NotFoundException(`School ${dto.schoolId} not found`);
    }

    // Validate examType ∈ archetypeDefaults[archetype].examPattern.
    // Archetype-blind in service code; the per-archetype narrowing is
    // data-driven from archetypeDefaults table.
    await this.assertExamTypeAllowedForArchetype(context.tenantId, dto.examType);

    const now = new Date().toISOString();
    const examId = uuid();

    const exam = createExamEntity(context.tenantId, examId, dto.schoolId, {
      examName: dto.examName,
      academicYearId: dto.academicYearId,
      termId: dto.termId,
      examType: dto.examType,
      startDate: dto.startDate,
      endDate: dto.endDate,
      status: 'draft',
      gradeLevels: dto.gradeLevels,
      description: dto.description,
      isActive: true,
      createdAt: now,
      createdBy: context.userId,
      updatedAt: now,
      updatedBy: context.userId,
      version: 1,
    });

    await this.dynamoDBClient.putItem(client, exam);

    this.eventsService.publishExamCreated(
      context.tenantId,
      examId,
      dto.schoolId,
      dto.academicYearId,
      dto.termId,
      dto.examName,
      dto.examType,
    ).catch(err => this.logger.error('Failed to publish ExamCreated event', err));

    return examEntityToDto(exam);
  }

  // ============================================================================
  // READ
  // ============================================================================

  async getExam(examId: string, schoolId: string, context: RequestContext): Promise<ExamResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const exam = await this.dynamoDBClient.getItem<Exam>(
      client,
      context.tenantId,
      EntityKeyBuilder.exam(schoolId, examId),
    );
    if (!exam) {
      throw new NotFoundException(`Exam ${examId} not found`);
    }
    return examEntityToDto(exam);
  }

  async listExams(
    schoolId: string,
    context: RequestContext,
    limit: number = 50,
    cursor?: string,
    filters?: {
      academicYearId?: string;
      termId?: string;
      examType?: string;
      status?: string;
      isActive?: boolean;
    },
  ): Promise<PaginatedResult<ExamResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    let exclusiveStartKey: Record<string, any> | undefined;
    if (cursor) {
      try {
        exclusiveStartKey = JSON.parse(Buffer.from(cursor, 'base64').toString());
      } catch {
        // Invalid cursor, ignore
      }
    }

    const filterParts: string[] = [];
    const expressionValues: Record<string, any> = {};

    if (filters?.academicYearId) {
      filterParts.push('academicYearId = :academicYearId');
      expressionValues[':academicYearId'] = filters.academicYearId;
    }
    if (filters?.termId) {
      filterParts.push('termId = :termId');
      expressionValues[':termId'] = filters.termId;
    }
    if (filters?.examType) {
      filterParts.push('examType = :examType');
      expressionValues[':examType'] = filters.examType;
    }
    if (filters?.status) {
      filterParts.push('#status = :status');
      expressionValues[':status'] = filters.status;
    }
    if (filters?.isActive !== undefined) {
      filterParts.push('isActive = :isActive');
      expressionValues[':isActive'] = filters.isActive;
    }

    const expressionNames: Record<string, string> | undefined = filters?.status
      ? { '#status': 'status' }
      : undefined;

    const result = await this.dynamoDBClient.queryGSI<Exam>(
      client,
      'GSI1',
      `tenant#${context.tenantId}#school#${schoolId}`,
      'exam#',
      'begins_with',
      filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
      Object.keys(expressionValues).length > 0 ? expressionValues : undefined,
      expressionNames,
      limit,
      true,
      exclusiveStartKey,
    );

    return {
      items: result.items.map(examEntityToDto),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  // ============================================================================
  // UPDATE (generic PATCH; status transitions use transitionStatus)
  // ============================================================================

  async updateExam(
    examId: string,
    schoolId: string,
    dto: UpdateExamDto,
    context: RequestContext,
  ): Promise<ExamResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.exam(schoolId, examId);

    const existing = await this.dynamoDBClient.getItem<Exam>(
      client,
      context.tenantId,
      entityKey,
    );
    if (!existing) {
      throw new NotFoundException(`Exam ${examId} not found`);
    }

    // examType validation if changed
    if (dto.examType && dto.examType !== existing.examType) {
      await this.assertExamTypeAllowedForArchetype(context.tenantId, dto.examType);
    }

    // ELS.1 — gradeLevels are mutable only while exam.status === 'draft',
    // mirroring examType. Once scheduled or later, exam-courses and scores
    // are bound to the existing grade scope; changing it would invalidate
    // already-attached subjects/scores. Compare value-by-value so an
    // idempotent PATCH carrying the existing array doesn't 409 spuriously.
    if (dto.gradeLevels !== undefined && existing.status !== 'draft') {
      const prev = existing.gradeLevels ?? [];
      const next = dto.gradeLevels;
      const unchanged =
        prev.length === next.length && prev.every((v, i) => v === next[i]);
      if (!unchanged) {
        throw new ConflictException({
          errorCode: 'EXAM_LOCKED',
          message: `gradeLevels cannot be changed while exam.status=${existing.status} (mutable only in draft)`,
          currentStatus: existing.status,
        });
      }
    }

    // startDate/endDate consistency: combine new+existing
    const startDate = dto.startDate ?? existing.startDate;
    const endDate = dto.endDate ?? existing.endDate;
    if (new Date(startDate).getTime() > new Date(endDate).getTime()) {
      throw new BadRequestException('startDate must be on or before endDate');
    }

    const now = new Date().toISOString();
    const updateParts: string[] = [
      'updatedAt = :updatedAt',
      'updatedBy = :updatedBy',
      'version = version + :inc',
    ];
    const expressionValues: Record<string, any> = {
      ':updatedAt': now,
      ':updatedBy': context.userId,
      ':inc': 1,
      ':currentVersion': existing.version,
    };

    const fields: Array<keyof UpdateExamDto> = ['examName', 'examType', 'gradeLevels', 'startDate', 'endDate', 'description'];
    for (const f of fields) {
      const v = dto[f];
      if (v !== undefined) {
        updateParts.push(`${f} = :${f}`);
        expressionValues[`:${f}`] = v;
      }
    }

    // Refresh GSI2SK if startDate changed (status unchanged on generic PATCH).
    if (dto.startDate) {
      updateParts.push('gsi2sk = :gsi2sk');
      expressionValues[':gsi2sk'] = refreshExamGsi2sk(existing.status, dto.startDate);
    }

    const updated = await this.dynamoDBClient.updateItem<Exam>(
      client,
      context.tenantId,
      entityKey,
      `SET ${updateParts.join(', ')}`,
      expressionValues,
      'version = :currentVersion',
    );

    this.eventsService.publishExamUpdated(
      context.tenantId,
      examId,
      schoolId,
      Object.keys(dto),
    ).catch(err => this.logger.error('Failed to publish ExamUpdated event', err));

    return examEntityToDto(updated);
  }

  // ============================================================================
  // STATUS TRANSITION (A.3.8)
  // ============================================================================

  async transitionStatus(
    examId: string,
    schoolId: string,
    dto: ExamStatusTransitionDto,
    context: RequestContext,
  ): Promise<ExamResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.exam(schoolId, examId);

    const existing = await this.dynamoDBClient.getItem<Exam>(
      client,
      context.tenantId,
      entityKey,
    );
    if (!existing) {
      throw new NotFoundException(`Exam ${examId} not found`);
    }

    const result = validateTransition(existing.status, dto.targetStatus);

    if (result.isNoOp) {
      // Idempotent: target === current. No write, no audit, no event.
      this.logger.log(`transitionStatus: no-op (already at ${existing.status}) examId=${examId}`);
      return examEntityToDto(existing);
    }

    if (!result.valid) {
      throw new ConflictException({
        errorCode: 'EXAM_STATE_INVALID_TRANSITION',
        message: result.reason,
        currentStatus: existing.status,
        targetStatus: dto.targetStatus,
      });
    }

    const now = new Date().toISOString();
    const updated = await this.dynamoDBClient.updateItem<Exam>(
      client,
      context.tenantId,
      entityKey,
      'SET #status = :status, gsi2sk = :gsi2sk, updatedAt = :updatedAt, updatedBy = :updatedBy, version = version + :inc',
      {
        ':status': dto.targetStatus,
        ':gsi2sk': refreshExamGsi2sk(dto.targetStatus, existing.startDate),
        ':updatedAt': now,
        ':updatedBy': context.userId,
        ':inc': 1,
        ':currentVersion': existing.version,
      },
      'version = :currentVersion',
      { '#status': 'status' },
    );

    this.eventsService.publishExamStatusTransitioned(
      context.tenantId,
      examId,
      schoolId,
      existing.status,
      dto.targetStatus,
      dto.notes,
    ).catch(err => this.logger.error('Failed to publish ExamStatusTransitioned event', err));

    return examEntityToDto(updated);
  }

  // ============================================================================
  // DELETE (soft)
  // ============================================================================

  async deleteExam(examId: string, schoolId: string, context: RequestContext): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.exam(schoolId, examId);

    const existing = await this.dynamoDBClient.getItem<Exam>(
      client,
      context.tenantId,
      entityKey,
    );
    if (!existing) {
      throw new NotFoundException(`Exam ${examId} not found`);
    }

    const now = new Date().toISOString();
    await this.dynamoDBClient.updateItem<Exam>(
      client,
      context.tenantId,
      entityKey,
      'SET isActive = :isActive, updatedAt = :updatedAt, updatedBy = :updatedBy, version = version + :inc',
      {
        ':isActive': false,
        ':updatedAt': now,
        ':updatedBy': context.userId,
        ':inc': 1,
      },
    );

    this.eventsService.publishExamDeleted(
      context.tenantId,
      examId,
      schoolId,
    ).catch(err => this.logger.error('Failed to publish ExamDeleted event', err));
  }

  /**
   * GB2.5 — the exam types allowed for the tenant's archetype, for the setup
   * checklist to surface eagerly (the create path already rejects out-of-pattern
   * types via `assertExamTypeAllowedForArchetype`). When the archetype can't be
   * resolved, returns the full `ExamPatternKey` enum — permissive, matching the
   * create-path fallback.
   */
  async getExamPattern(
    context: RequestContext,
  ): Promise<{ archetype: string | null; examPattern: ExamPatternKey[] }> {
    let archetype: string | undefined;
    try {
      archetype = await this.tenantMetadataReader.getArchetype(context.tenantId);
    } catch (err: any) {
      // Infra/permission failure (a missing row returns undefined, not a throw).
      this.logger.error(
        `getExamPattern: identity-table read FAILED for ${context.tenantId} ` +
          `(check academics task role GetItem on the identity table); returning full enum. err=${err?.message ?? err}`,
      );
      return { archetype: null, examPattern: [...examPatternKeySchema.options] };
    }
    if (archetype) {
      try {
        return { archetype, examPattern: [...getArchetypeDefaults(archetype).examPattern] };
      } catch {
        // archetype value isn't in the defaults table (e.g. a reserved enum) —
        // a data condition, not infra; fall through to the permissive full enum.
        this.logger.warn(`getExamPattern: no ArchetypeDefaults for ${archetype}; returning full enum`);
      }
    }
    return { archetype: null, examPattern: [...examPatternKeySchema.options] };
  }

  // ============================================================================
  // INTERNAL — archetype-driven examType narrowing
  // ============================================================================

  /**
   * Asserts examType is allowed for the tenant's archetype. Reads
   * archetypeDefaults[archetype].examPattern at runtime; falls back to
   * permissive (accept any examPatternKey enum value) if tenant metadata
   * cannot be resolved (defensive — same pattern as D.1.3 lazy-seed).
   */
  private async assertExamTypeAllowedForArchetype(
    tenantId: string,
    examType: ExamPatternKey,
  ): Promise<void> {
    let archetype: string | undefined;
    try {
      archetype = await this.tenantMetadataReader.getArchetype(tenantId);
    } catch (err: any) {
      // Infra/permission failure (a missing row returns undefined, not a throw):
      // log loudly, then fail OPEN (accept any type) so a transient identity-table
      // issue doesn't block exam creation.
      this.logger.error(
        `assertExamTypeAllowedForArchetype: identity-table read FAILED for ${tenantId} ` +
          `(check academics task role GetItem on the identity table); accepting any examType. err=${err?.message ?? err}`,
      );
      return;
    }
    if (!archetype) {
      this.logger.warn(`assertExamTypeAllowedForArchetype: tenant ${tenantId} has no archetype; accepting any examType`);
      return;
    }
    let defaults;
    try {
      defaults = getArchetypeDefaults(archetype);
    } catch {
      this.logger.warn(`assertExamTypeAllowedForArchetype: no ArchetypeDefaults for ${archetype}; accepting`);
      return;
    }
    if (!defaults.examPattern.includes(examType)) {
      throw new BadRequestException({
        errorCode: 'EXAM_TYPE_NOT_ALLOWED_FOR_ARCHETYPE',
        message: `examType '${examType}' not in archetype ${archetype} pattern: ${defaults.examPattern.join(', ')}`,
        archetype,
        allowedExamTypes: defaults.examPattern,
      });
    }
  }
}
