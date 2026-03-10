/**
 * Bell Schedule Service - BellSchedule CRUD
 *
 * Manages Ed-Fi BellSchedule entities (named schedules defining
 * class period times for specific day types and date ranges).
 * Includes period overlap validation and default schedule management.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import {
  BellSchedule,
  BellScheduleKeyBuilder,
  createBellScheduleEntity,
  calculateTotalInstructionalTime,
  validatePeriodsNoOverlap,
} from '../common/entities/bell-schedule.entity';
import {
  CalendarDate,
  CalendarDateKeyBuilder,
} from '../common/entities/calendar-date.entity';
import { SchoolConfiguration } from '../common/entities/department.entity';
import { RequestContext, PaginatedResult, EntityKeyBuilder } from '../common/entities/base.entity';
import type {
  CreateBellScheduleDto,
  UpdateBellScheduleDto,
  BellScheduleResponseDto,
} from '@aibrains/shared-types';
import { validateBellSchedule, type SchoolHoursConfig } from '@aibrains/shared-types';

@Injectable()
export class BellScheduleService {
  private readonly logger = new Logger(BellScheduleService.name);

  constructor(private readonly dynamoDBClient: DynamoDBClientService) {}

  /**
   * Create a new bell schedule
   */
  async createBellSchedule(
    schoolId: string,
    createDto: CreateBellScheduleDto,
    context: RequestContext,
  ): Promise<BellScheduleResponseDto> {
    const now = new Date().toISOString();
    const bellScheduleId = uuid();
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Validate no overlapping periods within this schedule
    if (!validatePeriodsNoOverlap(createDto.classPeriods as any)) {
      throw new ConflictException('Class periods within this schedule have overlapping times');
    }

    // Validate bell schedule against school hours
    const schoolConfig = await this.dynamoDBClient.getItem<SchoolConfiguration>(
      client,
      context.tenantId,
      EntityKeyBuilder.schoolConfig(schoolId),
    );
    if (schoolConfig) {
      const hoursConfig: SchoolHoursConfig = {
        startTime: schoolConfig.startTime || '08:00',
        endTime: schoolConfig.endTime || '15:30',
        schoolDays: schoolConfig.schoolDays || [1, 2, 3, 4, 5],
        periodDuration: schoolConfig.periodDuration || 45,
      };
      const periods = (createDto.classPeriods as any[]).map((p, i) => ({
        number: i + 1,
        startTime: p.startTime,
        endTime: p.endTime,
        type: 'class' as const,
        label: p.classPeriodName || `Period ${i + 1}`,
      }));
      const hoursErrors = validateBellSchedule(periods, hoursConfig);
      if (hoursErrors.length > 0) {
        throw new BadRequestException(`Bell schedule violates school hours: ${hoursErrors.join('; ')}`);
      }
    }

    // If setting as default, unset any existing default
    if (createDto.isDefault) {
      await this.unsetCurrentDefault(schoolId, context);
    }

    // Calculate instructional time from periods
    const totalInstructionalTime =
      createDto.totalInstructionalTime ??
      calculateTotalInstructionalTime(createDto.classPeriods as any);

    const entity = createBellScheduleEntity(
      context.tenantId,
      schoolId,
      bellScheduleId,
      {
        bellScheduleName: createDto.bellScheduleName,
        alternateDayName: createDto.alternateDayName,
        dayType: createDto.dayType ?? 'regular',
        classPeriods: createDto.classPeriods as any,
        totalInstructionalTime,
        startTime: createDto.startTime,
        endTime: createDto.endTime,
        effectiveDate: createDto.effectiveDate,
        endDate: createDto.endDate,
        isDefault: createDto.isDefault ?? false,
        isActive: createDto.isActive ?? true,
        description: createDto.description,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      },
    );

    await this.dynamoDBClient.putItem(client, entity);

    this.logger.log(
      `BellSchedule created: ${entity.bellScheduleName} (${bellScheduleId}) for school ${schoolId}`,
    );

    return this.toResponse(entity);
  }

  /**
   * Get bell schedule by ID
   */
  async getBellSchedule(
    schoolId: string,
    bellScheduleId: string,
    context: RequestContext,
  ): Promise<BellScheduleResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entity = await this.dynamoDBClient.getItem<BellSchedule>(
      client,
      context.tenantId,
      BellScheduleKeyBuilder.bellSchedule(schoolId, bellScheduleId),
    );

    if (!entity) {
      throw new NotFoundException('Bell schedule not found');
    }

    return this.toResponse(entity);
  }

  /**
   * List bell schedules for a school
   */
  async listBellSchedules(
    schoolId: string,
    context: RequestContext,
  ): Promise<PaginatedResult<BellScheduleResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const result = await this.dynamoDBClient.query<BellSchedule>(
      client,
      context.tenantId,
      BellScheduleKeyBuilder.bellSchedulesPrefix(schoolId),
      'entityType = :entityType',
      { ':entityType': 'BELLSCHEDULE' },
      undefined,
      50,
    );

    // Sort by name for consistent ordering
    const sorted = result.items.sort((a, b) =>
      a.bellScheduleName.localeCompare(b.bellScheduleName),
    );

    return {
      items: sorted.map((s) => this.toResponse(s)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Update bell schedule
   */
  async updateBellSchedule(
    schoolId: string,
    bellScheduleId: string,
    updateDto: UpdateBellScheduleDto,
    context: RequestContext,
  ): Promise<BellScheduleResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entity = await this.dynamoDBClient.getItem<BellSchedule>(
      client,
      context.tenantId,
      BellScheduleKeyBuilder.bellSchedule(schoolId, bellScheduleId),
    );

    if (!entity) {
      throw new NotFoundException('Bell schedule not found');
    }

    // If classPeriods are being updated, validate and recalculate
    if (updateDto.classPeriods) {
      if (!validatePeriodsNoOverlap(updateDto.classPeriods as any)) {
        throw new ConflictException('Class periods within this schedule have overlapping times');
      }
    }

    // If setting as default, unset current default first
    if (updateDto.isDefault === true && !entity.isDefault) {
      await this.unsetCurrentDefault(schoolId, context);
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};
    const names: Record<string, string> = {};

    if (updateDto.bellScheduleName !== undefined) {
      updates.push('bellScheduleName = :bellScheduleName');
      values[':bellScheduleName'] = updateDto.bellScheduleName;
    }
    if (updateDto.alternateDayName !== undefined) {
      updates.push('alternateDayName = :alternateDayName');
      values[':alternateDayName'] = updateDto.alternateDayName;
    }
    if (updateDto.dayType !== undefined) {
      updates.push('dayType = :dayType');
      values[':dayType'] = updateDto.dayType;
    }
    if (updateDto.classPeriods !== undefined) {
      updates.push('classPeriods = :classPeriods');
      values[':classPeriods'] = updateDto.classPeriods;

      // Recalculate computed fields
      const newTotalInstructionalTime = calculateTotalInstructionalTime(updateDto.classPeriods as any);
      updates.push('totalInstructionalTime = :totalInstructionalTime');
      values[':totalInstructionalTime'] = newTotalInstructionalTime;
      updates.push('periodCount = :periodCount');
      values[':periodCount'] = updateDto.classPeriods.length;
      updates.push('instructionalPeriodCount = :instructionalPeriodCount');
      values[':instructionalPeriodCount'] = (updateDto.classPeriods as any[]).filter(
        (p: any) => p.isAcademic,
      ).length;
    }
    if (updateDto.totalInstructionalTime !== undefined && !updateDto.classPeriods) {
      updates.push('totalInstructionalTime = :totalInstructionalTime');
      values[':totalInstructionalTime'] = updateDto.totalInstructionalTime;
    }
    if (updateDto.startTime !== undefined) {
      updates.push('startTime = :startTime');
      values[':startTime'] = updateDto.startTime;
    }
    if (updateDto.endTime !== undefined) {
      updates.push('endTime = :endTime');
      values[':endTime'] = updateDto.endTime;
    }
    if (updateDto.effectiveDate !== undefined) {
      updates.push('effectiveDate = :effectiveDate');
      values[':effectiveDate'] = updateDto.effectiveDate;
    }
    if (updateDto.endDate !== undefined) {
      updates.push('endDate = :endDate');
      values[':endDate'] = updateDto.endDate;
    }
    if (updateDto.isDefault !== undefined) {
      updates.push('isDefault = :isDefault');
      values[':isDefault'] = updateDto.isDefault;
    }
    if (updateDto.isActive !== undefined) {
      updates.push('isActive = :isActive');
      values[':isActive'] = updateDto.isActive;
    }
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

    const updated = await this.dynamoDBClient.updateItem<BellSchedule>(
      client,
      context.tenantId,
      BellScheduleKeyBuilder.bellSchedule(schoolId, bellScheduleId),
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      Object.keys(names).length > 0 ? names : undefined,
    );

    this.logger.log(`BellSchedule updated: ${bellScheduleId}`);

    return this.toResponse(updated);
  }

  /**
   * Delete bell schedule
   */
  async deleteBellSchedule(
    schoolId: string,
    bellScheduleId: string,
    context: RequestContext,
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entity = await this.dynamoDBClient.getItem<BellSchedule>(
      client,
      context.tenantId,
      BellScheduleKeyBuilder.bellSchedule(schoolId, bellScheduleId),
    );

    if (!entity) {
      throw new NotFoundException('Bell schedule not found');
    }

    // Referential integrity: check if any calendar dates reference this schedule
    const calendarDates = await this.dynamoDBClient.query<CalendarDate>(
      client,
      context.tenantId,
      CalendarDateKeyBuilder.calendarDatesPrefix(schoolId),
      'bellScheduleId = :bellScheduleId',
      { ':bellScheduleId': bellScheduleId },
      undefined,
      1, // We only need to know if at least one exists
    );

    if (calendarDates.items.length > 0) {
      throw new ConflictException(
        'Cannot delete bell schedule assigned to calendar dates. Remove calendar assignments first.',
      );
    }

    await this.dynamoDBClient.deleteItem(
      client,
      context.tenantId,
      BellScheduleKeyBuilder.bellSchedule(schoolId, bellScheduleId),
    );

    this.logger.log(`BellSchedule deleted: ${bellScheduleId} from school ${schoolId}`);
  }

  /**
   * Set a bell schedule as the default for a school
   */
  async setDefaultSchedule(
    schoolId: string,
    bellScheduleId: string,
    context: RequestContext,
  ): Promise<BellScheduleResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entity = await this.dynamoDBClient.getItem<BellSchedule>(
      client,
      context.tenantId,
      BellScheduleKeyBuilder.bellSchedule(schoolId, bellScheduleId),
    );

    if (!entity) {
      throw new NotFoundException('Bell schedule not found');
    }

    // Unset current default
    await this.unsetCurrentDefault(schoolId, context);

    // Set this schedule as default
    const updated = await this.dynamoDBClient.updateItem<BellSchedule>(
      client,
      context.tenantId,
      BellScheduleKeyBuilder.bellSchedule(schoolId, bellScheduleId),
      'SET isDefault = :isDefault, updatedAt = :updatedAt, updatedBy = :updatedBy',
      {
        ':isDefault': true,
        ':updatedAt': new Date().toISOString(),
        ':updatedBy': context.userId,
      },
    );

    this.logger.log(`BellSchedule set as default: ${bellScheduleId} for school ${schoolId}`);

    return this.toResponse(updated);
  }

  // ============================================
  // Private Helpers
  // ============================================

  /**
   * Unset the current default bell schedule for a school.
   * Note: Not atomic — acceptable for MVP single-admin usage.
   */
  private async unsetCurrentDefault(
    schoolId: string,
    context: RequestContext,
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const result = await this.dynamoDBClient.query<BellSchedule>(
      client,
      context.tenantId,
      BellScheduleKeyBuilder.bellSchedulesPrefix(schoolId),
      'entityType = :entityType',
      { ':entityType': 'BELLSCHEDULE' },
      undefined,
      50,
    );

    const currentDefault = result.items.find((s) => s.isDefault);
    if (currentDefault) {
      await this.dynamoDBClient.updateItem<BellSchedule>(
        client,
        context.tenantId,
        BellScheduleKeyBuilder.bellSchedule(schoolId, currentDefault.bellScheduleId),
        'SET isDefault = :isDefault, updatedAt = :updatedAt',
        {
          ':isDefault': false,
          ':updatedAt': new Date().toISOString(),
        },
      );
    }
  }

  // ============================================
  // Response Mapper
  // ============================================

  private toResponse(entity: BellSchedule): BellScheduleResponseDto {
    return {
      bellScheduleId: entity.bellScheduleId,
      schoolId: entity.schoolId,
      tenantId: entity.tenantId,
      bellScheduleName: entity.bellScheduleName,
      alternateDayName: entity.alternateDayName,
      totalInstructionalTime: entity.totalInstructionalTime,
      dayType: entity.dayType as BellScheduleResponseDto['dayType'],
      classPeriods: entity.classPeriods as any,
      startTime: entity.startTime,
      endTime: entity.endTime,
      effectiveDate: entity.effectiveDate,
      endDate: entity.endDate,
      isDefault: entity.isDefault,
      isActive: entity.isActive,
      periodCount: entity.periodCount,
      instructionalPeriodCount: entity.instructionalPeriodCount,
      description: entity.description,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
