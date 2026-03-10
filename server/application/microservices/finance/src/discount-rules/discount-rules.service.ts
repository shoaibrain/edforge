import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { DiscountRuleEntity, createDiscountRuleEntity } from '../common/entities/discount-rule.entity';
import { EntityKeyBuilder, GSIKeyBuilder, RequestContext, decodeCursor } from '../common/entities/base.entity';
import { discountRuleEntityToDto } from '../common/mappers/discount-rule.mapper';
import { AuditLoggerService, AuditAction } from '@app/logger';
import type { DiscountRule, CreateDiscountRuleDto, UpdateDiscountRuleDto } from '@aibrains/shared-types';

@Injectable()
export class DiscountRulesService {
  private readonly logger = new Logger(DiscountRulesService.name);
  private readonly auditLogger = new AuditLoggerService('finance-service');

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: FinanceEventsService,
  ) {}

  async create(
    schoolId: string,
    dto: CreateDiscountRuleDto,
    context: RequestContext,
  ): Promise<DiscountRule> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const entity = createDiscountRuleEntity(context.tenantId, schoolId, dto, context.userId);

    await this.dynamoDBClient.putItem(client, entity);

    this.logger.log(
      `DiscountRuleCreated: tenantId=${context.tenantId}, schoolId=${schoolId}, id=${entity.discountRuleId}`,
    );

    this.auditLogger.log(
      AuditAction.DISCOUNT_RULE_CREATED,
      { tenantId: context.tenantId, userId: context.userId, userEmail: context.email, userRole: context.role },
      { type: 'DISCOUNT_RULE', id: entity.discountRuleId, name: entity.name },
      { schoolId, discountType: entity.type, value: entity.value },
    );

    return discountRuleEntityToDto(entity);
  }

  async list(
    schoolId: string,
    context: RequestContext,
    options: {
      academicYearId?: string;
      isActive?: boolean;
      limit?: number;
      cursor?: string;
    } = {},
  ): Promise<{ items: DiscountRule[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    // Build filter expression
    const filterParts: string[] = [];
    const filterValues: Record<string, any> = {};

    if (options.academicYearId) {
      filterParts.push('academicYearId = :academicYearId');
      filterValues[':academicYearId'] = options.academicYearId;
    }
    if (options.isActive !== undefined) {
      filterParts.push('isActive = :isActive');
      filterValues[':isActive'] = options.isActive;
    }

    const result = await this.dynamoDBClient.queryGSI<DiscountRuleEntity>(
      client,
      'GSI1',
      gsi1pk,
      'DISCOUNT_RULE',
      'begins_with',
      filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
      Object.keys(filterValues).length > 0 ? filterValues : undefined,
      undefined,
      options.limit || 50,
      true,
      decodeCursor(options.cursor),
    );

    return {
      items: result.items.map(discountRuleEntityToDto),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  async get(
    schoolId: string,
    discountRuleId: string,
    context: RequestContext,
  ): Promise<DiscountRule> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.discountRule(schoolId, discountRuleId);

    const entity = await this.dynamoDBClient.getItem<DiscountRuleEntity>(
      client,
      context.tenantId,
      entityKey,
    );

    if (!entity) {
      throw new NotFoundException(`Discount rule ${discountRuleId} not found`);
    }

    return discountRuleEntityToDto(entity);
  }

  async update(
    schoolId: string,
    discountRuleId: string,
    dto: UpdateDiscountRuleDto,
    context: RequestContext,
  ): Promise<DiscountRule> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.discountRule(schoolId, discountRuleId);

    // Verify exists
    const existing = await this.dynamoDBClient.getItem<DiscountRuleEntity>(
      client,
      context.tenantId,
      entityKey,
    );
    if (!existing) {
      throw new NotFoundException(`Discount rule ${discountRuleId} not found`);
    }

    const updateFields = Object.entries(dto).filter(([, v]) => v !== undefined);

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

    // If name or priority changed, update GSI1SK
    if (dto.name !== undefined || dto.priority !== undefined) {
      const newName = dto.name ?? existing.name;
      const newPriority = dto.priority ?? existing.priority;
      setParts.push('gsi1sk = :gsi1sk');
      exprValues[':gsi1sk'] = `DISCOUNT_RULE#${String(newPriority).padStart(3, '0')}#${newName.toUpperCase()}`;
    }

    const updated = await this.dynamoDBClient.updateItem<DiscountRuleEntity>(
      client,
      context.tenantId,
      entityKey,
      `SET ${setParts.join(', ')}`,
      exprValues,
      '#v = :currentVersion',
      exprNames,
    );

    this.logger.log(
      `DiscountRuleUpdated: tenantId=${context.tenantId}, schoolId=${schoolId}, id=${discountRuleId}`,
    );

    this.auditLogger.log(
      AuditAction.DISCOUNT_RULE_UPDATED,
      { tenantId: context.tenantId, userId: context.userId, userEmail: context.email, userRole: context.role },
      { type: 'DISCOUNT_RULE', id: discountRuleId, name: updated.name },
      { schoolId, updatedFields: updateFields.map(([k]) => k) },
    );

    return discountRuleEntityToDto(updated);
  }

  async delete(
    schoolId: string,
    discountRuleId: string,
    context: RequestContext,
  ): Promise<DiscountRule> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.discountRule(schoolId, discountRuleId);

    // Verify exists
    const existing = await this.dynamoDBClient.getItem<DiscountRuleEntity>(
      client,
      context.tenantId,
      entityKey,
    );
    if (!existing) {
      throw new NotFoundException(`Discount rule ${discountRuleId} not found`);
    }

    // Soft delete: set isActive=false and update GSI1SK to move out of active queries
    const updated = await this.dynamoDBClient.updateItem<DiscountRuleEntity>(
      client,
      context.tenantId,
      entityKey,
      'SET isActive = :isActive, updatedAt = :updatedAt, updatedBy = :updatedBy, gsi1sk = :gsi1sk, #v = #v + :one',
      {
        ':isActive': false,
        ':updatedAt': new Date().toISOString(),
        ':updatedBy': context.userId,
        ':gsi1sk': `DISCOUNT_RULE#DELETED#${existing.name.toUpperCase()}`,
        ':one': 1,
        ':currentVersion': existing.version,
      },
      '#v = :currentVersion',
      { '#v': 'version' },
    );

    this.logger.log(
      `DiscountRuleDeleted (soft): tenantId=${context.tenantId}, schoolId=${schoolId}, id=${discountRuleId}`,
    );

    this.auditLogger.log(
      AuditAction.DISCOUNT_RULE_DELETED,
      { tenantId: context.tenantId, userId: context.userId, userEmail: context.email, userRole: context.role },
      { type: 'DISCOUNT_RULE', id: discountRuleId, name: existing.name },
      { schoolId },
    );

    return discountRuleEntityToDto(updated);
  }

  async getApplicableDiscounts(
    schoolId: string,
    feeType: string,
    context: RequestContext,
  ): Promise<DiscountRule[]> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    const result = await this.dynamoDBClient.queryGSI<DiscountRuleEntity>(
      client,
      'GSI1',
      gsi1pk,
      'DISCOUNT_RULE',
      'begins_with',
      'isActive = :isActive',
      { ':isActive': true },
      undefined,
      100,
      false,
    );

    // Client-side filter: match rules whose applicableFeeTypes includes the requested feeType
    const matching = result.items.filter(
      (rule) => rule.applicableFeeTypes.includes(feeType as any),
    );

    // Already sorted by priority via GSI1SK (priority is zero-padded in the sort key)
    return matching.map(discountRuleEntityToDto);
  }
}
