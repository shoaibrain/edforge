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
import { v4 as uuid } from 'uuid';
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
import { GradingScaleEntry, CategoryWeight } from '../common/entities/grade.entity';
import {
  GradingPolicyResponseDto,
  gradingPolicyEntityToDto,
} from '../common/mappers/grading-policy.mapper';

export interface CreateGradingPolicyDto {
  schoolId: string;
  policyName: string;
  description?: string;
  gradingScale: GradingScaleEntry[];
  categoryWeights: CategoryWeight[];
  dropLowestScores?: { categoryId: string; count: number }[];
  roundingRule: 'up' | 'down' | 'nearest';
  minimumPassingGrade: number;
  isDefault?: boolean;
}

export interface UpdateGradingPolicyDto {
  policyName?: string;
  description?: string;
  gradingScale?: GradingScaleEntry[];
  categoryWeights?: CategoryWeight[];
  dropLowestScores?: { categoryId: string; count: number }[];
  roundingRule?: 'up' | 'down' | 'nearest';
  minimumPassingGrade?: number;
  isDefault?: boolean;
  isActive?: boolean;
}

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
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Validate grading scale ranges
    this.validateGradingScale(dto.gradingScale);

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
        gradingScale: dto.gradingScale,
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

    this.eventsService.publishEvent({
      eventType: 'GradingPolicyCreated',
      timestamp: new Date().toISOString(),
      tenantId: context.tenantId,
      policyId,
      schoolId: dto.schoolId,
      policyName: dto.policyName,
    }).catch(err => this.logger.error('Failed to publish GradingPolicyCreated event', err));

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
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const entity = await this.dynamoDBClient.getItem<GradingPolicyEntity>(
      client,
      context.tenantId,
      EntityKeyBuilder.gradingPolicy(schoolId, policyId),
    );

    if (!entity) {
      throw new NotFoundException(`Grading policy ${policyId} not found`);
    }

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
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const result = await this.dynamoDBClient.queryGSI<GradingPolicyEntity>(
      client,
      'GSI1',
      GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
      'GRADEPOLICY#',
      'begins_with',
      'isDefault = :isDefault AND isActive = :isActive',
      { ':isDefault': true, ':isActive': true },
      undefined,
      1,
    );

    if (result.items.length > 0) {
      return result.items[0];
    }

    // No default policy exists — auto-create one
    return this.ensureDefaultPolicy(schoolId, context);
  }

  /**
   * Ensure a default grading policy exists for a school.
   * Creates a standard A-F policy if none exists.
   */
  async ensureDefaultPolicy(
    schoolId: string,
    context: RequestContext,
  ): Promise<GradingPolicyEntity> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const policyId = uuid();
    const entity = createGradingPolicyEntity(
      context.tenantId,
      policyId,
      schoolId,
      {
        policyName: 'Standard Grading Policy',
        description: 'Default A-F grading scale with standard category weights',
        gradingScale: [
          { letter: 'A', minPercentage: 90, maxPercentage: 100, gpaPoints: 4.0 },
          { letter: 'B', minPercentage: 80, maxPercentage: 89.99, gpaPoints: 3.0 },
          { letter: 'C', minPercentage: 70, maxPercentage: 79.99, gpaPoints: 2.0 },
          { letter: 'D', minPercentage: 60, maxPercentage: 69.99, gpaPoints: 1.0 },
          { letter: 'F', minPercentage: 0, maxPercentage: 59.99, gpaPoints: 0.0 },
        ],
        categoryWeights: [
          { categoryId: 'tests', categoryName: 'Tests', weight: 30 },
          { categoryId: 'quizzes', categoryName: 'Quizzes', weight: 20 },
          { categoryId: 'homework', categoryName: 'Homework', weight: 20 },
          { categoryId: 'participation', categoryName: 'Participation', weight: 10 },
          { categoryId: 'projects', categoryName: 'Projects', weight: 20 },
        ],
        roundingRule: 'nearest',
        minimumPassingGrade: 60,
        isDefault: true,
        createdBy: context.userId,
      },
    );

    await this.dynamoDBClient.putItem(client, entity);

    this.logger.log(`Auto-created default grading policy for school ${schoolId}: ${policyId}`);

    return entity;
  }

  /**
   * List grading policies for a school
   */
  async listGradingPolicies(
    schoolId: string,
    context: RequestContext,
  ): Promise<GradingPolicyResponseDto[]> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const result = await this.dynamoDBClient.queryGSI<GradingPolicyEntity>(
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
    if (dto.gradingScale) {
      this.validateGradingScale(dto.gradingScale);
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
      { key: 'gradingScale' },
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

    this.eventsService.publishEvent({
      eventType: 'GradingPolicyUpdated',
      timestamp: new Date().toISOString(),
      tenantId: context.tenantId,
      policyId,
      schoolId,
      updatedFields: Object.keys(dto),
    }).catch(err => this.logger.error('Failed to publish GradingPolicyUpdated event', err));

    return gradingPolicyEntityToDto(updated);
  }

  /**
   * Validate that grading scale ranges are contiguous and non-overlapping
   */
  private validateGradingScale(scale: GradingScaleEntry[]): void {
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
