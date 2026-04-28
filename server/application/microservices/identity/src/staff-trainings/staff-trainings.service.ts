/**
 * StaffTrainings Service — Identity Service (Sprint B.4)
 *
 * CRUD for staff professional development / training records. Mirrors the
 * Credentials service pattern (Sprint S4.7) for shape consistency, with the
 * differences justified in [staff-training-entity-design.md] (B.1 ADR):
 *   - no verification workflow (trainings are operator-recorded, not HR-verified)
 *   - no expiration-soon list (V1; can add GSI2 if/when CEHRD asks)
 *   - operator-set status (not date-derived) — see ADR §5.5
 *
 * IEMIS audit (Sprint B.7):
 *   - `staff.training.created`  — emitted on every successful create
 *   - `staff.training.edited`   — emitted on update (with `changedFields`)
 *   - `staff.training.deleted`  — emitted on hard-delete
 *
 * Audit metadata is PII-clean per S4.7 pattern: ONLY the typed Ed-Fi-style
 * fields (`staffId`, `trainingId`, `trainingType`, `trainingProvider`,
 * `durationHours`, `status`) appear in metadata. NEVER `trainingTitle`,
 * `notes`, `certificateNumber`, `certificateUrl`. The B.8 smoke asserts.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IemisAuditLogger } from '../common/services/iemis-audit-logger.service';
import {
  StaffTraining,
  TrainingType,
  TrainingStatus,
  createStaffTrainingEntity,
  StaffTrainingKeyBuilder,
} from '../common/entities/staff-training.entity';
import {
  Staff,
  StaffKeyBuilder,
} from '../common/entities/staff.entity';
import {
  RequestContext,
  PaginatedResult,
} from '../common/entities/base.entity';
import type {
  CreateStaffTrainingDto,
  UpdateStaffTrainingDto,
  StaffTrainingResponseDto,
  StaffTrainingFilterDto,
} from '@aibrains/shared-types';

@Injectable()
export class StaffTrainingsService {
  private readonly logger = new Logger(StaffTrainingsService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly iemisAuditLogger: IemisAuditLogger,
  ) {}

  // ============================================
  // Create
  // ============================================

  async createTraining(
    staffId: string,
    createDto: CreateStaffTrainingDto,
    context: RequestContext,
  ): Promise<StaffTrainingResponseDto> {
    const now = new Date().toISOString();
    const trainingId = uuid();

    // Verify staff exists
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const staff = await this.dynamoDBClient.getItem<Staff>(
      client,
      context.tenantId,
      StaffKeyBuilder.staff(staffId),
    );
    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }

    const training = createStaffTrainingEntity(
      context.tenantId,
      staffId,
      trainingId,
      {
        trainingTitle: createDto.trainingTitle,
        trainingType: createDto.trainingType as TrainingType,
        trainingProvider: createDto.trainingProvider,
        startDate: createDto.startDate,
        endDate: createDto.endDate,
        durationHours: createDto.durationHours,
        status: (createDto.status ?? 'completed') as TrainingStatus,
        certificateNumber: createDto.certificateNumber,
        certificateUrl: createDto.certificateUrl,
        notes: createDto.notes,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      },
    );

    await this.dynamoDBClient.putItem(client, training);
    this.logger.log(`StaffTraining created: ${trainingId} for staff ${staffId}`);

    // Sprint B.7 — IEMIS audit emit (fail-open per logger contract).
    // Metadata is Ed-Fi-aligned typed fields ONLY. trainingTitle, notes,
    // certificateNumber, certificateUrl are explicitly NOT included.
    void this.iemisAuditLogger.emit(
      {
        eventType: 'staff.training.created',
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorName: context.email,
        metadata: {
          staffId,
          trainingId,
          trainingType: training.trainingType,
          trainingProvider: training.trainingProvider,
          durationHours: training.durationHours,
          status: training.status,
        },
      },
      context.jwtToken,
    );

    return this.toResponse(training);
  }

  // ============================================
  // Get by ID
  // ============================================

  async getTraining(
    staffId: string,
    trainingId: string,
    context: RequestContext,
  ): Promise<StaffTrainingResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const training = await this.dynamoDBClient.getItem<StaffTraining>(
      client,
      context.tenantId,
      StaffTrainingKeyBuilder.training(staffId, trainingId),
    );
    if (!training) {
      throw new NotFoundException('Training not found');
    }
    return this.toResponse(training);
  }

  // ============================================
  // List for staff
  // ============================================

  async listTrainings(
    staffId: string,
    context: RequestContext,
    filter?: StaffTrainingFilterDto & { limit?: number },
  ): Promise<PaginatedResult<StaffTrainingResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const limit = filter?.limit || 20;

    const result = await this.dynamoDBClient.query<StaffTraining>(
      client,
      context.tenantId,
      StaffTrainingKeyBuilder.trainingsPrefix(staffId),
      'entityType = :entityType',
      { ':entityType': 'STAFF_TRAINING' },
      undefined,
      limit,
    );

    // Apply filters in memory for V1 (consistent with credentials list pattern)
    let filtered = result.items;

    if (filter?.trainingType) {
      filtered = filtered.filter((t) => t.trainingType === filter.trainingType);
    }
    if (filter?.status) {
      filtered = filtered.filter((t) => t.status === filter.status);
    }
    if (filter?.startDateFrom) {
      filtered = filtered.filter((t) => t.startDate >= filter.startDateFrom!);
    }
    if (filter?.startDateTo) {
      filtered = filtered.filter((t) => t.startDate <= filter.startDateTo!);
    }

    return {
      items: filtered.map((t) => this.toResponse(t)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  // ============================================
  // Update
  // ============================================

  async updateTraining(
    staffId: string,
    trainingId: string,
    updateDto: UpdateStaffTrainingDto,
    context: RequestContext,
  ): Promise<StaffTrainingResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const existing = await this.dynamoDBClient.getItem<StaffTraining>(
      client,
      context.tenantId,
      StaffTrainingKeyBuilder.training(staffId, trainingId),
    );
    if (!existing) {
      throw new NotFoundException('Training not found');
    }

    // Cross-field date validation when only one date is in the update —
    // the Zod refine on updateStaffTrainingSchema only fires when BOTH
    // are present in the payload. Service layer has the existing entity
    // and is responsible for the asymmetric check.
    const effectiveStart = updateDto.startDate ?? existing.startDate;
    const effectiveEnd = updateDto.endDate ?? existing.endDate;
    if (effectiveStart && effectiveEnd && effectiveEnd < effectiveStart) {
      throw new NotFoundException('endDate must be on or after startDate');
    }

    // Build update expression
    const updates: string[] = [];
    const values: Record<string, unknown> = {};
    const names: Record<string, string> = {};

    const simpleFields: readonly string[] = [
      'trainingTitle',
      'trainingType',
      'trainingProvider',
      'startDate',
      'endDate',
      'durationHours',
      'status',
      'certificateNumber',
      'certificateUrl',
      'notes',
    ];

    // Use expression attribute names for ALL fields to dodge DDB reserved
    // keywords (e.g., 'status' is reserved).
    for (const field of simpleFields) {
      const value = (updateDto as Record<string, unknown>)[field];
      if (value !== undefined) {
        updates.push(`#${field} = :${field}`);
        values[`:${field}`] = value;
        names[`#${field}`] = field;
      }
    }

    // If trainingType is changing, also re-derive the GSI1PK so the type
    // lookup index stays consistent.
    if (updateDto.trainingType !== undefined) {
      updates.push('#GSI1PK = :GSI1PK');
      values[':GSI1PK'] = StaffTrainingKeyBuilder.typeLookup(updateDto.trainingType as TrainingType);
      names['#GSI1PK'] = 'GSI1PK';
    }
    // Same for startDate → GSI1SK
    if (updateDto.startDate !== undefined) {
      updates.push('#GSI1SK = :GSI1SK');
      values[':GSI1SK'] = StaffTrainingKeyBuilder.startDateSort(updateDto.startDate);
      names['#GSI1SK'] = 'GSI1SK';
    }

    if (updates.length === 0) {
      return this.toResponse(existing);
    }

    updates.push('#updatedAt = :updatedAt', '#updatedBy = :updatedBy', '#version = #version + :inc');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;
    values[':inc'] = 1;
    names['#updatedAt'] = 'updatedAt';
    names['#updatedBy'] = 'updatedBy';
    names['#version'] = 'version';

    const updated = await this.dynamoDBClient.updateItem<StaffTraining>(
      client,
      context.tenantId,
      StaffTrainingKeyBuilder.training(staffId, trainingId),
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      names,
    );

    this.logger.log(`StaffTraining updated: ${trainingId}`);

    // Sprint B.7 — audit emit. `changedFields` lists the whitelisted
    // attribute names the caller actually changed, excluding bookkeeping
    // (updatedAt/updatedBy/inc) and derived GSI keys.
    const changedFields = Object.keys(values)
      .map((k) => k.replace(/^:/, ''))
      .filter((f) => f !== 'updatedAt' && f !== 'updatedBy' && f !== 'inc' && f !== 'GSI1PK' && f !== 'GSI1SK');

    // Status changes get explicit before/after metadata (mirrors S4.7
    // verifyCredential pattern — status is the most operationally-relevant
    // change auditors triage on).
    const statusChanged = changedFields.includes('status') &&
      existing.status !== updated.status;

    void this.iemisAuditLogger.emit(
      {
        eventType: 'staff.training.edited',
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorName: context.email,
        metadata: {
          staffId,
          trainingId,
          trainingType: updated.trainingType,
          changedFields,
          ...(statusChanged
            ? {
                before: { status: existing.status },
                after: { status: updated.status },
              }
            : {}),
        },
      },
      context.jwtToken,
    );

    return this.toResponse(updated);
  }

  // ============================================
  // Delete
  // ============================================

  async deleteTraining(
    staffId: string,
    trainingId: string,
    context: RequestContext,
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const existing = await this.dynamoDBClient.getItem<StaffTraining>(
      client,
      context.tenantId,
      StaffTrainingKeyBuilder.training(staffId, trainingId),
    );
    if (!existing) {
      throw new NotFoundException('Training not found');
    }

    await this.dynamoDBClient.deleteItem(
      client,
      context.tenantId,
      StaffTrainingKeyBuilder.training(staffId, trainingId),
    );

    this.logger.log(`StaffTraining deleted: ${trainingId}`);

    // Sprint B.7 — audit emit. Metadata captures the trainingType so
    // operators triaging can see what category was deleted without
    // needing the now-gone entity.
    void this.iemisAuditLogger.emit(
      {
        eventType: 'staff.training.deleted',
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorName: context.email,
        metadata: {
          staffId,
          trainingId,
          trainingType: existing.trainingType,
          // Hard-delete: explicit `softDelete: false` so audit consumers
          // can distinguish from soft-delete cases (e.g., assignment.end).
          softDelete: false,
        },
      },
      context.jwtToken,
    );
  }

  // ============================================
  // Mapper (entity → response DTO)
  // ============================================

  private toResponse(training: StaffTraining): StaffTrainingResponseDto {
    return {
      trainingId: training.trainingId,
      staffId: training.staffId,
      tenantId: training.tenantId,
      trainingTitle: training.trainingTitle,
      trainingType: training.trainingType,
      trainingProvider: training.trainingProvider,
      startDate: training.startDate,
      endDate: training.endDate,
      durationHours: training.durationHours,
      status: training.status,
      certificateNumber: training.certificateNumber,
      certificateUrl: training.certificateUrl,
      notes: training.notes,
      createdAt: training.createdAt!,
      updatedAt: training.updatedAt!,
    };
  }
}
