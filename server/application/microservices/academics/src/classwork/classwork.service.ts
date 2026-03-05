/**
 * Classwork Service
 *
 * CRUD operations for classwork items (assignments, quizzes, materials, questions)
 * and organizational topics within class sections.
 *
 * Items are stored as standalone DynamoDB entities. When a classwork item of type
 * 'assignment' or 'quiz' is graded, its itemId is used as assignmentId on the
 * Grade entity's AssignmentGrade array (bridge pattern).
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { RequestContext, GSIKeyBuilder } from '../common/entities/base.entity';
import {
  ClassworkItem,
  ClassworkTopic,
  ClassworkItemType,
  ClassworkItemStatus,
  ClassworkAssessmentCategory,
  createClassworkItemEntity,
  createClassworkTopicEntity,
} from '../common/entities/classwork.entity';
import {
  ClassworkItemResponseDto,
  ClassworkTopicResponseDto,
  SectionClassworkResponseDto,
  classworkItemEntityToDto,
  classworkTopicEntityToDto,
} from '../common/mappers/classwork.mapper';

// ============================================================================
// DTOs
// ============================================================================

export interface CreateClassworkItemDto {
  sectionId: string;
  schoolId: string;
  type: ClassworkItemType;
  title: string;
  description?: string;
  topicId?: string;
  categoryId?: string;
  categoryName?: string;
  assessmentCategory?: ClassworkAssessmentCategory;
  possiblePoints?: number;
  dueDate?: string;
  status?: ClassworkItemStatus;
}

export interface UpdateClassworkItemDto {
  title?: string;
  description?: string;
  topicId?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  assessmentCategory?: ClassworkAssessmentCategory | null;
  possiblePoints?: number | null;
  dueDate?: string | null;
  status?: ClassworkItemStatus;
  sortOrder?: number;
}

export interface CreateClassworkTopicDto {
  sectionId: string;
  schoolId: string;
  name: string;
}

export interface UpdateClassworkTopicDto {
  name?: string;
  sortOrder?: number;
}

export interface ReorderItemDto {
  id: string;
  type: 'item' | 'topic';
  sortOrder: number;
  topicId?: string | null;
}

@Injectable()
export class ClassworkService {
  private readonly logger = new Logger(ClassworkService.name);

  constructor(
    private readonly dynamoDb: DynamoDBClientService,
    private readonly eventsService: AcademicsEventsService,
  ) {}

  // ============================================================================
  // HELPERS — Build DynamoDB update expressions from key-value map
  // ============================================================================

  private buildUpdateExpression(
    updates: Record<string, any>,
    conditionVersion?: number,
  ): {
    updateExpression: string;
    expressionAttributeValues: Record<string, any>;
    expressionAttributeNames: Record<string, string>;
    conditionExpression?: string;
  } {
    const setParts: string[] = [];
    const exprValues: Record<string, any> = {};
    const exprNames: Record<string, string> = {};

    for (const [key, value] of Object.entries(updates)) {
      const nameAlias = `#${key}`;
      const valueAlias = `:${key}`;
      exprNames[nameAlias] = key;
      setParts.push(`${nameAlias} = ${valueAlias}`);
      exprValues[valueAlias] = value;
    }

    // Always increment version (also aliased to avoid reserved-keyword issues)
    exprNames['#version'] = 'version';
    setParts.push('#version = if_not_exists(#version, :zero) + :inc');
    exprValues[':zero'] = 0;
    exprValues[':inc'] = 1;

    let conditionExpression: string | undefined;
    if (conditionVersion !== undefined) {
      conditionExpression = '#version = :expectedVersion';
      exprValues[':expectedVersion'] = conditionVersion;
    }

    return {
      updateExpression: `SET ${setParts.join(', ')}`,
      expressionAttributeValues: exprValues,
      expressionAttributeNames: exprNames,
      conditionExpression,
    };
  }

  private async getClient(context: RequestContext): Promise<DynamoDBDocumentClient> {
    return this.dynamoDb.getClient(context.tenantId, context.jwtToken);
  }

  // ============================================================================
  // TOPICS
  // ============================================================================

  async createTopic(
    dto: CreateClassworkTopicDto,
    context: RequestContext,
  ): Promise<ClassworkTopicResponseDto> {
    const client = await this.getClient(context);
    const topicId = uuidv4();

    // Get existing topics to determine sort order
    const existingTopics = await this.queryTopics(client, context.tenantId, dto.schoolId, dto.sectionId);
    const maxSortOrder = existingTopics.reduce((max, t) => Math.max(max, t.sortOrder), -1);

    const entity = createClassworkTopicEntity(
      context.tenantId,
      topicId,
      dto.schoolId,
      dto.sectionId,
      {
        name: dto.name,
        sortOrder: maxSortOrder + 1,
        createdBy: context.userId,
      },
    );

    await this.dynamoDb.putItem(client, entity);

    this.eventsService.publishClassworkTopicCreated(
      context.tenantId, topicId, dto.sectionId, dto.schoolId, dto.name,
    ).catch(err => this.logger.error('Failed to publish ClassworkTopicCreated event', err));

    return classworkTopicEntityToDto(entity);
  }

  async updateTopic(
    topicId: string,
    schoolId: string,
    sectionId: string,
    dto: UpdateClassworkTopicDto,
    context: RequestContext,
  ): Promise<ClassworkTopicResponseDto> {
    const client = await this.getClient(context);
    const entityKey = `CLASSWORK_TOPIC#${schoolId}#${sectionId}#${topicId}`;

    const existing = await this.dynamoDb.getItem<ClassworkTopic>(client, context.tenantId, entityKey);
    if (!existing) {
      throw new NotFoundException(`Topic ${topicId} not found`);
    }

    const updates: Record<string, any> = {
      updatedAt: new Date().toISOString(),
      updatedBy: context.userId,
    };
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.sortOrder !== undefined) updates.sortOrder = dto.sortOrder;

    const { updateExpression, expressionAttributeValues, expressionAttributeNames, conditionExpression } =
      this.buildUpdateExpression(updates, existing.version ?? 0);

    const updated = await this.dynamoDb.updateItem<ClassworkTopic>(
      client,
      context.tenantId,
      entityKey,
      updateExpression,
      expressionAttributeValues,
      conditionExpression,
      expressionAttributeNames,
    );

    this.eventsService.publishClassworkTopicUpdated(
      context.tenantId, topicId, sectionId, schoolId,
      Object.keys(updates).filter(k => k !== 'updatedAt' && k !== 'updatedBy'),
    ).catch(err => this.logger.error('Failed to publish ClassworkTopicUpdated event', err));

    return classworkTopicEntityToDto(updated);
  }

  async deleteTopic(
    topicId: string,
    schoolId: string,
    sectionId: string,
    context: RequestContext,
  ): Promise<void> {
    const client = await this.getClient(context);
    const entityKey = `CLASSWORK_TOPIC#${schoolId}#${sectionId}#${topicId}`;

    const existing = await this.dynamoDb.getItem<ClassworkTopic>(client, context.tenantId, entityKey);
    if (!existing) {
      throw new NotFoundException(`Topic ${topicId} not found`);
    }

    // Unassign items from this topic (set topicId = null)
    const items = await this.queryItems(client, context.tenantId, schoolId, sectionId);
    const topicItems = items.filter(item => item.topicId === topicId);

    for (const item of topicItems) {
      const unassignUpdates: Record<string, any> = {
        topicId: null,
        topicName: null,
        updatedAt: new Date().toISOString(),
        updatedBy: context.userId,
      };
      const { updateExpression, expressionAttributeValues, expressionAttributeNames } =
        this.buildUpdateExpression(unassignUpdates);

      await this.dynamoDb.updateItem(
        client,
        context.tenantId,
        item.entityKey,
        updateExpression,
        expressionAttributeValues,
        undefined,
        expressionAttributeNames,
      ).catch(err => this.logger.error(`Failed to unassign item ${item.itemId} from topic`, err));
    }

    await this.dynamoDb.deleteItem(client, context.tenantId, entityKey);

    this.eventsService.publishClassworkTopicDeleted(
      context.tenantId, topicId, sectionId, schoolId,
    ).catch(err => this.logger.error('Failed to publish ClassworkTopicDeleted event', err));
  }

  // ============================================================================
  // ITEMS
  // ============================================================================

  async createItem(
    dto: CreateClassworkItemDto,
    context: RequestContext,
  ): Promise<ClassworkItemResponseDto> {
    const client = await this.getClient(context);
    const itemId = uuidv4();

    // Resolve topic name if topicId provided
    let topicName: string | undefined;
    if (dto.topicId) {
      const topicEntityKey = `CLASSWORK_TOPIC#${dto.schoolId}#${dto.sectionId}#${dto.topicId}`;
      const topic = await this.dynamoDb.getItem<ClassworkTopic>(
        client, context.tenantId, topicEntityKey,
      );
      topicName = topic?.name;
    }

    // Determine sort order
    const existingItems = await this.queryItems(client, context.tenantId, dto.schoolId, dto.sectionId);
    const maxSortOrder = existingItems.reduce((max, i) => Math.max(max, i.sortOrder), -1);

    const entity = createClassworkItemEntity(
      context.tenantId,
      itemId,
      dto.schoolId,
      dto.sectionId,
      {
        type: dto.type,
        title: dto.title,
        description: dto.description,
        topicId: dto.topicId,
        topicName,
        sortOrder: maxSortOrder + 1,
        categoryId: dto.categoryId,
        categoryName: dto.categoryName,
        assessmentCategory: dto.assessmentCategory,
        possiblePoints: dto.possiblePoints,
        dueDate: dto.dueDate,
        status: dto.status || 'draft',
        createdBy: context.userId,
      },
    );

    await this.dynamoDb.putItem(client, entity);

    this.eventsService.publishClassworkItemCreated(
      context.tenantId, itemId, dto.sectionId, dto.schoolId, dto.type, dto.title,
    ).catch(err => this.logger.error('Failed to publish ClassworkItemCreated event', err));

    return classworkItemEntityToDto(entity);
  }

  async updateItem(
    itemId: string,
    schoolId: string,
    sectionId: string,
    dto: UpdateClassworkItemDto,
    context: RequestContext,
  ): Promise<ClassworkItemResponseDto> {
    const client = await this.getClient(context);
    const entityKey = `CLASSWORK#${schoolId}#${sectionId}#${itemId}`;

    const existing = await this.dynamoDb.getItem<ClassworkItem>(client, context.tenantId, entityKey);
    if (!existing) {
      throw new NotFoundException(`Classwork item ${itemId} not found`);
    }

    const updates: Record<string, any> = {
      updatedAt: new Date().toISOString(),
      updatedBy: context.userId,
    };

    if (dto.title !== undefined) updates.title = dto.title;
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.topicId !== undefined) {
      updates.topicId = dto.topicId;
      if (dto.topicId) {
        const topicEntityKey = `CLASSWORK_TOPIC#${schoolId}#${sectionId}#${dto.topicId}`;
        const topic = await this.dynamoDb.getItem<ClassworkTopic>(
          client, context.tenantId, topicEntityKey,
        );
        updates.topicName = topic?.name || null;
      } else {
        updates.topicName = null;
      }
    }
    if (dto.categoryId !== undefined) updates.categoryId = dto.categoryId;
    if (dto.categoryName !== undefined) updates.categoryName = dto.categoryName;
    if (dto.assessmentCategory !== undefined) updates.assessmentCategory = dto.assessmentCategory;
    if (dto.possiblePoints !== undefined) updates.possiblePoints = dto.possiblePoints;
    if (dto.dueDate !== undefined) updates.dueDate = dto.dueDate;
    if (dto.status !== undefined) {
      updates.status = dto.status;
      if (dto.status === 'published' && !existing.publishedAt) {
        updates.publishedAt = new Date().toISOString();
      }
    }
    if (dto.sortOrder !== undefined) updates.sortOrder = dto.sortOrder;

    const { updateExpression, expressionAttributeValues, expressionAttributeNames, conditionExpression } =
      this.buildUpdateExpression(updates, existing.version ?? 0);

    const updated = await this.dynamoDb.updateItem<ClassworkItem>(
      client,
      context.tenantId,
      entityKey,
      updateExpression,
      expressionAttributeValues,
      conditionExpression,
      expressionAttributeNames,
    );

    this.eventsService.publishClassworkItemUpdated(
      context.tenantId, itemId, sectionId, schoolId,
      Object.keys(updates).filter(k => k !== 'updatedAt' && k !== 'updatedBy'),
    ).catch(err => this.logger.error('Failed to publish ClassworkItemUpdated event', err));

    return classworkItemEntityToDto(updated);
  }

  async deleteItem(
    itemId: string,
    schoolId: string,
    sectionId: string,
    context: RequestContext,
  ): Promise<void> {
    const client = await this.getClient(context);
    const entityKey = `CLASSWORK#${schoolId}#${sectionId}#${itemId}`;

    const existing = await this.dynamoDb.getItem<ClassworkItem>(client, context.tenantId, entityKey);
    if (!existing) {
      throw new NotFoundException(`Classwork item ${itemId} not found`);
    }

    await this.dynamoDb.deleteItem(client, context.tenantId, entityKey);

    this.eventsService.publishClassworkItemDeleted(
      context.tenantId, itemId, sectionId, schoolId, existing.type,
    ).catch(err => this.logger.error('Failed to publish ClassworkItemDeleted event', err));
  }

  // ============================================================================
  // QUERIES
  // ============================================================================

  async getSectionClasswork(
    sectionId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<SectionClassworkResponseDto> {
    const client = await this.getClient(context);

    const [items, topics] = await Promise.all([
      this.queryItems(client, context.tenantId, schoolId, sectionId),
      this.queryTopics(client, context.tenantId, schoolId, sectionId),
    ]);

    // Sort in-memory by sortOrder
    const sortedTopics = topics
      .map(classworkTopicEntityToDto)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const sortedItems = items
      .map(classworkItemEntityToDto)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    return { sectionId, topics: sortedTopics, items: sortedItems };
  }

  // ============================================================================
  // REORDER
  // ============================================================================

  async reorderItems(
    schoolId: string,
    sectionId: string,
    reorderItems: ReorderItemDto[],
    context: RequestContext,
  ): Promise<void> {
    const client = await this.getClient(context);
    const now = new Date().toISOString();

    for (const item of reorderItems) {
      const entityKeyPrefix = item.type === 'topic' ? 'CLASSWORK_TOPIC' : 'CLASSWORK';
      const entityKey = `${entityKeyPrefix}#${schoolId}#${sectionId}#${item.id}`;

      const updates: Record<string, any> = {
        sortOrder: item.sortOrder,
        updatedAt: now,
        updatedBy: context.userId,
      };

      if (item.type === 'item' && item.topicId !== undefined) {
        updates.topicId = item.topicId;
      }

      const { updateExpression, expressionAttributeValues, expressionAttributeNames } =
        this.buildUpdateExpression(updates);

      await this.dynamoDb.updateItem(
        client,
        context.tenantId,
        entityKey,
        updateExpression,
        expressionAttributeValues,
        undefined,
        expressionAttributeNames,
      ).catch(err => this.logger.error(`Failed to reorder ${item.type} ${item.id}`, err));
    }
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private async queryItems(
    client: DynamoDBDocumentClient,
    tenantId: string,
    schoolId: string,
    sectionId: string,
  ): Promise<ClassworkItem[]> {
    const gsi1pk = GSIKeyBuilder.schoolScope(tenantId, schoolId);
    const skPrefix = `CLASSWORK#${sectionId}#`;

    const result = await this.dynamoDb.queryGSI<ClassworkItem>(
      client,
      'GSI1',
      gsi1pk,
      skPrefix,
      'begins_with',
    );

    return result.items || [];
  }

  private async queryTopics(
    client: DynamoDBDocumentClient,
    tenantId: string,
    schoolId: string,
    sectionId: string,
  ): Promise<ClassworkTopic[]> {
    const gsi1pk = GSIKeyBuilder.schoolScope(tenantId, schoolId);
    const skPrefix = `CLASSWORK_TOPIC#${sectionId}#`;

    const result = await this.dynamoDb.queryGSI<ClassworkTopic>(
      client,
      'GSI1',
      gsi1pk,
      skPrefix,
      'begins_with',
    );

    return result.items || [];
  }
}
