/**
 * Staff Employment History Service - Identity Service
 *
 * Provides an immutable audit trail of employment status changes.
 * History entries are created automatically when status changes occur.
 */

import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import {
  StaffEmploymentHistory,
  createEmploymentHistoryEntity,
} from '../common/entities/staff-employment-history.entity';
import {
  RequestContext,
  PaginatedResult,
} from '../common/entities/base.entity';
import type { EmploymentHistoryResponseDto } from '@aibrains/shared-types';

@Injectable()
export class StaffEmploymentHistoryService {
  private readonly logger = new Logger(StaffEmploymentHistoryService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
  ) {}

  // ============================================
  // Record Status Change
  // ============================================

  async recordStatusChange(
    staffId: string,
    previousStatus: string,
    newStatus: string,
    effectiveDate: string,
    context: RequestContext,
    reason?: string,
    notes?: string,
    staffName?: string,
  ): Promise<EmploymentHistoryResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const now = new Date().toISOString();
    const historyId = uuid();

    const entry = createEmploymentHistoryEntity(
      context.tenantId,
      historyId,
      staffId,
      now,
      {
        previousStatus,
        newStatus,
        effectiveDate,
        reason,
        notes,
        staffName,
        changedByName: context.email,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );

    await this.dynamoDBClient.putItem(client, entry);

    this.logger.log(`Employment history recorded: ${staffId} ${previousStatus} -> ${newStatus}`);

    return this.toResponse(entry);
  }

  // ============================================
  // List History for Staff
  // ============================================

  async listHistory(
    staffId: string,
    context: RequestContext
  ): Promise<PaginatedResult<EmploymentHistoryResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const result = await this.dynamoDBClient.query<StaffEmploymentHistory>(
      client,
      context.tenantId,
      `STAFF#${staffId}#EMPHIST#`,
      'entityType = :entityType',
      { ':entityType': 'STAFF_EMPLOYMENT_HISTORY' },
      undefined,
      100
    );

    return {
      items: result.items.map(e => this.toResponse(e)),
      hasMore: result.hasMore,
    };
  }

  // ============================================
  // Response Mapper
  // ============================================

  private toResponse(entry: StaffEmploymentHistory): EmploymentHistoryResponseDto {
    return {
      historyId: entry.id,
      staffId: entry.staffId,
      previousStatus: entry.previousStatus as any,
      newStatus: entry.newStatus as any,
      effectiveDate: entry.effectiveDate,
      reason: entry.reason,
      notes: entry.notes,
      staffName: entry.staffName,
      changedByName: entry.changedByName,
      createdAt: entry.createdAt,
    };
  }
}
