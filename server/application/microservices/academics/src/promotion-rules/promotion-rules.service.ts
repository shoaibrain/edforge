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
 * **Uniqueness — race-safe:** A (schoolId, gradeLevel) can have at most
 * one active rule. Enforced at CREATE by a TransactWriteItems that writes
 * both the rule entity AND a deterministic uniqueness lock keyed by
 * `PROMOTION_RULE_LOCK#{schoolId}#{gradeLevel}` with
 * `attribute_not_exists(entityKey)` on the lock. The `findActiveRule`
 * pre-check still runs for a clean 409 response in the non-racy case;
 * the lock catches the concurrent-first-GET case where two callers race
 * past the pre-check. On `TransactionCanceledException`, the service
 * re-reads the active row and returns the winner.
 *
 * **Lock lifecycle:** the lock is created with the rule and DELETED by
 * soft-delete (PATCH/DELETE with `isActive: false`) so a fresh active
 * rule can be created later for the same (schoolId, gradeLevel).
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

/**
 * Build the deterministic uniqueness-lock item. Pairs with the PromotionRule
 * entity via TransactWriteItems so concurrent writers can't both succeed
 * for the same (schoolId, gradeLevel). The lock body carries
 * `activeRuleId` for operator-debugging traceability — the lock-entityKey
 * is the only race-relevant column.
 */
function buildLockItem(
  tenantId: string,
  schoolId: string,
  gradeLevel: string,
  activeRuleId: string,
): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    tenantId,
    entityKey: EntityKeyBuilder.promotionRuleLock(schoolId, gradeLevel),
    entityType: 'PROMOTION_RULE_LOCK',
    schoolId,
    gradeLevel,
    activeRuleId,
    createdAt: now,
  };
}

function isTransactionCanceled(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? '';
  return name === 'TransactionCanceledException';
}

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

    try {
      await this.writeRuleWithLock(client, entity, dto.schoolId, dto.gradeLevel, ruleId);
    } catch (err) {
      if (isTransactionCanceled(err)) {
        // Lost the race to a concurrent writer (lock collision). Re-read
        // the active rule and surface 409 with the winner's ruleId so the
        // operator can decide whether to PATCH or DELETE+retry.
        const winner = await this.findActiveRule(
          context.tenantId,
          dto.schoolId,
          dto.gradeLevel,
          client,
        );
        const winnerRuleId = winner?.ruleId ?? 'unknown';
        throw new ConflictException(
          `Active PromotionRule already exists for schoolId=${dto.schoolId} gradeLevel=${dto.gradeLevel} (ruleId=${winnerRuleId})`,
        );
      }
      throw err;
    }

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
   * Atomic write of a PromotionRule + its uniqueness lock via
   * TransactWriteItems. Caller catches `TransactionCanceledException` to
   * detect lock collisions.
   */
  private async writeRuleWithLock(
    client: Awaited<ReturnType<DynamoDBClientService['getClient']>>,
    entity: PromotionRuleEntity,
    schoolId: string,
    gradeLevel: string,
    ruleId: string,
  ): Promise<void> {
    const tableName = this.dynamoDBClient.getTableName();
    const lockItem = buildLockItem(entity.tenantId, schoolId, gradeLevel, ruleId);
    await this.dynamoDBClient.transactWrite(client, [
      {
        Put: {
          TableName: tableName,
          Item: entity as unknown as Record<string, unknown>,
          ConditionExpression: 'attribute_not_exists(entityKey)',
        },
      },
      {
        Put: {
          TableName: tableName,
          Item: lockItem,
          ConditionExpression: 'attribute_not_exists(entityKey)',
        },
      },
    ]);
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

    // PATCH paths involving `isActive` must keep the uniqueness lock in
    // sync with the rule's active state:
    //   - isActive: false on an active rule → delegate to softDelete
    //     (atomic update + lock drop)
    //   - isActive: true on an already-active rule → no-op (allowed)
    //   - isActive: true on a soft-deleted rule → reject; V1 operators
    //     must create a fresh rule (would require a lock re-acquire which
    //     could collide with another active rule for the same scope)
    if (dto.isActive === false && existing.isActive) {
      await this.softDeletePromotionRule(ruleId, schoolId, context);
      const reread = await this.dynamoDBClient.getItem<PromotionRuleEntity>(
        client,
        context.tenantId,
        entityKey,
      );
      // softDelete already verified existence; reread cannot be null here.
      return promotionRuleEntityToDto(reread as PromotionRuleEntity);
    }
    if (dto.isActive === true && !existing.isActive) {
      throw new ConflictException(
        `Reactivation of soft-deleted PromotionRule ${ruleId} is not supported in V1; create a new rule for the same (schoolId, gradeLevel) instead.`,
      );
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
   * Soft-delete via `isActive: false` AND delete the uniqueness lock in
   * a single transaction so a fresh active rule can be created later for
   * the same (schoolId, gradeLevel).
   *
   * The lock Delete is guarded by `attribute_exists(entityKey)` so a
   * second DELETE on an already-deleted rule (idempotent operator retry)
   * doesn't fail; if the rule is already inactive AND the lock is gone,
   * the transaction succeeds as a no-op on the lock side. (TransactWrite
   * is atomic per chunk; either both ops succeed or both fail.)
   */
  async softDeletePromotionRule(
    ruleId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<void> {
    this.logger.debug(
      `softDeletePromotionRule: entry, ruleId=${ruleId}, schoolId=${schoolId}`,
    );

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

    await this.deactivateRuleAndDropLock(
      client,
      context.tenantId,
      schoolId,
      existing.gradeLevel,
      ruleId,
      existing.version ?? 1,
      context.userId,
    );

    this.logger.log(`PromotionRule soft-deleted: ${ruleId}`);
    this.eventsService.publishPromotionRuleUpdated(
      context.tenantId, ruleId, schoolId, ['isActive'],
    ).catch((err) =>
      this.logger.error('Failed to publish PromotionRuleUpdated (soft-delete) event', err as Error),
    );
  }

  /**
   * Atomic deactivation: flips `isActive=false` on the rule + drops the
   * uniqueness lock. Uses TransactWriteItems so both rows reach the
   * deactivated state together or neither does.
   */
  private async deactivateRuleAndDropLock(
    client: Awaited<ReturnType<DynamoDBClientService['getClient']>>,
    tenantId: string,
    schoolId: string,
    gradeLevel: string,
    ruleId: string,
    currentVersion: number,
    userId: string,
  ): Promise<void> {
    const tableName = this.dynamoDBClient.getTableName();
    const now = new Date().toISOString();
    await this.dynamoDBClient.transactWrite(client, [
      {
        Update: {
          TableName: tableName,
          Key: {
            tenantId,
            entityKey: EntityKeyBuilder.promotionRule(schoolId, ruleId),
          },
          UpdateExpression:
            'SET isActive = :isActive, updatedAt = :updatedAt, updatedBy = :updatedBy, archetypeDefaulted = :archetypeDefaulted, version = version + :inc',
          ConditionExpression: 'version = :currentVersion',
          ExpressionAttributeValues: {
            ':isActive': false,
            ':updatedAt': now,
            ':updatedBy': userId,
            ':archetypeDefaulted': false,
            ':inc': 1,
            ':currentVersion': currentVersion,
          },
        },
      },
      {
        Delete: {
          TableName: tableName,
          Key: {
            tenantId,
            entityKey: EntityKeyBuilder.promotionRuleLock(schoolId, gradeLevel),
          },
          // Guard: lock should exist when we're deactivating an active rule.
          // If it doesn't, the rule + lock are out of sync — fail the
          // transaction so the operator can investigate rather than silently
          // succeed against half-state.
          ConditionExpression: 'attribute_exists(entityKey)',
        },
      },
    ]);
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
      await this.writeRuleWithLock(client, entity, schoolId, gradeLevel, ruleId);
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
      // TransactionCanceledException = lock collision with a concurrent
      // first-GET writer. The other caller won; re-query and return their
      // row instead of 5xx'ing the operator. Same semantic as D.1.3's
      // race-recovery pattern.
      if (isTransactionCanceled(err)) {
        this.logger.debug(
          `ensureDefaultRule: concurrent seed detected (TransactionCanceledException), re-reading existing row`,
        );
        const existing = await this.findActiveRule(
          context.tenantId,
          schoolId,
          gradeLevel,
          client,
        );
        if (existing) return existing;
        // The lock collided but no active row surfaced — this would be a
        // genuine inconsistency (orphan lock) that warrants a hard fail.
        this.logger.error(
          `ensureDefaultRule: lock collision detected but no active rule for schoolId=${schoolId} gradeLevel=${gradeLevel}`,
        );
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
