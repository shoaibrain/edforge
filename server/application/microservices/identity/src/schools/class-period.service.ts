/**
 * Class Period Service - Standalone ClassPeriod CRUD
 *
 * Manages Ed-Fi ClassPeriod entities (time blocks within a school day).
 * Includes time overlap validation within a school.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import {
  ClassPeriodEntity,
  ClassPeriodKeyBuilder,
  createClassPeriodEntity,
} from '../common/entities/class-period.entity';
import { RequestContext, PaginatedResult } from '../common/entities/base.entity';
import type { CreateClassPeriodDto, UpdateClassPeriodDto, ClassPeriodResponseDto } from '@aibrains/shared-types';

@Injectable()
export class ClassPeriodService {
  private readonly logger = new Logger(ClassPeriodService.name);

  constructor(private readonly dynamoDBClient: DynamoDBClientService) {}

  /**
   * Create a new class period
   */
  async createClassPeriod(
    schoolId: string,
    createDto: CreateClassPeriodDto,
    context: RequestContext
  ): Promise<ClassPeriodResponseDto> {
    const now = new Date().toISOString();
    const periodId = uuid();
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Validate no time overlap with existing periods
    await this.validateNoTimeOverlap(schoolId, createDto.startTime, createDto.endTime, context);

    const entity = createClassPeriodEntity(
      context.tenantId,
      schoolId,
      periodId,
      {
        classPeriodName: createDto.classPeriodName,
        startTime: createDto.startTime,
        endTime: createDto.endTime,
        sortOrder: createDto.sortOrder ?? 0,
        periodType: createDto.periodType ?? 'instructional',
        isAcademic: createDto.isAcademic ?? true,
        description: createDto.description,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );

    await this.dynamoDBClient.putItem(client, entity);

    this.logger.log(`ClassPeriod created: ${entity.classPeriodName} (${periodId}) for school ${schoolId}`);

    return this.toResponse(entity);
  }

  /**
   * Get class period by ID
   */
  async getClassPeriod(
    schoolId: string,
    periodId: string,
    context: RequestContext
  ): Promise<ClassPeriodResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entity = await this.dynamoDBClient.getItem<ClassPeriodEntity>(
      client,
      context.tenantId,
      ClassPeriodKeyBuilder.classPeriod(schoolId, periodId)
    );

    if (!entity) {
      throw new NotFoundException('Class period not found');
    }

    return this.toResponse(entity);
  }

  /**
   * List class periods for a school
   */
  async listClassPeriods(
    schoolId: string,
    context: RequestContext
  ): Promise<PaginatedResult<ClassPeriodResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const result = await this.dynamoDBClient.query<ClassPeriodEntity>(
      client,
      context.tenantId,
      ClassPeriodKeyBuilder.classPeriodsPrefix(schoolId),
      'entityType = :entityType',
      { ':entityType': 'CLASSPERIOD' },
      undefined,
      50
    );

    // Sort by sortOrder for consistent ordering
    const sorted = result.items.sort((a, b) => a.sortOrder - b.sortOrder);

    return {
      items: sorted.map(p => this.toResponse(p)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Update class period
   */
  async updateClassPeriod(
    schoolId: string,
    periodId: string,
    updateDto: UpdateClassPeriodDto,
    context: RequestContext
  ): Promise<ClassPeriodResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entity = await this.dynamoDBClient.getItem<ClassPeriodEntity>(
      client,
      context.tenantId,
      ClassPeriodKeyBuilder.classPeriod(schoolId, periodId)
    );

    if (!entity) {
      throw new NotFoundException('Class period not found');
    }

    // If times are changing, validate no overlap
    const newStartTime = updateDto.startTime ?? entity.startTime;
    const newEndTime = updateDto.endTime ?? entity.endTime;
    if (updateDto.startTime || updateDto.endTime) {
      await this.validateNoTimeOverlap(schoolId, newStartTime, newEndTime, context, periodId);
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};

    if (updateDto.classPeriodName) {
      updates.push('classPeriodName = :classPeriodName');
      values[':classPeriodName'] = updateDto.classPeriodName;
    }
    if (updateDto.startTime) {
      updates.push('startTime = :startTime');
      values[':startTime'] = updateDto.startTime;
    }
    if (updateDto.endTime) {
      updates.push('endTime = :endTime');
      values[':endTime'] = updateDto.endTime;
    }
    if (updateDto.startTime || updateDto.endTime) {
      const [sH, sM] = newStartTime.split(':').map(Number);
      const [eH, eM] = newEndTime.split(':').map(Number);
      updates.push('durationMinutes = :durationMinutes');
      values[':durationMinutes'] = (eH * 60 + eM) - (sH * 60 + sM);
    }
    if (updateDto.sortOrder !== undefined) {
      updates.push('sortOrder = :sortOrder');
      values[':sortOrder'] = updateDto.sortOrder;
    }
    if (updateDto.periodType) {
      updates.push('periodType = :periodType');
      values[':periodType'] = updateDto.periodType;
    }
    if (updateDto.isAcademic !== undefined) {
      updates.push('isAcademic = :isAcademic');
      values[':isAcademic'] = updateDto.isAcademic;
    }
    const names: Record<string, string> = {};

    if (updateDto.description !== undefined) {
      updates.push('#desc = :description');
      values[':description'] = updateDto.description;
      names['#desc'] = 'description';
    }

    if (updates.length === 0) {
      return this.toResponse(entity);
    }

    updates.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;

    const updated = await this.dynamoDBClient.updateItem<ClassPeriodEntity>(
      client,
      context.tenantId,
      ClassPeriodKeyBuilder.classPeriod(schoolId, periodId),
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      Object.keys(names).length > 0 ? names : undefined
    );

    this.logger.log(`ClassPeriod updated: ${periodId}`);

    return this.toResponse(updated);
  }

  /**
   * Delete class period
   */
  async deleteClassPeriod(
    schoolId: string,
    periodId: string,
    context: RequestContext
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entity = await this.dynamoDBClient.getItem<ClassPeriodEntity>(
      client,
      context.tenantId,
      ClassPeriodKeyBuilder.classPeriod(schoolId, periodId)
    );

    if (!entity) {
      throw new NotFoundException('Class period not found');
    }

    await this.dynamoDBClient.deleteItem(
      client,
      context.tenantId,
      ClassPeriodKeyBuilder.classPeriod(schoolId, periodId)
    );

    this.logger.log(`ClassPeriod deleted: ${periodId} from school ${schoolId}`);
  }

  // ============================================
  // Validation
  // ============================================

  /**
   * Validate that the new time range doesn't overlap with existing periods.
   * @param excludePeriodId - exclude this period from overlap check (for updates)
   */
  private async validateNoTimeOverlap(
    schoolId: string,
    startTime: string,
    endTime: string,
    context: RequestContext,
    excludePeriodId?: string
  ): Promise<void> {
    const existing = await this.listClassPeriods(schoolId, context);

    for (const period of existing.items) {
      if (excludePeriodId && period.periodId === excludePeriodId) continue;

      // Check overlap: two ranges overlap if start1 < end2 AND start2 < end1
      if (startTime < period.endTime && period.startTime < endTime) {
        throw new ConflictException(
          `Time range ${startTime}-${endTime} overlaps with "${period.classPeriodName}" (${period.startTime}-${period.endTime})`
        );
      }
    }
  }

  // ============================================
  // Response Mapper
  // ============================================

  private toResponse(entity: ClassPeriodEntity): ClassPeriodResponseDto {
    return {
      periodId: entity.periodId,
      schoolId: entity.schoolId,
      tenantId: entity.tenantId,
      classPeriodName: entity.classPeriodName,
      startTime: entity.startTime,
      endTime: entity.endTime,
      durationMinutes: entity.durationMinutes,
      sortOrder: entity.sortOrder,
      periodType: entity.periodType as ClassPeriodResponseDto['periodType'],
      isAcademic: entity.isAcademic,
      description: entity.description,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
