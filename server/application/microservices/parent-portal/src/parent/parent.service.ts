/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Parent Service - CRUD operations for Parent entities
 */

import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/dynamodb-client.service';
import { Parent, RequestContext } from '../common/entities/parent.entities';
import { EntityKeyBuilder } from '../common/entities/base.entity';
import { CreateParentDto, UpdateParentDto } from './dto/parent.dto';

@Injectable()
export class ParentService {
  private readonly logger = new Logger(ParentService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService
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
      throw new Error(`Parent not found: ${parentId}`);
    }

    return parent as Parent;
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

