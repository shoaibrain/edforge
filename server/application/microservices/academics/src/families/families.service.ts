/**
 * FamiliesService — EPIC-FB Sprint FB-1.3 / FB-1.4 / FB-1.5
 *
 * CRUD for the FamilyGroup entity plus member link/unlink and the
 * student-family view. Families are school-scoped (V1: same-school
 * families only, epic §3.1) and soft-deleted via `isActive` — deactivated
 * families are excluded from every read and `isActive` is never emitted
 * in response DTOs (P1d).
 *
 * **Single-family invariant (V1): a student belongs to at most one family.**
 * Enforced at link time by a GSI2 pre-check (gsi2pk = bare studentId,
 * gsi2sk begins_with 'FAMILY#') followed by a conditional put with
 * `attribute_not_exists(entityKey)` on the member row. See the residual-race
 * note on `addMember`.
 *
 * Audit: structured logger lines on every mutation (actor + target ids),
 * matching sibling-service practice. No EventBridge family events — the
 * epic's adversarial review dropped them as consumer-less (Appendix B #9);
 * FamiliesModule is therefore excluded from the module-wiring spec's
 * AcademicsEventsService write-path check.
 *
 * @see docs/family-billing/family-billing-agreements-epic.md §3.1
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import {
  FamilyEntity,
  FamilyMemberEntity,
  createFamilyEntity,
  createFamilyMemberEntity,
  familyGsi1sk,
} from '../common/entities/family.entity';
import { Student } from '../common/entities/student.entity';
import {
  EntityKeyBuilder,
  GSIKeyBuilder,
  RequestContext,
} from '../common/entities/base.entity';
import {
  familyEntityToDto,
  familyMemberEntityToDto,
} from '../common/mappers/family.mapper';
import type {
  FamilyResponseDto,
  FamilyMemberDto,
  StudentFamilyViewDto,
  CreateFamilyDto,
  UpdateFamilyDto,
  AddFamilyMemberDto,
} from '@aibrains/shared-types';

export interface ListFamiliesParams {
  /** Case-insensitive name-prefix filter (matched against gsi1sk uppercase). */
  namePrefix?: string;
  limit?: number;
  cursor?: string;
}

export interface FamilyListResponseDto {
  items: FamilyResponseDto[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
}

function isConditionalCheckFailed(err: unknown): boolean {
  return (err as { name?: string })?.name === 'ConditionalCheckFailedException';
}

@Injectable()
export class FamiliesService {
  private readonly logger = new Logger(FamiliesService.name);

  constructor(private readonly dynamoDBClient: DynamoDBClientService) {}

  // ============================================================================
  // FB-1.3 — CRUD
  // ============================================================================

  async createFamily(
    schoolId: string,
    dto: CreateFamilyDto,
    context: RequestContext,
  ): Promise<FamilyResponseDto> {
    this.logger.debug(`createFamily: entry, schoolId=${schoolId} name=${dto.name}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const familyId = uuid();
    const entity = createFamilyEntity(context.tenantId, familyId, schoolId, {
      name: dto.name,
      primaryContact: dto.primaryContact,
      notes: dto.notes,
      createdBy: context.userId,
    });

    await this.dynamoDBClient.putItem(client, entity, 'attribute_not_exists(entityKey)');

    this.logger.log(
      `Family created: familyId=${familyId} schoolId=${schoolId} by=${context.userId}`,
    );
    return familyEntityToDto(entity);
  }

  async getFamily(
    familyId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<FamilyResponseDto> {
    this.logger.debug(`getFamily: entry, familyId=${familyId} schoolId=${schoolId}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entity = await this.getActiveFamilyOrThrow(client, context.tenantId, familyId, schoolId);
    return familyEntityToDto(entity);
  }

  async listFamilies(
    schoolId: string,
    params: ListFamiliesParams,
    context: RequestContext,
  ): Promise<FamilyListResponseDto> {
    const { namePrefix, limit = 50, cursor } = params;
    this.logger.debug(
      `listFamilies: entry, schoolId=${schoolId} namePrefix=${namePrefix ?? '*'} limit=${limit}`,
    );
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    let exclusiveStartKey: Record<string, unknown> | undefined;
    if (cursor) {
      try {
        exclusiveStartKey = JSON.parse(Buffer.from(cursor, 'base64').toString());
      } catch {
        throw new BadRequestException('Invalid cursor');
      }
    }

    const skPrefix = namePrefix
      ? `FAMILY#${namePrefix.toUpperCase()}`
      : 'FAMILY#';

    const result = await this.dynamoDBClient.queryGSIFilled<FamilyEntity>(
      client,
      'GSI1',
      GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
      skPrefix,
      'begins_with',
      'isActive = :isActive',
      { ':isActive': true },
      undefined,
      limit,
      true,
      exclusiveStartKey,
    );

    return {
      items: result.items.map(familyEntityToDto),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  async updateFamily(
    familyId: string,
    schoolId: string,
    dto: UpdateFamilyDto,
    context: RequestContext,
  ): Promise<FamilyResponseDto> {
    this.logger.debug(
      `updateFamily: entry, familyId=${familyId} schoolId=${schoolId} fields=${Object.keys(dto).join(',')}`,
    );
    if (dto.name === undefined && dto.primaryContact === undefined && dto.notes === undefined) {
      throw new BadRequestException('Update body must contain at least one field');
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const existing = await this.getActiveFamilyOrThrow(client, context.tenantId, familyId, schoolId);

    const now = new Date().toISOString();
    const updateParts: string[] = [
      'updatedAt = :updatedAt',
      'updatedBy = :updatedBy',
      'version = version + :inc',
    ];
    const expressionValues: Record<string, unknown> = {
      ':updatedAt': now,
      ':updatedBy': context.userId,
      ':inc': 1,
      ':currentVersion': existing.version,
    };
    const expressionNames: Record<string, string> = {};

    if (dto.name !== undefined) {
      // `name` is a DDB reserved word — alias via #name. A name change must
      // also re-key gsi1sk (FAMILY#{NAME_UPPERCASE}) or prefix search drifts.
      updateParts.push('#name = :name', 'gsi1sk = :gsi1sk');
      expressionNames['#name'] = 'name';
      expressionValues[':name'] = dto.name;
      expressionValues[':gsi1sk'] = familyGsi1sk(dto.name);
    }
    if (dto.primaryContact !== undefined) {
      updateParts.push('primaryContact = :primaryContact');
      expressionValues[':primaryContact'] = dto.primaryContact;
    }
    if (dto.notes !== undefined) {
      updateParts.push('notes = :notes');
      expressionValues[':notes'] = dto.notes;
    }

    const updated = await this.dynamoDBClient.updateItem<FamilyEntity>(
      client,
      context.tenantId,
      EntityKeyBuilder.family(familyId),
      `SET ${updateParts.join(', ')}`,
      expressionValues,
      'version = :currentVersion',
      Object.keys(expressionNames).length > 0 ? expressionNames : undefined,
    );

    this.logger.log(
      `Family updated: familyId=${familyId} schoolId=${schoolId} fields=${Object.keys(dto).join(',')} by=${context.userId}`,
    );
    return familyEntityToDto(updated);
  }

  /**
   * Soft-delete: flips `isActive=false`. Member rows are retained — the
   * student-family view and the single-family invariant both treat members
   * of a deactivated family as unlinked. Idempotent: a second DELETE is a
   * no-op.
   */
  async deactivateFamily(
    familyId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<void> {
    this.logger.debug(`deactivateFamily: entry, familyId=${familyId} schoolId=${schoolId}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const existing = await this.getFamilyOrThrow(client, context.tenantId, familyId, schoolId);
    if (!existing.isActive) {
      this.logger.debug(
        `deactivateFamily: family ${familyId} is already inactive; idempotent no-op`,
      );
      return;
    }

    await this.dynamoDBClient.updateItem<FamilyEntity>(
      client,
      context.tenantId,
      EntityKeyBuilder.family(familyId),
      'SET isActive = :isActive, updatedAt = :updatedAt, updatedBy = :updatedBy, version = version + :inc',
      {
        ':isActive': false,
        ':updatedAt': new Date().toISOString(),
        ':updatedBy': context.userId,
        ':inc': 1,
        ':currentVersion': existing.version,
      },
      'version = :currentVersion',
    );

    this.logger.log(
      `Family deactivated: familyId=${familyId} schoolId=${schoolId} by=${context.userId}`,
    );
  }

  // ============================================================================
  // FB-1.4 — link / unlink
  // ============================================================================

  /**
   * Link a student into a family.
   *
   * Single-family invariant: GSI2 pre-check (any member row whose family is
   * still live → 409) + `attribute_not_exists(entityKey)` conditional put.
   * The residual race — two concurrent links to *different* families both
   * passing the pre-check — is accepted per epic §3.1: operator-driven
   * linking has no financial consequence and is operator-repairable
   * (contrast agreements, which get a lock entity in FB-3.5).
   */
  async addMember(
    familyId: string,
    schoolId: string,
    dto: AddFamilyMemberDto,
    context: RequestContext,
  ): Promise<FamilyMemberDto> {
    const { studentId } = dto;
    this.logger.debug(
      `addMember: entry, familyId=${familyId} schoolId=${schoolId} studentId=${studentId}`,
    );
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    await this.getActiveFamilyOrThrow(client, context.tenantId, familyId, schoolId);

    const student = await this.dynamoDBClient.getItem<Student>(
      client,
      context.tenantId,
      EntityKeyBuilder.student(studentId),
    );
    if (!student) {
      throw new NotFoundException(`Student ${studentId} not found`);
    }
    if (student.primarySchoolId !== schoolId) {
      throw new BadRequestException(
        `Student ${studentId} does not belong to school ${schoolId} (V1: same-school families only)`,
      );
    }

    const existingFamilyId = await this.findLiveFamilyIdForStudent(
      client,
      context.tenantId,
      studentId,
    );
    if (existingFamilyId) {
      throw new ConflictException(
        `Student ${studentId} already belongs to family ${existingFamilyId}`,
      );
    }

    const entity = createFamilyMemberEntity(context.tenantId, familyId, studentId, {
      studentName: `${student.firstName} ${student.lastName}`.trim(),
      relationshipNote: dto.relationshipNote,
      addedBy: context.userId,
    });

    try {
      await this.dynamoDBClient.putItem(client, entity, 'attribute_not_exists(entityKey)');
    } catch (err) {
      if (isConditionalCheckFailed(err)) {
        // Lost a same-row race — the member row appeared between the
        // pre-check and the put.
        throw new ConflictException(
          `Student ${studentId} is already a member of family ${familyId}`,
        );
      }
      throw err;
    }

    this.logger.log(
      `FamilyMember linked: familyId=${familyId} studentId=${studentId} schoolId=${schoolId} by=${context.userId}`,
    );
    return familyMemberEntityToDto(entity);
  }

  /**
   * Unlink a student from a family. Idempotent: deleting an absent member
   * row is not an error (DDB DeleteItem without a condition succeeds).
   * Works on deactivated families too (membership cleanup).
   */
  async removeMember(
    familyId: string,
    schoolId: string,
    studentId: string,
    context: RequestContext,
  ): Promise<void> {
    this.logger.debug(
      `removeMember: entry, familyId=${familyId} schoolId=${schoolId} studentId=${studentId}`,
    );
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    await this.getFamilyOrThrow(client, context.tenantId, familyId, schoolId);

    await this.dynamoDBClient.deleteItem(
      client,
      context.tenantId,
      EntityKeyBuilder.familyMember(familyId, studentId),
    );

    this.logger.log(
      `FamilyMember unlinked: familyId=${familyId} studentId=${studentId} schoolId=${schoolId} by=${context.userId}`,
    );
  }

  // ============================================================================
  // FB-1.5 — student family view
  // ============================================================================

  /**
   * Resolve the family + siblings for a student. 200-with-null contract:
   * an unlinked student (or one whose only family link points at a
   * deactivated family) returns `{ family: null, siblings: [] }`, never 404.
   *
   * Sibling `gradeLevel` comes from ONE batch get of the sibling student
   * rows (`currentGradeLevel`) — no per-sibling queries. Withdrawn siblings
   * stay in the list (family membership is explicit; withdrawal does not
   * unlink).
   */
  async getStudentFamily(
    studentId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<StudentFamilyViewDto> {
    this.logger.debug(`getStudentFamily: entry, studentId=${studentId} schoolId=${schoolId}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const family = await this.findLiveFamilyForStudent(
      client,
      context.tenantId,
      studentId,
      schoolId,
    );
    if (!family) {
      return { family: null, siblings: [] };
    }

    const members = await this.dynamoDBClient.query<FamilyMemberEntity>(
      client,
      context.tenantId,
      `FAMILY_MEMBER#${family.familyId}#`,
    );
    const siblingRows = members.items.filter((m) => m.studentId !== studentId);

    const studentRows = await this.dynamoDBClient.batchGetItems<Student>(
      client,
      siblingRows.map((m) => ({
        tenantId: context.tenantId,
        entityKey: EntityKeyBuilder.student(m.studentId),
      })),
    );
    const gradeByStudentId = new Map<string, string | undefined>();
    for (const s of studentRows) {
      gradeByStudentId.set(s.studentId, s.currentGradeLevel);
    }

    return {
      family: familyEntityToDto(family),
      siblings: siblingRows.map((m) => ({
        studentId: m.studentId,
        studentName: m.studentName,
        gradeLevel: gradeByStudentId.get(m.studentId),
      })),
    };
  }

  async listMembers(
    familyId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<{ items: FamilyMemberDto[] }> {
    this.logger.debug(`listMembers: entry, familyId=${familyId} schoolId=${schoolId}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    await this.getActiveFamilyOrThrow(client, context.tenantId, familyId, schoolId);

    const members = await this.dynamoDBClient.query<FamilyMemberEntity>(
      client,
      context.tenantId,
      `FAMILY_MEMBER#${familyId}#`,
    );
    return { items: members.items.map(familyMemberEntityToDto) };
  }

  // ============================================================================
  // Internal helpers
  // ============================================================================

  /** Family row lookup, 404 on missing or wrong-school (no cross-school leak). */
  private async getFamilyOrThrow(
    client: Awaited<ReturnType<DynamoDBClientService['getClient']>>,
    tenantId: string,
    familyId: string,
    schoolId: string,
  ): Promise<FamilyEntity> {
    const entity = await this.dynamoDBClient.getItem<FamilyEntity>(
      client,
      tenantId,
      EntityKeyBuilder.family(familyId),
    );
    if (!entity || entity.schoolId !== schoolId) {
      throw new NotFoundException(`Family ${familyId} not found`);
    }
    return entity;
  }

  /** As above, plus deactivated families are excluded from reads (404). */
  private async getActiveFamilyOrThrow(
    client: Awaited<ReturnType<DynamoDBClientService['getClient']>>,
    tenantId: string,
    familyId: string,
    schoolId: string,
  ): Promise<FamilyEntity> {
    const entity = await this.getFamilyOrThrow(client, tenantId, familyId, schoolId);
    if (!entity.isActive) {
      throw new NotFoundException(`Family ${familyId} not found`);
    }
    return entity;
  }

  /**
   * GSI2 lookup: member rows for a student (gsi2pk = bare studentId,
   * gsi2sk begins_with 'FAMILY#'), hydrated to skip rows whose family is
   * deactivated (stale links of soft-deleted families don't count against
   * the single-family invariant).
   */
  private async findLiveFamilyIdForStudent(
    client: Awaited<ReturnType<DynamoDBClientService['getClient']>>,
    tenantId: string,
    studentId: string,
  ): Promise<string | null> {
    const family = await this.resolveLiveFamilyFromMemberRows(client, tenantId, studentId);
    return family?.familyId ?? null;
  }

  /** As above, additionally bounded to the given school (view path). */
  private async findLiveFamilyForStudent(
    client: Awaited<ReturnType<DynamoDBClientService['getClient']>>,
    tenantId: string,
    studentId: string,
    schoolId: string,
  ): Promise<FamilyEntity | null> {
    const family = await this.resolveLiveFamilyFromMemberRows(client, tenantId, studentId);
    if (!family || family.schoolId !== schoolId) return null;
    return family;
  }

  private async resolveLiveFamilyFromMemberRows(
    client: Awaited<ReturnType<DynamoDBClientService['getClient']>>,
    tenantId: string,
    studentId: string,
  ): Promise<FamilyEntity | null> {
    const memberRows = await this.dynamoDBClient.queryGSI2<FamilyMemberEntity>(
      client,
      studentId,
      'FAMILY#',
      'begins_with',
    );

    for (const row of memberRows.items) {
      const family = await this.dynamoDBClient.getItem<FamilyEntity>(
        client,
        tenantId,
        EntityKeyBuilder.family(row.familyId),
      );
      if (family && family.isActive) {
        return family;
      }
    }
    return null;
  }
}
