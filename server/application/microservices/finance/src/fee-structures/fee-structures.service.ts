import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import {
  FeeStructureEntity,
  createFeeStructureEntity,
} from '../common/entities/fee-structure.entity';
import { EntityKeyBuilder, GSIKeyBuilder, RequestContext, decodeCursor } from '../common/entities/base.entity';
import { feeStructureEntityToDto } from '../common/mappers/fee-structure.mapper';
import { AuditLoggerService, AuditAction } from '@app/logger';
import { ORDERED_GRADES } from '@aibrains/shared-types';
import type { FeeStructure, CreateFeeStructureDto, UpdateFeeStructureDto } from '@aibrains/shared-types';

/**
 * Resolve the array of grade codes a fee structure can be assigned to for
 * this school. Mirrors the frontend `useSchoolEnabledGradeOptions` and
 * `deriveSchoolGradeCodes` chain:
 *   1. Non-empty `enabledGradeLevels` → use it
 *   2. Else `gradeRange` → slice of `ORDERED_GRADES`
 *   3. Else (no school context) → null = no validation possible, skip
 *
 * Returns null instead of `[...ORDERED_GRADES]` for the unknown-school case
 * so the caller can distinguish "school missing context" from "school
 * configured for the full catalog" — only the former should be a silent
 * pass; the latter is what callers actually want to validate against.
 */
function resolveValidGradeCodes(school: {
  gradeRange?: { start: string; end: string };
  enabledGradeLevels?: string[];
} | null): string[] | null {
  if (!school) return null;
  if (Array.isArray(school.enabledGradeLevels) && school.enabledGradeLevels.length > 0) {
    return school.enabledGradeLevels.map(String);
  }
  if (school.gradeRange) {
    const startIdx = ORDERED_GRADES.indexOf(
      school.gradeRange.start as typeof ORDERED_GRADES[number],
    );
    const endIdx = ORDERED_GRADES.indexOf(
      school.gradeRange.end as typeof ORDERED_GRADES[number],
    );
    if (startIdx !== -1 && endIdx !== -1 && startIdx <= endIdx) {
      return ORDERED_GRADES.slice(startIdx, endIdx + 1) as unknown as string[];
    }
  }
  return null;
}

/** Fields that trigger version creation instead of in-place mutation */
const FINANCIAL_FIELDS = ['amount', 'taxRate', 'taxType'];

@Injectable()
export class FeeStructuresService {
  private readonly logger = new Logger(FeeStructuresService.name);
  private readonly auditLogger = new AuditLoggerService('finance-service');

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: FinanceEventsService,
    private readonly identityClient: IdentityClientService,
  ) {}

  async create(
    schoolId: string,
    dto: CreateFeeStructureDto,
    context: RequestContext,
  ): Promise<FeeStructure> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Validate school exists
    const schoolExists = await this.identityClient.validateSchoolExists(schoolId, context);
    if (!schoolExists) {
      throw new NotFoundException(`School ${schoolId} not found`);
    }

    // Validate currency matches workspace settings
    if (dto.currency) {
      const ws = await this.identityClient.getWorkspaceSettings(context);
      if (ws?.regional?.defaultCurrency && dto.currency !== ws.regional.defaultCurrency) {
        this.logger.warn(
          `Currency mismatch: received ${dto.currency}, expected ${ws.regional.defaultCurrency} for tenant ${context.tenantId}`,
        );
        throw new BadRequestException(
          `Currency mismatch: tenant is configured for ${ws.regional.defaultCurrency} but received ${dto.currency}`,
        );
      }
    }

    // P3.4: Soft-warn (NOT block) on grade levels outside the school's
    // configured set. The validator now prefers `enabledGradeLevels`
    // (Phase 1) and falls back to `gradeRange` slice for legacy rows —
    // same resolution chain as the frontend `useSchoolEnabledGradeOptions`
    // hook. Hard-block was rejected because narrowing `enabledGradeLevels`
    // (e.g., dropping Grade 11/12) on a school that already has fee
    // structures for those grades would silently break fee creation; the
    // operator should be free to set up future fees for those grades
    // anyway, but we log so an audit-after-the-fact can surface drift.
    if (dto.gradeLevels && dto.gradeLevels.length > 0) {
      const schoolDetails = await this.identityClient.getSchoolDetails(schoolId, context);
      // P3.4 review: `validateSchoolExists` above already confirmed the
      // school is present, so a null here CANNOT be a 404 — it's a
      // transport / 5xx / parse failure swallowed by identityClient's
      // catch-all. Emit a distinct warn so ops sees the silent miss
      // rather than treating it as "school has no configured grades".
      // Save still proceeds — per P3.4 soft-warn design, a transient
      // identity outage should not block fee creation.
      if (schoolDetails === null) {
        this.logger.warn(
          `Fee structure "${dto.name}" for school ${schoolId}: getSchoolDetails returned null AFTER validateSchoolExists succeeded — likely identity transport/5xx. Skipping grade-level validation; save will proceed. (Distinct from the "no configured grades" path which still runs resolveValidGradeCodes.)`,
        );
      } else {
        const validGrades = resolveValidGradeCodes(schoolDetails);
        if (validGrades) {
          const invalidGrades = dto.gradeLevels.filter((g) => !validGrades.includes(g));
          if (invalidGrades.length > 0) {
            this.logger.warn(
              `Fee structure "${dto.name}" for school ${schoolId} references grade levels outside the school's configured set: ${invalidGrades.join(', ')}. Configured codes: ${validGrades.join(', ')}. Save will proceed (soft-warn per P3.4 design).`,
            );
          }
        }
      }
    }

    const entity = createFeeStructureEntity(context.tenantId, schoolId, dto, context.userId);

    await this.dynamoDBClient.putItem(client, entity);

    this.eventsService.publishFeeStructureCreated(
      context.tenantId,
      schoolId,
      entity.feeStructureId,
      entity.name,
    ).catch(err => this.logger.error(`Failed to publish FeeStructureCreated: ${err.message}`));

    this.auditLogger.log(
      AuditAction.FEE_STRUCTURE_CREATED,
      { tenantId: context.tenantId, userId: context.userId, userEmail: context.email, userRole: context.role },
      { type: 'FEE_STRUCTURE', id: entity.feeStructureId, name: entity.name },
      { schoolId, feeType: entity.feeType, amount: entity.amount, currency: entity.currency },
    );

    return feeStructureEntityToDto(entity);
  }

  async list(
    schoolId: string,
    context: RequestContext,
    options: {
      feeType?: string;
      academicYear?: string;
      isActive?: boolean;
      limit?: number;
      cursor?: string;
    } = {},
  ): Promise<{ items: FeeStructure[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    // Build filter expression
    const filterParts: string[] = [];
    const filterValues: Record<string, any> = {};

    if (options.feeType) {
      filterParts.push('feeType = :feeType');
      filterValues[':feeType'] = options.feeType;
    }
    if (options.academicYear) {
      filterParts.push('academicYear = :academicYear');
      filterValues[':academicYear'] = options.academicYear;
    }
    if (options.isActive !== undefined) {
      filterParts.push('isActive = :isActive');
      filterValues[':isActive'] = options.isActive;
    }

    const result = await this.dynamoDBClient.queryGSI<FeeStructureEntity>(
      client,
      'GSI1',
      gsi1pk,
      'FEE_STRUCTURE',
      'begins_with',
      filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
      Object.keys(filterValues).length > 0 ? filterValues : undefined,
      undefined,
      options.limit || 50,
      true,
      decodeCursor(options.cursor),
    );

    return {
      items: result.items.map(feeStructureEntityToDto),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  async get(
    schoolId: string,
    feeStructureId: string,
    context: RequestContext,
  ): Promise<FeeStructure> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.feeStructure(schoolId, feeStructureId);

    const entity = await this.dynamoDBClient.getItem<FeeStructureEntity>(
      client,
      context.tenantId,
      entityKey,
    );

    if (!entity) {
      throw new NotFoundException(`Fee structure ${feeStructureId} not found`);
    }

    return feeStructureEntityToDto(entity);
  }

  async update(
    schoolId: string,
    feeStructureId: string,
    dto: UpdateFeeStructureDto,
    context: RequestContext,
  ): Promise<FeeStructure> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.feeStructure(schoolId, feeStructureId);

    // Verify exists
    const existing = await this.dynamoDBClient.getItem<FeeStructureEntity>(
      client,
      context.tenantId,
      entityKey,
    );
    if (!existing) {
      throw new NotFoundException(`Fee structure ${feeStructureId} not found`);
    }

    const updateFields = Object.entries(dto).filter(([key, v]) => v !== undefined && key !== 'reason');
    const hasFinancialChange = FINANCIAL_FIELDS.some(f => (dto as any)[f] !== undefined);
    const auditContext = { tenantId: context.tenantId, userId: context.userId, userEmail: context.email, userRole: context.role };

    if (hasFinancialChange) {
      // ---- Versioned update: create new entity + deactivate old one atomically ----
      const newId = uuid();
      const now = new Date().toISOString();
      const newEntity: FeeStructureEntity = {
        ...existing,
        entityKey: EntityKeyBuilder.feeStructure(schoolId, newId),
        feeStructureId: newId,
        versionParentId: existing.versionParentId || existing.feeStructureId,
        version: existing.version + 1,
        // Apply financial field updates
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.taxRate !== undefined && { taxRate: dto.taxRate }),
        ...(dto.taxType !== undefined && { taxType: dto.taxType }),
        // Also apply non-financial updates if present
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.gradeLevels !== undefined && { gradeLevels: dto.gradeLevels }),
        ...(dto.autoApplyOnEnrollment !== undefined && { autoApplyOnEnrollment: dto.autoApplyOnEnrollment }),
        ...(dto.proRateOnMidTermEntry !== undefined && { proRateOnMidTermEntry: dto.proRateOnMidTermEntry }),
        ...(dto.effectiveFrom !== undefined && { effectiveFrom: dto.effectiveFrom }),
        ...(dto.effectiveTo !== undefined && { effectiveTo: dto.effectiveTo }),
        isActive: true,
        updatedAt: now,
        updatedBy: context.userId,
        createdAt: now,
        createdBy: context.userId,
        // Update GSI keys for new entity
        gsi1pk: GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
        gsi1sk: GSIKeyBuilder.entitySort('FEE_STRUCTURE', `${existing.feeType}#${(dto.name || existing.name).toUpperCase()}`),
      };

      // Atomic: create new version + deactivate old
      await this.dynamoDBClient.transactWrite(client, [
        {
          Put: {
            TableName: this.dynamoDBClient.getTableName(),
            Item: newEntity as any,
          },
        },
        {
          Update: {
            TableName: this.dynamoDBClient.getTableName(),
            Key: { tenantId: context.tenantId, entityKey: existing.entityKey },
            UpdateExpression: 'SET isActive = :false, updatedAt = :now, updatedBy = :userId',
            ConditionExpression: '#v = :currentVersion AND isActive = :true',
            ExpressionAttributeNames: { '#v': 'version' },
            ExpressionAttributeValues: {
              ':false': false,
              ':true': true,
              ':now': now,
              ':userId': context.userId,
              ':currentVersion': existing.version,
            },
          },
        },
      ]);

      const changedFields = updateFields.map(([k]) => k);

      this.eventsService.publishFeeStructureVersioned(
        context.tenantId,
        schoolId,
        feeStructureId,
        newId,
        newEntity.version,
        changedFields,
      ).catch(err => this.logger.error(`Failed to publish FeeStructureVersioned: ${err.message}`));

      this.auditLogger.log(
        AuditAction.FEE_STRUCTURE_VERSIONED,
        auditContext,
        { type: 'FEE_STRUCTURE', id: newId, name: newEntity.name },
        {
          schoolId,
          previousId: feeStructureId,
          previousVersion: existing.version,
          newVersion: newEntity.version,
          versionParentId: newEntity.versionParentId,
          changedFields,
          reason: dto.reason,
        },
      );

      return feeStructureEntityToDto(newEntity);
    }

    // ---- In-place update for non-financial fields ----
    const setParts: string[] = ['updatedAt = :updatedAt', 'updatedBy = :updatedBy', '#v = #v + :one'];
    const exprValues: Record<string, any> = {
      ':updatedAt': new Date().toISOString(),
      ':updatedBy': context.userId,
      ':one': 1,
      ':currentVersion': existing.version,
    };
    const exprNames: Record<string, string> = { '#v': 'version' };

    for (const [key, value] of updateFields) {
      const attrKey = `:${key}`;
      setParts.push(`${key} = ${attrKey}`);
      exprValues[attrKey] = value;
    }

    // If name changed, update GSI1SK (feeType is immutable after creation)
    if (dto.name) {
      const newName = dto.name || existing.name;
      setParts.push('gsi1sk = :gsi1sk');
      exprValues[':gsi1sk'] = GSIKeyBuilder.entitySort('FEE_STRUCTURE', `${existing.feeType}#${newName.toUpperCase()}`);
    }

    const updated = await this.dynamoDBClient.updateItem<FeeStructureEntity>(
      client,
      context.tenantId,
      entityKey,
      `SET ${setParts.join(', ')}`,
      exprValues,
      '#v = :currentVersion',
      exprNames,
    );

    this.eventsService.publishFeeStructureUpdated(
      context.tenantId,
      schoolId,
      feeStructureId,
      updateFields.map(([k]) => k),
    ).catch(err => this.logger.error(`Failed to publish FeeStructureUpdated: ${err.message}`));

    this.auditLogger.log(
      AuditAction.FEE_STRUCTURE_UPDATED,
      auditContext,
      { type: 'FEE_STRUCTURE', id: feeStructureId, name: updated.name },
      { schoolId, updatedFields: updateFields.map(([k]) => k), reason: dto.reason },
    );

    return feeStructureEntityToDto(updated);
  }

  async getVersionHistory(
    schoolId: string,
    feeStructureId: string,
    context: RequestContext,
  ): Promise<FeeStructure[]> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.feeStructure(schoolId, feeStructureId);

    // Get the target fee structure to determine the version chain root
    const entity = await this.dynamoDBClient.getItem<FeeStructureEntity>(
      client,
      context.tenantId,
      entityKey,
    );
    if (!entity) {
      throw new NotFoundException(`Fee structure ${feeStructureId} not found`);
    }

    const parentId = entity.versionParentId || entity.feeStructureId;

    // Query all fee structures under this school and filter by version chain
    const result = await this.dynamoDBClient.query<FeeStructureEntity>(
      client,
      context.tenantId,
      `FEE_STRUCTURE#${schoolId}#`,
      'entityType = :et AND (versionParentId = :parentId OR feeStructureId = :parentId)',
      { ':et': 'FEE_STRUCTURE', ':parentId': parentId },
    );

    return result.items
      .sort((a, b) => a.version - b.version)
      .map(feeStructureEntityToDto);
  }

  async delete(
    schoolId: string,
    feeStructureId: string,
    context: RequestContext,
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.feeStructure(schoolId, feeStructureId);

    // For versioned fee structures, soft-delete to preserve audit trail
    const entity = await this.dynamoDBClient.getItem<FeeStructureEntity>(
      client,
      context.tenantId,
      entityKey,
    );

    if (!entity) {
      throw new NotFoundException(`Fee structure ${feeStructureId} not found`);
    }

    if (entity.version > 1 || entity.versionParentId) {
      // Soft-delete: mark inactive and record deletion timestamp
      await this.dynamoDBClient.updateItem(
        client,
        context.tenantId,
        entityKey,
        'SET isActive = :inactive, deletedAt = :now, updatedAt = :now',
        { ':inactive': false, ':now': new Date().toISOString() },
      );
      this.logger.log(
        `Soft-deleted versioned fee structure ${feeStructureId} (v${entity.version})`,
      );
    } else {
      // Hard-delete only for v1 non-versioned structures
      await this.dynamoDBClient.deleteItem(
        client,
        context.tenantId,
        entityKey,
        'attribute_exists(entityKey)',
      );
    }
  }

  /**
   * Get fee structures that auto-apply on enrollment for a school/grade.
   * Filters server-side for autoApplyOnEnrollment=true + grade level match.
   */
  async getEnrollmentFees(
    schoolId: string,
    gradeLevel: string,
    context: RequestContext,
    enrollmentType?: string,
  ): Promise<FeeStructureEntity[]> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    const result = await this.dynamoDBClient.queryGSI<FeeStructureEntity>(
      client,
      'GSI1',
      gsi1pk,
      'FEE_STRUCTURE',
      'begins_with',
      'isActive = :isActive AND autoApplyOnEnrollment = :autoApply',
      { ':isActive': true, ':autoApply': true },
      undefined,
      100,
      false,
    );

    // Client-side filters: grade level + enrollment type
    return result.items.filter((fs) => {
      const gradeMatch = fs.gradeLevels.length === 0 || fs.gradeLevels.includes(gradeLevel);
      if (!gradeMatch) return false;

      // If enrollmentType provided, filter fees that apply to it
      if (enrollmentType && fs.enrollmentTypes && fs.enrollmentTypes.length > 0) {
        return fs.enrollmentTypes.includes(enrollmentType as typeof fs.enrollmentTypes[number]);
      }
      return true;
    });
  }

  /**
   * Fetch multiple fee structures by IDs (used by invoice generation)
   */
  async getByIds(
    schoolId: string,
    feeStructureIds: string[],
    context: RequestContext,
  ): Promise<FeeStructureEntity[]> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const keys = feeStructureIds.map(id => ({
      tenantId: context.tenantId,
      entityKey: EntityKeyBuilder.feeStructure(schoolId, id),
    }));

    return this.dynamoDBClient.batchGetItems<FeeStructureEntity>(client, keys);
  }

  /**
   * Get child overrides for a parent fee structure (Sprint 6.5)
   */
  async getOverrides(
    schoolId: string,
    feeStructureId: string,
    context: RequestContext,
  ): Promise<FeeStructure[]> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    const result = await this.dynamoDBClient.queryGSI<FeeStructureEntity>(
      client,
      'GSI1',
      gsi1pk,
      'FEE_STRUCTURE',
      'begins_with',
      'templateParentId = :parentId AND isActive = :isActive',
      { ':parentId': feeStructureId, ':isActive': true },
      undefined,
      100,
      false,
    );

    return result.items.map(feeStructureEntityToDto);
  }

  /**
   * Get the most applicable fee for a student's grade level.
   * Child overrides take precedence over parent templates.
   */
  async getApplicableFee(
    schoolId: string,
    feeStructureId: string,
    gradeLevel: string,
    context: RequestContext,
  ): Promise<FeeStructure> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.feeStructure(schoolId, feeStructureId);

    const parent = await this.dynamoDBClient.getItem<FeeStructureEntity>(
      client,
      context.tenantId,
      entityKey,
    );
    if (!parent) {
      throw new NotFoundException(`Fee structure ${feeStructureId} not found`);
    }

    // Look for child overrides matching the grade level
    const overrides = await this.getOverrides(schoolId, feeStructureId, context);
    const matchingOverride = overrides.find(
      o => o.gradeLevels.includes(gradeLevel),
    );

    if (matchingOverride) {
      return matchingOverride;
    }

    return feeStructureEntityToDto(parent);
  }
}
