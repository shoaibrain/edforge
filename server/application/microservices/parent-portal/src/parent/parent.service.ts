/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Parent Service - CRUD operations for Parent entities
 */

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/dynamodb-client.service';
import { Parent, RequestContext } from '../common/entities/parent.entities';
import { EntityKeyBuilder } from '../common/entities/base.entity';
import { CreateParentDto, UpdateParentDto } from './dto/parent.dto';
import { ParentEventsService } from '../common/services/parent-events.service';

@Injectable()
export class ParentService {
  private readonly logger = new Logger(ParentService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: ParentEventsService
  ) {}

  async createParent(
    tenantId: string,
    createParentDto: CreateParentDto,
    context: RequestContext
  ): Promise<Parent> {
    const parentId = uuid();
    const timestamp = new Date().toISOString();

    const parent: Parent = {
      tenantId,
      entityKey: EntityKeyBuilder.parent(parentId),
      entityType: 'PARENT',
      
      parentId,
      firstName: createParentDto.firstName,
      lastName: createParentDto.lastName,
      middleName: createParentDto.middleName,
      
      contactInfo: createParentDto.contactInfo,
      children: createParentDto.children || [],
      
      accountAccess: {
        portalEnabled: createParentDto.portalEnabled || false,
        notificationPreferences: {
          email: true,
          sms: true,
          push: false
        }
      },
      
      createdAt: timestamp,
      createdBy: context.userId,
      updatedAt: timestamp,
      updatedBy: context.userId,
      version: 1,
      
      gsi9pk: parentId,
      gsi9sk: 'PARENT#current'
    };

    // Set GSI keys for children relationships
    if (createParentDto.children && createParentDto.children.length > 0) {
      const firstChild = createParentDto.children[0];
      parent.gsi12pk = firstChild.studentId;
      parent.gsi12sk = `PARENT#${parentId}`;
    }

    await this.dynamoDBClient.putItem(parent);
    this.logger.log(`Parent created: ${parent.firstName} ${parent.lastName} (${parentId})`);
    return parent;
  }

  async getParent(tenantId: string, parentId: string): Promise<Parent> {
    const entityKey = EntityKeyBuilder.parent(parentId);
    const parent = await this.dynamoDBClient.getItem(tenantId, entityKey);

    if (!parent || parent.entityType !== 'PARENT') {
      throw new NotFoundException(`Parent not found: ${parentId}`);
    }

    return parent as Parent;
  }

  /**
   * Update Parent
   * Updates parent entity with optimistic locking
   */
  async updateParent(
    tenantId: string,
    parentId: string,
    updateDto: UpdateParentDto,
    context: RequestContext
  ): Promise<Parent> {
    const entityKey = EntityKeyBuilder.parent(parentId);
    
    // 1. Get existing parent
    const existingParent = await this.getParent(tenantId, parentId);
    
    // 2. Build update expression
    const timestamp = new Date().toISOString();
    const updateExpressions: string[] = [];
    const expressionAttributeValues: any = {
      ':updatedAt': timestamp,
      ':updatedBy': context.userId,
      ':inc': 1,
      ':currentVersion': existingParent.version
    };
    const expressionAttributeNames: any = {
      '#version': 'version'
    };

    // Update fields if provided
    if (updateDto.firstName !== undefined) {
      updateExpressions.push('firstName = :firstName');
      expressionAttributeValues[':firstName'] = updateDto.firstName;
    }

    if (updateDto.lastName !== undefined) {
      updateExpressions.push('lastName = :lastName');
      expressionAttributeValues[':lastName'] = updateDto.lastName;
    }

    if (updateDto.contactInfo !== undefined) {
      updateExpressions.push('contactInfo = :contactInfo');
      expressionAttributeValues[':contactInfo'] = updateDto.contactInfo;
    }

    if (updateDto.children !== undefined) {
      updateExpressions.push('children = :children');
      expressionAttributeValues[':children'] = updateDto.children;
      
      // Update GSI keys if children changed
      if (updateDto.children.length > 0) {
        const firstChild = updateDto.children[0];
        updateExpressions.push('gsi12pk = :gsi12pk');
        updateExpressions.push('gsi12sk = :gsi12sk');
        expressionAttributeValues[':gsi12pk'] = firstChild.studentId;
        expressionAttributeValues[':gsi12sk'] = `PARENT#${parentId}`;
      }
    }

    // Always update metadata
    updateExpressions.push('updatedAt = :updatedAt');
    updateExpressions.push('updatedBy = :updatedBy');
    updateExpressions.push('#version = #version + :inc');

    const updateExpression = `SET ${updateExpressions.join(', ')}`;
    const conditionExpression = '#version = :currentVersion';

    // 3. Update parent with optimistic locking
    try {
      const updatedParent = await this.dynamoDBClient.updateItem(
        tenantId,
        entityKey,
        updateExpression,
        expressionAttributeValues,
        conditionExpression,
        expressionAttributeNames
      ) as Parent;

      // 4. Publish ParentUpdated event
      const updatedFields = Object.keys(updateDto).filter(key => updateDto[key as keyof UpdateParentDto] !== undefined);
      try {
        await this.eventsService.publishParentUpdated({
          tenantId,
          parentId: updatedParent.parentId,
          firstName: updatedParent.firstName,
          lastName: updatedParent.lastName,
          updatedFields
        });
      } catch (eventError) {
        // Log but don't fail the update if event publishing fails
        this.logger.warn(`Failed to publish ParentUpdated event: ${eventError.message}`);
      }

      this.logger.log(`Parent updated: ${updatedParent.firstName} ${updatedParent.lastName} (${parentId})`);
      return updatedParent;
    } catch (error: any) {
      if (error.message?.includes('condition not met') || error.message?.includes('ConditionalCheckFailedException')) {
        throw new BadRequestException('Parent was modified by another operation. Please retry.');
      }
      throw error;
    }
  }

  /**
   * Delete Parent (Soft Delete)
   * Sets portalEnabled to false instead of hard delete
   */
  async deleteParent(
    tenantId: string,
    parentId: string,
    context: RequestContext
  ): Promise<{ message: string; parentId: string }> {
    const entityKey = EntityKeyBuilder.parent(parentId);
    
    // 1. Get existing parent
    const existingParent = await this.getParent(tenantId, parentId);
    
    // 2. Validate no active student relationships
    const activeChildren = existingParent.children?.filter(child => {
      // Check if relationship is still active (no end date or end date in future)
      return true; // For MVP, we'll allow deletion even with children
    }) || [];
    
    // For MVP, we'll allow deletion but log a warning
    if (activeChildren.length > 0) {
      this.logger.warn(`Deleting parent ${parentId} with ${activeChildren.length} active child relationships`);
    }
    
    // 3. Soft delete: Set portalEnabled to false
    const timestamp = new Date().toISOString();
    const updateExpression = 'SET accountAccess.portalEnabled = :portalEnabled, updatedAt = :updatedAt, updatedBy = :updatedBy, #version = #version + :inc';
    const expressionAttributeValues = {
      ':portalEnabled': false,
      ':updatedAt': timestamp,
      ':updatedBy': context.userId,
      ':inc': 1,
      ':currentVersion': existingParent.version
    };
    const expressionAttributeNames = {
      '#version': 'version'
    };
    const conditionExpression = '#version = :currentVersion';

    try {
      await this.dynamoDBClient.updateItem(
        tenantId,
        entityKey,
        updateExpression,
        expressionAttributeValues,
        conditionExpression,
        expressionAttributeNames
      );

      // 4. Publish ParentDeleted event (optional for MVP)
      try {
        await this.eventsService.publishParentDeleted({
          tenantId,
          parentId: existingParent.parentId,
          firstName: existingParent.firstName,
          lastName: existingParent.lastName,
          reason: 'Soft deleted via API'
        });
      } catch (eventError) {
        // Log but don't fail the delete if event publishing fails
        this.logger.warn(`Failed to publish ParentDeleted event: ${eventError.message}`);
      }

      this.logger.log(`Parent deleted (soft): ${existingParent.firstName} ${existingParent.lastName} (${parentId})`);
      return {
        message: 'Parent deleted successfully',
        parentId
      };
    } catch (error: any) {
      if (error.message?.includes('condition not met') || error.message?.includes('ConditionalCheckFailedException')) {
        throw new BadRequestException('Parent was modified by another operation. Please retry.');
      }
      throw error;
    }
  }

  async getParentsByStudent(tenantId: string, studentId: string): Promise<Parent[]> {
    const items = await this.dynamoDBClient.queryGSI(
      'GSI12',
      studentId,
      'PARENT#',
      'begins_with',
      undefined,
      undefined,
      undefined,
      100
    );

    return items.filter(item => item.tenantId === tenantId && item.entityType === 'PARENT') as Parent[];
  }
}

