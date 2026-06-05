/**
 * Grading Policy Service
 *
 * Manages school-level grading policies (scale, category weights, rules).
 * Validates that category weights sum to 100% and grade scale ranges are contiguous.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { v4 as uuid, v5 as uuidv5 } from 'uuid';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import {
  GradingPolicyEntity,
  createGradingPolicyEntity,
} from '../common/entities/grading-policy.entity';
import {
  EntityKeyBuilder,
  GSIKeyBuilder,
  RequestContext,
  PaginatedResult,
} from '../common/entities/base.entity';
import { LetterGradeEntry, CategoryWeight } from '../common/entities/grade.entity';
import {
  GradingPolicyResponseDto,
  gradingPolicyEntityToDto,
} from '../common/mappers/grading-policy.mapper';
import {
  TenantMetadataReaderService,
} from '../common/services/tenant-metadata-reader.service';
import { resolveArchetypeOrDegrade } from '../common/services/resolve-archetype';
import {
  getArchetypeDefaults,
  type ArchetypeDefaults,
} from '@aibrains/shared-types';

export interface CreateGradingPolicyDto {
  schoolId: string;
  policyName: string;
  description?: string;
  gpaScale: '4.0' | '5.0';
  letterGrades: LetterGradeEntry[];
  categoryWeights: CategoryWeight[];
  dropLowestScores?: { categoryId: string; count: number }[];
  roundingRule: 'up' | 'down' | 'nearest';
  minimumPassingGrade: number;
  isDefault?: boolean;
}

export interface UpdateGradingPolicyDto {
  policyName?: string;
  description?: string;
  gpaScale?: '4.0' | '5.0';
  letterGrades?: LetterGradeEntry[];
  categoryWeights?: CategoryWeight[];
  dropLowestScores?: { categoryId: string; count: number }[];
  roundingRule?: 'up' | 'down' | 'nearest';
  minimumPassingGrade?: number;
  isDefault?: boolean;
  isActive?: boolean;
}

/**
 * Stable namespace for deriving the auto-seeded default policy's id from the
 * schoolId (uuid v5). Sprint B (B.2): a *deterministic* id is what makes the
 * seed's `attribute_not_exists(entityKey)` conditional write actually contend
 * under concurrency — a fresh `uuid()` per call would give every racing first
 * GET a distinct key, so all of them would write and the school would end up
 * with duplicate "default" policies. Fixed, arbitrary UUID; never change it or
 * existing schools' seeded-default keys would shift.
 */
const DEFAULT_POLICY_NAMESPACE = '4f2a9c7e-3b6d-4e21-9a8f-1c0d5e7b2a64';

@Injectable()
export class GradingPolicyService {
  private readonly logger = new Logger(GradingPolicyService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: AcademicsEventsService,
  ) {}

  /**
   * Create a new grading policy for a school
   */
  async createGradingPolicy(
    dto: CreateGradingPolicyDto,
    context: RequestContext,
  ): Promise<GradingPolicyResponseDto> {
    this.logger.debug(
      `createGradingPolicy: entry, schoolId=${dto.schoolId}, isDefault=${dto.isDefault ?? false}, scaleEntries=${dto.letterGrades?.length ?? 0}, categoryWeights=${dto.categoryWeights?.length ?? 0}`,
    );
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Validate grading scale ranges
    this.validateGradingScale(dto.letterGrades);

    // Validate category weights sum to 100
    this.validateCategoryWeights(dto.categoryWeights);

    const policyId = uuid();
    const isDefault = dto.isDefault ?? false;

    // If marking as default, unset any existing default
    if (isDefault) {
      await this.unsetDefaultPolicy(client, context.tenantId, dto.schoolId);
    }

    const entity = createGradingPolicyEntity(
      context.tenantId,
      policyId,
      dto.schoolId,
      {
        policyName: dto.policyName,
        description: dto.description,
        gpaScale: dto.gpaScale,
        letterGrades: dto.letterGrades,
        categoryWeights: dto.categoryWeights,
        dropLowestScores: dto.dropLowestScores,
        roundingRule: dto.roundingRule,
        minimumPassingGrade: dto.minimumPassingGrade,
        isDefault,
        createdBy: context.userId,
      },
    );

    await this.dynamoDBClient.putItem(client, entity);

    this.logger.log(`Grading policy created: ${dto.policyName} (${policyId}) for school ${dto.schoolId}`);
    this.logger.debug(
      `createGradingPolicy: completed, policyId=${policyId}, schoolId=${dto.schoolId}`,
    );

    this.eventsService.publishGradingPolicyCreated(
      context.tenantId, policyId, dto.schoolId, dto.policyName,
    ).catch(err => this.logger.error('Failed to publish GradingPolicyCreated event', err));

    return gradingPolicyEntityToDto(entity);
  }

  /**
   * Get a grading policy by ID
   */
  async getGradingPolicy(
    policyId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<GradingPolicyResponseDto> {
    this.logger.debug(
      `getGradingPolicy: entry, policyId=${policyId}, schoolId=${schoolId}`,
    );
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const entity = await this.dynamoDBClient.getItem<GradingPolicyEntity>(
      client,
      context.tenantId,
      EntityKeyBuilder.gradingPolicy(schoolId, policyId),
    );

    if (!entity) {
      throw new NotFoundException(`Grading policy ${policyId} not found`);
    }

    this.logger.debug(
      `getGradingPolicy: found, policyId=${policyId}, schoolId=${schoolId}`,
    );

    return gradingPolicyEntityToDto(entity);
  }

  /**
   * Get the default grading policy for a school.
   * Returns the entity (not DTO) for internal use by grade calculation.
   * If no default policy exists, auto-creates a standard one.
   */
  async getDefaultPolicyEntity(
    schoolId: string,
    context: RequestContext,
  ): Promise<GradingPolicyEntity | null> {
    this.logger.debug(
      `getDefaultPolicyEntity: entry, schoolId=${schoolId}`,
    );
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const existing = await this.queryActiveDefault(client, schoolId, context);
    if (existing) {
      this.logger.debug(
        `getDefaultPolicyEntity: found existing, schoolId=${schoolId}, policyId=${existing.policyId}`,
      );
      return existing;
    }

    // No default policy exists — auto-create one
    this.logger.debug(
      `getDefaultPolicyEntity: no default found, auto-creating for schoolId=${schoolId}`,
    );
    return this.ensureDefaultPolicy(schoolId, context);
  }

  /**
   * Query the school's active default policy (GSI1, `isDefault AND isActive`,
   * limit 1). Returns `null` when none exists. Shared by `getDefaultPolicyEntity`
   * and `ensureDefaultPolicy`'s lost-seed-race recovery so both read the default
   * the same way.
   */
  private async queryActiveDefault(
    client: DynamoDBDocumentClient,
    schoolId: string,
    context: RequestContext,
  ): Promise<GradingPolicyEntity | null> {
    // No Limit: DynamoDB applies `Limit` BEFORE `FilterExpression`, so a
    // `Limit: 1` here could evaluate a single non-default policy (GSI1SK sorts
    // by policyName) and return 0 even when an active default exists later in
    // the partition — which would wrongly trigger a re-seed and duplicate the
    // default. A school's GRADEPOLICY partition is tiny (a handful of rows, far
    // under one 1MB page), so a single filtered query reliably finds it.
    const result = await this.dynamoDBClient.queryGSI<GradingPolicyEntity>(
      client,
      'GSI1',
      GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
      'GRADEPOLICY#',
      'begins_with',
      'isDefault = :isDefault AND isActive = :isActive',
      { ':isDefault': true, ':isActive': true },
    );
    return result.items.length > 0 ? result.items[0] : null;
  }

  /**
   * Ensure a default grading policy exists for a school.
   *
   * Sprint D.1.3 (2026-05-22) — when no policy exists, seed one from the
   * tenant's archetype profile (`@aibrains/shared-types` ArchetypeDefaults):
   *   - PABSON  → 10-letter Nepal CEHRD scale (A+/A/B+/B/C+/C/D+/D/E/NG)
   *   - GENERIC → 5-letter US scale (A/B/C/D/F)
   *
   * Failure mode rationale:
   *   - Unknown archetype → falls back to US-default with logged warning
   *     (avoids 5xx on operator GET; pre-D.1.4 behavior preserved).
   *   - Tenant METADATA row missing → falls back to US-default + warning
   *     (same reason — operator-visible GET should never 5xx here).
   *
   * This is the "lazy seed at first GET" implementation (Q2=lazy-seed
   * per the D.1 design decisions, NOT seeding from school-create or
   * tenant-seeder Lambda).
   */
  async ensureDefaultPolicy(
    schoolId: string,
    context: RequestContext,
  ): Promise<GradingPolicyEntity> {
    this.logger.debug(
      `ensureDefaultPolicy: entry, schoolId=${schoolId}`,
    );
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const archetype = await this.resolveTenantArchetype(context.tenantId);
    const seed = this.buildSeedFromArchetype(archetype);

    // Sprint B (B.2) — deterministic id keyed on the school so concurrent first
    // GETs contend on the same entityKey instead of each minting a fresh uuid.
    const policyId = uuidv5(`grading-policy-default:${schoolId}`, DEFAULT_POLICY_NAMESPACE);
    const entity = createGradingPolicyEntity(
      context.tenantId,
      policyId,
      schoolId,
      {
        policyName: seed.policyName,
        description: seed.description,
        gpaScale: seed.gpaScale,
        letterGrades: seed.letterGrades,
        categoryWeights: seed.categoryWeights,
        roundingRule: 'nearest',
        minimumPassingGrade: seed.minimumPassingGrade,
        isDefault: true,
        createdBy: context.userId,
      },
    );

    try {
      // Conditional write: only the first racer creates the seed. A loser gets
      // ConditionalCheckFailedException and adopts the winner — never a duplicate.
      await this.dynamoDBClient.putItem(client, entity, 'attribute_not_exists(entityKey)');
    } catch (error) {
      if ((error as { name?: string })?.name !== 'ConditionalCheckFailedException') {
        throw error;
      }
      this.logger.warn(
        `ensureDefaultPolicy: lost seed race for school ${schoolId}, adopting existing default`,
      );
      const winner = await this.queryActiveDefault(client, schoolId, context);
      if (winner) return winner;
      // Pathological: the contending row exists but isn't an active default.
      // Return the built entity rather than 5xx the operator's GET.
      return entity;
    }

    this.logger.log(
      `Auto-created default grading policy for school ${schoolId}: ${policyId} ` +
      `(archetype=${archetype ?? 'UNKNOWN'} → ${seed.letterGrades.length} letters)`,
    );
    this.logger.debug(
      `ensureDefaultPolicy: completed, policyId=${policyId}, schoolId=${schoolId}`,
    );

    return entity;
  }

  /**
   * Resolves the tenant's `archetype` from the identity METADATA row via the
   * inlined reader's honest-degradation contract (`getArchetype`):
   *   - `undefined` for a genuinely-missing row (not-yet-provisioned tenant) →
   *     quiet degrade to the US-default seed;
   *   - **throws** on an infra/permission failure (AccessDenied, throttle,
   *     timeout) — logged at ERROR (NOT warn) so the smoke / log alarms catch a
   *     missing GetItem grant, then degraded so the operator GET still responds.
   * Mirrors the other four archetype callers (board-exams/courses/exams/
   * promotion-rules) — this path used to swallow infra errors at WARN, the last
   * instance of the 2026-06-04 GB2 silent-degradation class.
   */
  private resolveTenantArchetype(tenantId: string): Promise<string | undefined> {
    return resolveArchetypeOrDegrade(
      this.getTenantMetadataReader(),
      tenantId,
      this.logger,
      'falling back to US-default scale',
    );
  }

  /**
   * Module-level singleton — instantiates the local DDB-direct reader.
   *
   * Originally planned to use `@edforge/tenant-settings-resolver` (which
   * has an LRU + TTL cache + the same `getTenantMetadata()` helper), but
   * that package is `"private": true` (workspace-only, not on npm
   * registry). The academics Dockerfile copies only
   * `server/application/package.json` then runs `npm install`, which
   * can't resolve workspace symlinks (same publish-gate constraint as
   * AdminWeb per CLAUDE.md). We inline the reader instead — see
   * `tenant-metadata-reader.service.ts` for the comment block on why.
   */
  private getTenantMetadataReader(): TenantMetadataReaderService {
    if (!this._tenantMetadataReader) {
      this._tenantMetadataReader = new TenantMetadataReaderService();
    }
    return this._tenantMetadataReader;
  }
  private _tenantMetadataReader?: TenantMetadataReaderService;

  /**
   * Builds the seed-policy data from an ArchetypeDefaults profile. Returns
   * a default US-scale seed when archetype is unknown.
   *
   * Note on field-name translation: ArchetypeDefaults uses `minPct`/`maxPct`
   * (master-plan vocab); academics GradingPolicy uses
   * `minPercentage`/`maxPercentage` (Q1=outer-rename-only decision in D.1.1).
   * The translation happens here.
   */
  private buildSeedFromArchetype(archetype: string | undefined): {
    policyName: string;
    description: string;
    gpaScale: '4.0' | '5.0';
    letterGrades: LetterGradeEntry[];
    categoryWeights: CategoryWeight[];
    minimumPassingGrade: number;
  } {
    let profile: ArchetypeDefaults | undefined;
    if (archetype) {
      try {
        profile = getArchetypeDefaults(archetype);
      } catch {
        profile = undefined;
      }
    }

    if (profile) {
      const gpaScaleStr: '4.0' | '5.0' = profile.gpaScale === 5.0 ? '5.0' : '4.0';
      return {
        policyName: `${profile.archetype} Default Grading Policy`,
        description:
          `Default grading scale seeded from ${profile.archetype} archetype defaults ` +
          `(${profile.letterGrades.length} letters incl. ${
            profile.letterGrades.some((l) => l.letter === 'NG') ? '`NG`' : 'no terminal-fail sentinel'
          }).`,
        gpaScale: gpaScaleStr,
        letterGrades: profile.letterGrades.map((l) => ({
          letter: l.letter,
          // Translate master-plan vocab → academics vocab (see comment above).
          minPercentage: l.minPct,
          maxPercentage: l.maxPct,
          gpaPoints: l.gpaPoints,
          isPassing: l.isPassing,
          isTerminalFail: l.isTerminalFail,
          displayName: l.displayName,
        })),
        categoryWeights: this.defaultCategoryWeights(),
        minimumPassingGrade: this.deriveMinimumPassing(profile),
      };
    }

    // US-default fallback (pre-D.1.3 behavior preserved when archetype unknown).
    return {
      policyName: 'Standard Grading Policy',
      description: 'Default A-F grading scale with standard category weights',
      gpaScale: '4.0',
      letterGrades: [
        { letter: 'A', minPercentage: 90, maxPercentage: 100, gpaPoints: 4.0, isPassing: true },
        { letter: 'B', minPercentage: 80, maxPercentage: 89.99, gpaPoints: 3.0, isPassing: true },
        { letter: 'C', minPercentage: 70, maxPercentage: 79.99, gpaPoints: 2.0, isPassing: true },
        { letter: 'D', minPercentage: 60, maxPercentage: 69.99, gpaPoints: 1.0, isPassing: true },
        { letter: 'F', minPercentage: 0, maxPercentage: 59.99, gpaPoints: 0.0, isPassing: false },
      ],
      categoryWeights: this.defaultCategoryWeights(),
      minimumPassingGrade: 60,
    };
  }

  private defaultCategoryWeights(): CategoryWeight[] {
    return [
      { categoryId: 'tests', categoryName: 'Tests', weight: 30 },
      { categoryId: 'quizzes', categoryName: 'Quizzes', weight: 20 },
      { categoryId: 'homework', categoryName: 'Homework', weight: 20 },
      { categoryId: 'participation', categoryName: 'Participation', weight: 10 },
      { categoryId: 'projects', categoryName: 'Projects', weight: 20 },
    ];
  }

  /**
   * Lowest-passing letter's `minPct` → policy's `minimumPassingGrade`. For
   * PABSON CEHRD that's `D+` at 35; for GENERIC US that's `D` at 60. If no
   * `isPassing: true` row exists (shouldn't happen on a sane archetype),
   * returns 60 as a conservative default.
   */
  private deriveMinimumPassing(profile: ArchetypeDefaults): number {
    const passing = profile.letterGrades
      .filter((l) => l.isPassing)
      .map((l) => l.minPct);
    if (passing.length === 0) return 60;
    return Math.min(...passing);
  }

  /**
   * List grading policies for a school
   */
  async listGradingPolicies(
    schoolId: string,
    context: RequestContext,
  ): Promise<GradingPolicyResponseDto[]> {
    this.logger.debug(
      `listGradingPolicies: entry, schoolId=${schoolId}`,
    );
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const queryActivePolicies = () =>
      this.dynamoDBClient.queryGSI<GradingPolicyEntity>(
        client,
        'GSI1',
        GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
        'GRADEPOLICY#',
        'begins_with',
        'isActive = :isActive',
        { ':isActive': true },
        undefined,
        100,
      );

    let result = await queryActivePolicies();

    // Sprint B (B.3) — read-path seed. A school with no policy rows must still
    // surface its governing scale (CEHRD NG for PABSON), not an empty list that
    // silently leaves the legacy fallback operative. Seed-on-empty via the
    // idempotent get-or-seed, then re-query so the seeded default is returned.
    if (result.items.length === 0) {
      this.logger.debug(
        `listGradingPolicies: no policies for schoolId=${schoolId}, seeding archetype default`,
      );
      const seeded = await this.getDefaultPolicyEntity(schoolId, context);
      result = await queryActivePolicies();
      // Pathological: the deterministic seed key exists but isn't an active row
      // (soft-deleted), so ensureDefaultPolicy returned an in-memory entity and
      // the re-query is still empty. Surface that entity so the list is never
      // empty — the B.3 guarantee — rather than falling back to legacy.
      if (result.items.length === 0 && seeded) {
        return [gradingPolicyEntityToDto(seeded)];
      }
    }

    this.logger.debug(
      `listGradingPolicies: resultCount=${result.items.length}, schoolId=${schoolId}`,
    );

    return result.items.map(gradingPolicyEntityToDto);
  }

  /**
   * Update a grading policy
   */
  async updateGradingPolicy(
    policyId: string,
    schoolId: string,
    dto: UpdateGradingPolicyDto,
    context: RequestContext,
  ): Promise<GradingPolicyResponseDto> {
    this.logger.debug(
      `updateGradingPolicy: entry, policyId=${policyId}, schoolId=${schoolId}, updatedFields=${Object.keys(dto).join(',')}`,
    );
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.gradingPolicy(schoolId, policyId);

    const existing = await this.dynamoDBClient.getItem<GradingPolicyEntity>(
      client,
      context.tenantId,
      entityKey,
    );

    if (!existing) {
      throw new NotFoundException(`Grading policy ${policyId} not found`);
    }

    // Validate if scale is being updated
    if (dto.letterGrades) {
      this.validateGradingScale(dto.letterGrades);
    }

    // Validate if weights are being updated
    if (dto.categoryWeights) {
      this.validateCategoryWeights(dto.categoryWeights);
    }

    // If setting as default, unset existing default
    if (dto.isDefault && !existing.isDefault) {
      await this.unsetDefaultPolicy(client, context.tenantId, schoolId);
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

    const fields: Array<{ key: keyof UpdateGradingPolicyDto; attr?: string }> = [
      { key: 'policyName' },
      { key: 'description' },
      { key: 'letterGrades' },
      { key: 'categoryWeights' },
      { key: 'dropLowestScores' },
      { key: 'roundingRule' },
      { key: 'minimumPassingGrade' },
      { key: 'isDefault' },
      { key: 'isActive' },
    ];

    for (const field of fields) {
      const value = dto[field.key];
      if (value !== undefined) {
        const attrName = field.attr || (field.key as string);
        updateParts.push(`${attrName} = :${attrName}`);
        expressionValues[`:${attrName}`] = value;
      }
    }

    // Update GSI1SK if policyName changed
    if (dto.policyName) {
      updateParts.push('gsi1sk = :gsi1sk');
      expressionValues[':gsi1sk'] = `GRADEPOLICY#${dto.policyName.toUpperCase()}`;
    }

    const updated = await this.dynamoDBClient.updateItem<GradingPolicyEntity>(
      client,
      context.tenantId,
      entityKey,
      `SET ${updateParts.join(', ')}`,
      expressionValues,
      'version = :currentVersion',
    );

    this.logger.log(`Grading policy updated: ${policyId}`);
    this.logger.debug(
      `updateGradingPolicy: completed, policyId=${policyId}, schoolId=${schoolId}`,
    );

    this.eventsService.publishGradingPolicyUpdated(
      context.tenantId, policyId, schoolId, Object.keys(dto),
    ).catch(err => this.logger.error('Failed to publish GradingPolicyUpdated event', err));

    return gradingPolicyEntityToDto(updated);
  }

  /**
   * Validate that grading scale ranges are contiguous and non-overlapping
   */
  private validateGradingScale(scale: LetterGradeEntry[]): void {
    if (!scale || scale.length === 0) {
      throw new BadRequestException('Grading scale must have at least one entry');
    }

    // Sort by minPercentage ascending for gap/overlap checks
    const sorted = [...scale].sort((a, b) => a.minPercentage - b.minPercentage);

    // Scale must start at 0
    if (sorted[0].minPercentage > 0) {
      throw new BadRequestException('Grading scale must start at 0%');
    }

    // Scale must end at 100
    if (sorted[sorted.length - 1].maxPercentage < 100) {
      throw new BadRequestException('Grading scale must cover up to 100%');
    }

    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i];
      if (entry.minPercentage > entry.maxPercentage) {
        throw new BadRequestException(
          `Grade ${entry.letter}: minPercentage (${entry.minPercentage}) must be <= maxPercentage (${entry.maxPercentage})`,
        );
      }

      // Check for overlaps and gaps with next entry
      if (i < sorted.length - 1) {
        const next = sorted[i + 1];
        if (entry.maxPercentage >= next.minPercentage) {
          throw new BadRequestException(
            `Grade scale overlap: ${entry.letter} (${entry.maxPercentage}) overlaps with ${next.letter} (${next.minPercentage})`,
          );
        }
        // Gap detection: next entry should start at most 1 above current max
        if (next.minPercentage - entry.maxPercentage > 1) {
          throw new BadRequestException(
            `Gap in grading scale between ${entry.maxPercentage}% (${entry.letter}) and ${next.minPercentage}% (${next.letter})`,
          );
        }
      }
    }
  }

  /**
   * Validate that category weights sum to 100%
   */
  private validateCategoryWeights(weights: CategoryWeight[]): void {
    if (!weights || weights.length === 0) {
      throw new BadRequestException('At least one category weight is required');
    }

    const total = weights.reduce((sum, w) => sum + w.weight, 0);
    if (Math.abs(total - 100) > 0.01) {
      throw new BadRequestException(
        `Category weights must sum to 100% (currently ${total}%)`,
      );
    }
  }

  /**
   * Unset the current default policy for a school
   */
  private async unsetDefaultPolicy(
    client: any,
    tenantId: string,
    schoolId: string,
  ): Promise<void> {
    const result = await this.dynamoDBClient.queryGSI<GradingPolicyEntity>(
      client,
      'GSI1',
      GSIKeyBuilder.schoolScope(tenantId, schoolId),
      'GRADEPOLICY#',
      'begins_with',
      'isDefault = :isDefault',
      { ':isDefault': true },
      undefined,
      10,
    );

    for (const policy of result.items) {
      await this.dynamoDBClient.updateItem(
        client,
        tenantId,
        EntityKeyBuilder.gradingPolicy(schoolId, policy.policyId),
        'SET isDefault = :isDefault, updatedAt = :updatedAt',
        {
          ':isDefault': false,
          ':updatedAt': new Date().toISOString(),
        },
      );
    }
  }
}
