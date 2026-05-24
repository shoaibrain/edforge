/**
 * PromotionRulesService — Sprint D.2.1 + D.2.2 + D.2.3
 *
 * CRUD service for the per-(school, gradeLevel) PromotionRule entity plus
 * the D.2.3 lazy-seed (`ensureDefaultRule`) that mirrors D.1.3's
 * `GradingPolicyService.ensureDefaultPolicy`.
 *
 * **D.2.3 lazy-seed:** First GET on a (schoolId, gradeLevel) with no
 * matching row triggers `ensureDefaultRule()` which:
 *   1. Resolves tenant archetype via TenantMetadataReader (D.1.3 precedent)
 *   2. Reads `archetypeDefaults[archetype].promotionDefaults` from
 *      `@aibrains/shared-types` (PABSON: 35/80, GENERIC: 60/90)
 *   3. Writes the row with `archetypeDefaulted: true` and a condition
 *      expression so concurrent first-GETs don't double-create.
 *
 * **D.2.2 PATCH:** First PATCH on an `archetypeDefaulted: true` row flips
 * the flag to false (operator override). Identity fields (schoolId,
 * gradeLevel, archetypeId) are not patchable — clients must soft-delete
 * and create a fresh row to change scope.
 *
 * **DELETE:** Soft-delete via `isActive: false`. Row stays in DDB for
 * audit traceability; active-only filter applied at LIST.
 *
 * **Uniqueness:** A (schoolId, gradeLevel) can have at most one active
 * rule. Enforced at CREATE by listing active rules and rejecting on
 * collision (409 CONFLICT). Race window exists between list + put but
 * is operator-driven and acceptably narrow in V1.
 *
 * @see docs/pilot-greenlight/d2-sprint-plan.md §4 D.2.1 + D.2.2 + D.2.3
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import {
  PromotionRuleEntity,
  createPromotionRuleEntity,
  promotionRuleSchoolGsi1pk,
} from '../common/entities/promotion-rule.entity';
import {
  EntityKeyBuilder,
  RequestContext,
} from '../common/entities/base.entity';
import {
  promotionRuleEntityToDto,
} from '../common/mappers/promotion-rule.mapper';
import {
  TenantMetadataReaderService,
  TenantMetadataNotFoundError,
} from '../common/services/tenant-metadata-reader.service';
import {
  getArchetypeDefaults,
  type AcademicSubjectDescriptor,
  type PromotionRuleResponseDto,
} from '@aibrains/shared-types';

// ============================================================================
// DTO shapes (consumed by controller; align with shared-types schemas)
// ============================================================================

export interface CreatePromotionRuleDto {
  schoolId: string;
  gradeLevel: string;
  archetypeId: string;
  passingThresholdPct: number;
  minAttendancePct: number;
  subjectsRequired?: AcademicSubjectDescriptor[];
  description?: string;
}

export interface UpdatePromotionRuleDto {
  passingThresholdPct?: number;
  minAttendancePct?: number;
  subjectsRequired?: AcademicSubjectDescriptor[];
  description?: string;
  isActive?: boolean;
}

export interface ListPromotionRulesParams {
  schoolId: string;
  gradeLevel?: string;
  /**
   * When true (default), only rows with `isActive=true` are returned.
   * When false, soft-deleted rows are included (admin/audit views).
   */
  activeOnly?: boolean;
}

// Fallback used when METADATA row is missing OR archetype is unknown.
// Mirrors D.1.3 precedent: avoid 5xx on operator-visible GET; surface
// US-default + log warning instead.
const GENERIC_FALLBACK_DEFAULTS = {
  archetypeId: 'GENERIC',
  passingThresholdPct: 60,
  minAttendancePct: 90,
};

@Injectable()
export class PromotionRulesService {
  private readonly logger = new Logger(PromotionRulesService.name);
  private _tenantMetadataReader?: TenantMetadataReaderService;

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: AcademicsEventsService,
  ) {}

  // ============================================================================
  // CRUD
  // ============================================================================

  /**
   * Create a new PromotionRule. Rejects with 409 if an active rule already
   * exists for the same (schoolId, gradeLevel).
   */
  async createPromotionRule(
    dto: CreatePromotionRuleDto,
    context: RequestContext,
  ): Promise<PromotionRuleResponseDto> {
    this.logger.debug(
      `createPromotionRule: entry, schoolId=${dto.schoolId}, gradeLevel=${dto.gradeLevel}, archetypeId=${dto.archetypeId}`,
    );
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Uniqueness: one active rule per (schoolId, gradeLevel).
    const existing = await this.findActiveRule(context.tenantId, dto.schoolId, dto.gradeLevel, client);
    if (existing) {
      throw new ConflictException(
        `Active PromotionRule already exists for schoolId=${dto.schoolId} gradeLevel=${dto.gradeLevel} (ruleId=${existing.ruleId})`,
      );
    }

    const ruleId = uuid();
    const entity = createPromotionRuleEntity(
      context.tenantId,
      ruleId,
      dto.schoolId,
      {
        gradeLevel: dto.gradeLevel,
        archetypeId: dto.archetypeId,
        passingThresholdPct: dto.passingThresholdPct,
        minAttendancePct: dto.minAttendancePct,
        subjectsRequired: dto.subjectsRequired ?? [],
        archetypeDefaulted: false, // operator-create path; only D.2.3 seed sets this true
        description: dto.description,
        createdBy: context.userId,
      },
    );

    await this.dynamoDBClient.putItem(
      client,
      entity,
      'attribute_not_exists(entityKey)',
    );

    this.logger.log(
      `PromotionRule created: ${ruleId} schoolId=${dto.schoolId} gradeLevel=${dto.gradeLevel}`,
    );

    this.eventsService.publishPromotionRuleCreated(
      context.tenantId, ruleId, dto.schoolId, dto.gradeLevel, dto.archetypeId,
    ).catch((err) =>
      this.logger.error('Failed to publish PromotionRuleCreated event', err as Error),
    );

    return promotionRuleEntityToDto(entity);
  }

  /**
   * Get a PromotionRule by id.
   */
  async getPromotionRule(
    ruleId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<PromotionRuleResponseDto> {
    this.logger.debug(`getPromotionRule: entry, ruleId=${ruleId}, schoolId=${schoolId}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const entity = await this.dynamoDBClient.getItem<PromotionRuleEntity>(
      client,
      context.tenantId,
      EntityKeyBuilder.promotionRule(schoolId, ruleId),
    );

    if (!entity) {
      throw new NotFoundException(`PromotionRule ${ruleId} not found`);
    }

    return promotionRuleEntityToDto(entity);
  }

  /**
   * List PromotionRules for a school, optionally filtered by gradeLevel.
   *
   * If gradeLevel is supplied AND the result is empty AND `activeOnly` is
   * the default (true), triggers the D.2.3 lazy-seed and returns the
   * freshly written rule.
   */
  async listPromotionRules(
    params: ListPromotionRulesParams,
    context: RequestContext,
  ): Promise<PromotionRuleResponseDto[]> {
    const { schoolId, gradeLevel, activeOnly = true } = params;
    this.logger.debug(
      `listPromotionRules: entry, schoolId=${schoolId}, gradeLevel=${gradeLevel ?? '*'}, activeOnly=${activeOnly}`,
    );
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const skPrefix = gradeLevel
      ? `promotion-rule#${gradeLevel}#`
      : `promotion-rule#`;

    const result = await this.dynamoDBClient.queryGSI<PromotionRuleEntity>(
      client,
      'GSI1',
      promotionRuleSchoolGsi1pk(context.tenantId, schoolId),
      skPrefix,
      'begins_with',
      activeOnly ? 'isActive = :isActive' : undefined,
      activeOnly ? { ':isActive': true } : undefined,
      undefined,
      100,
    );

    if (result.items.length === 0 && gradeLevel && activeOnly) {
      // D.2.3 lazy-seed kicks in here. The seed itself may also race with
      // concurrent first-GETs; the put inside ensureDefaultRule uses a
      // condition expression so the loser of the race just re-reads.
      this.logger.debug(
        `listPromotionRules: empty, triggering D.2.3 lazy-seed (schoolId=${schoolId}, gradeLevel=${gradeLevel})`,
      );
      const seeded = await this.ensureDefaultRule(schoolId, gradeLevel, context);
      return [promotionRuleEntityToDto(seeded)];
    }

    return result.items.map(promotionRuleEntityToDto);
  }

  /**
   * Partial update. PATCH on an archetypeDefaulted=true row flips the flag
   * to false (operator override). Identity fields are not patchable.
   */
  async updatePromotionRule(
    ruleId: string,
    schoolId: string,
    dto: UpdatePromotionRuleDto,
    context: RequestContext,
  ): Promise<PromotionRuleResponseDto> {
    this.logger.debug(
      `updatePromotionRule: entry, ruleId=${ruleId}, schoolId=${schoolId}, fields=${Object.keys(dto).join(',')}`,
    );

    if (Object.keys(dto).length === 0) {
      throw new ConflictException('Update body must contain at least one field');
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.promotionRule(schoolId, ruleId);

    const existing = await this.dynamoDBClient.getItem<PromotionRuleEntity>(
      client,
      context.tenantId,
      entityKey,
    );
    if (!existing) {
      throw new NotFoundException(`PromotionRule ${ruleId} not found`);
    }

    const now = new Date().toISOString();
    const updateParts: string[] = [
      'updatedAt = :updatedAt',
      'updatedBy = :updatedBy',
      'version = version + :inc',
      'archetypeDefaulted = :archetypeDefaulted',
    ];
    const expressionValues: Record<string, unknown> = {
      ':updatedAt': now,
      ':updatedBy': context.userId,
      ':inc': 1,
      ':archetypeDefaulted': false, // any operator PATCH clears the seed flag
      ':currentVersion': existing.version,
    };

    if (dto.passingThresholdPct !== undefined) {
      updateParts.push('passingThresholdPct = :passingThresholdPct');
      expressionValues[':passingThresholdPct'] = dto.passingThresholdPct;
    }
    if (dto.minAttendancePct !== undefined) {
      updateParts.push('minAttendancePct = :minAttendancePct');
      expressionValues[':minAttendancePct'] = dto.minAttendancePct;
    }
    if (dto.subjectsRequired !== undefined) {
      updateParts.push('subjectsRequired = :subjectsRequired');
      expressionValues[':subjectsRequired'] = dto.subjectsRequired;
    }
    if (dto.description !== undefined) {
      updateParts.push('#desc = :description');
      expressionValues[':description'] = dto.description;
    }
    if (dto.isActive !== undefined) {
      updateParts.push('isActive = :isActive');
      expressionValues[':isActive'] = dto.isActive;
    }

    // `description` is a DDB reserved word — alias via #desc.
    const attributeNames =
      dto.description !== undefined ? { '#desc': 'description' } : undefined;

    const updated = await this.dynamoDBClient.updateItem<PromotionRuleEntity>(
      client,
      context.tenantId,
      entityKey,
      `SET ${updateParts.join(', ')}`,
      expressionValues,
      'version = :currentVersion',
      attributeNames,
    );

    this.logger.log(`PromotionRule updated: ${ruleId}`);

    this.eventsService.publishPromotionRuleUpdated(
      context.tenantId, ruleId, schoolId, Object.keys(dto),
    ).catch((err) =>
      this.logger.error('Failed to publish PromotionRuleUpdated event', err as Error),
    );

    return promotionRuleEntityToDto(updated);
  }

  /**
   * Soft-delete via `isActive: false`. Returns nothing on success.
   */
  async softDeletePromotionRule(
    ruleId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<void> {
    this.logger.debug(
      `softDeletePromotionRule: entry, ruleId=${ruleId}, schoolId=${schoolId}`,
    );
    await this.updatePromotionRule(ruleId, schoolId, { isActive: false }, context);
  }

  // ============================================================================
  // D.2.3 lazy-seed
  // ============================================================================

  /**
   * Ensure a PromotionRule exists for (schoolId, gradeLevel). Triggered by
   * a list query that returns empty. Returns the just-written entity (or
   * the existing row if another caller raced and wrote first).
   *
   * Failure modes (per D.1.3 precedent):
   *   - Tenant METADATA row missing → fall back to GENERIC defaults + log
   *     warning (avoid 5xx on operator GET).
   *   - Unknown archetype → same fallback, same warning.
   */
  async ensureDefaultRule(
    schoolId: string,
    gradeLevel: string,
    context: RequestContext,
  ): Promise<PromotionRuleEntity> {
    this.logger.debug(
      `ensureDefaultRule: entry, schoolId=${schoolId}, gradeLevel=${gradeLevel}`,
    );
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const seed = await this.buildSeedFromArchetype(context.tenantId);

    const ruleId = uuid();
    const entity = createPromotionRuleEntity(
      context.tenantId,
      ruleId,
      schoolId,
      {
        gradeLevel,
        archetypeId: seed.archetypeId,
        passingThresholdPct: seed.passingThresholdPct,
        minAttendancePct: seed.minAttendancePct,
        subjectsRequired: [],
        archetypeDefaulted: true,
        description: `Lazy-seeded ${seed.archetypeId} default for gradeLevel=${gradeLevel}`,
        createdBy: context.userId,
      },
    );

    try {
      await this.dynamoDBClient.putItem(
        client,
        entity,
        'attribute_not_exists(entityKey)',
      );
      this.logger.log(
        `Lazy-seeded PromotionRule: ${ruleId} schoolId=${schoolId} gradeLevel=${gradeLevel} archetype=${seed.archetypeId}`,
      );
      this.eventsService.publishPromotionRuleCreated(
        context.tenantId, ruleId, schoolId, gradeLevel, seed.archetypeId,
      ).catch((err) =>
        this.logger.error('Failed to publish PromotionRuleCreated (seed) event', err as Error),
      );
      return entity;
    } catch (err: unknown) {
      // ConditionalCheckFailed = race with another concurrent first-GET; the
      // other caller won. Re-query and return their row instead of 5xx'ing.
      const errName = (err as { name?: string })?.name ?? '';
      if (errName === 'ConditionalCheckFailedException') {
        this.logger.debug(
          `ensureDefaultRule: concurrent seed detected (CCFE), re-reading existing row`,
        );
        const existing = await this.findActiveRule(
          context.tenantId,
          schoolId,
          gradeLevel,
          client,
        );
        if (existing) return existing;
      }
      throw err;
    }
  }

  /**
   * Resolves tenant archetype and returns the matching promotionDefaults.
   * Falls back to GENERIC on any failure (matches D.1.3 fail-soft).
   */
  private async buildSeedFromArchetype(tenantId: string): Promise<{
    archetypeId: string;
    passingThresholdPct: number;
    minAttendancePct: number;
  }> {
    const archetype = await this.resolveTenantArchetype(tenantId);
    if (!archetype) return GENERIC_FALLBACK_DEFAULTS;

    try {
      const profile = getArchetypeDefaults(archetype);
      return {
        archetypeId: profile.archetype,
        passingThresholdPct: profile.promotionDefaults.passingThresholdPct,
        minAttendancePct: profile.promotionDefaults.minAttendancePct,
      };
    } catch (err) {
      this.logger.warn(
        `buildSeedFromArchetype: unknown archetype=${archetype}; falling back to GENERIC defaults. err=${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return GENERIC_FALLBACK_DEFAULTS;
    }
  }

  private async resolveTenantArchetype(tenantId: string): Promise<string | undefined> {
    const reader = this.getTenantMetadataReader();
    try {
      const md = await reader.getTenantMetadata(tenantId);
      return md.archetype;
    } catch (e) {
      if (e instanceof TenantMetadataNotFoundError) {
        this.logger.warn(
          `resolveTenantArchetype: METADATA row not found for tenant=${tenantId} — falling back to GENERIC defaults`,
        );
      } else {
        this.logger.warn(
          `resolveTenantArchetype: lookup failed for tenant=${tenantId}; falling back to GENERIC defaults. err=${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
      return undefined;
    }
  }

  private getTenantMetadataReader(): TenantMetadataReaderService {
    if (!this._tenantMetadataReader) {
      this._tenantMetadataReader = new TenantMetadataReaderService();
    }
    return this._tenantMetadataReader;
  }

  // ============================================================================
  // Internal helpers
  // ============================================================================

  /**
   * GSI1 lookup for an ACTIVE rule for (schoolId, gradeLevel). Returns the
   * first match (uniqueness enforced at write time) or null.
   */
  private async findActiveRule(
    tenantId: string,
    schoolId: string,
    gradeLevel: string,
    client: Awaited<ReturnType<DynamoDBClientService['getClient']>>,
  ): Promise<PromotionRuleEntity | null> {
    const result = await this.dynamoDBClient.queryGSI<PromotionRuleEntity>(
      client,
      'GSI1',
      promotionRuleSchoolGsi1pk(tenantId, schoolId),
      `promotion-rule#${gradeLevel}#`,
      'begins_with',
      'isActive = :isActive',
      { ':isActive': true },
      undefined,
      5,
    );
    return result.items[0] ?? null;
  }
}
