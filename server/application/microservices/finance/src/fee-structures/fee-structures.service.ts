import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import {
  FeeStructureEntity,
  createFeeStructureEntity,
} from '../common/entities/fee-structure.entity';
import { EntityKeyBuilder, GSIKeyBuilder, RequestContext, decodeCursor } from '../common/entities/base.entity';
import { feeStructureEntityToDto } from '../common/mappers/fee-structure.mapper';
import type { FeeStructure, CreateFeeStructureDto, UpdateFeeStructureDto } from '@aibrains/shared-types';

@Injectable()
export class FeeStructuresService {
  private readonly logger = new Logger(FeeStructuresService.name);

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

    const entity = createFeeStructureEntity(context.tenantId, schoolId, dto, context.userId);

    await this.dynamoDBClient.putItem(client, entity);

    this.eventsService.publishFeeStructureCreated(
      context.tenantId,
      schoolId,
      entity.feeStructureId,
      entity.name,
    ).catch(err => this.logger.error(`Failed to publish FeeStructureCreated: ${err.message}`));

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

    // Build update expression
    const setParts: string[] = ['updatedAt = :updatedAt', 'updatedBy = :updatedBy', '#v = #v + :one'];
    const exprValues: Record<string, any> = {
      ':updatedAt': new Date().toISOString(),
      ':updatedBy': context.userId,
      ':one': 1,
      ':currentVersion': existing.version,
    };
    const exprNames: Record<string, string> = { '#v': 'version' };

    const updateFields = Object.entries(dto).filter(([, v]) => v !== undefined);
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

    return feeStructureEntityToDto(updated);
  }

  async delete(
    schoolId: string,
    feeStructureId: string,
    context: RequestContext,
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.feeStructure(schoolId, feeStructureId);

    await this.dynamoDBClient.deleteItem(
      client,
      context.tenantId,
      entityKey,
      'attribute_exists(entityKey)',
    );
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
}
