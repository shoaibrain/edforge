/**
 * Staff Assignment Service - Identity Service
 *
 * Manages first-class staff-to-school assignment entities.
 * Aligns with Ed-Fi StaffEducationOrganizationAssignmentAssociation.
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
import { IdentityEventsService } from '../common/services/identity-events.service';
import {
  StaffAssignment,
  StaffAssignmentKeyBuilder,
  createStaffAssignmentEntity,
} from '../common/entities/staff-assignment.entity';
import {
  Staff,
  StaffKeyBuilder,
} from '../common/entities/staff.entity';
import {
  EntityKeyBuilder,
  RequestContext,
  PaginatedResult,
} from '../common/entities/base.entity';
import type {
  CreateStaffAssignmentDto,
  UpdateStaffAssignmentDto,
  StaffAssignmentResponseDto,
} from '@aibrains/shared-types';

@Injectable()
export class StaffAssignmentService {
  private readonly logger = new Logger(StaffAssignmentService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: IdentityEventsService,
  ) {}

  // ============================================
  // Create Assignment
  // ============================================

  async createAssignment(
    staffId: string,
    createDto: CreateStaffAssignmentDto,
    context: RequestContext
  ): Promise<StaffAssignmentResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Verify staff exists
    const staff = await this.dynamoDBClient.getItem<Staff>(
      client,
      context.tenantId,
      StaffKeyBuilder.staff(staffId)
    );
    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }

    // Check for duplicate active assignment at same school
    const existing = await this.listAssignmentsForStaff(staffId, context);
    const duplicate = existing.items.find(
      a => a.schoolId === createDto.schoolId && a.assignmentStatus === 'active'
    );
    if (duplicate) {
      throw new ConflictException('Staff already has an active assignment at this school');
    }

    const now = new Date().toISOString();
    const assignmentId = uuid();

    const assignment = createStaffAssignmentEntity(
      context.tenantId,
      assignmentId,
      {
        staffId,
        schoolId: createDto.schoolId,
        role: createDto.role,
        department: createDto.department,
        isPrimary: createDto.isPrimary ?? false,
        beginDate: createDto.beginDate,
        endDate: createDto.endDate,
        positionTitle: createDto.positionTitle,
        fullTimeEquivalency: createDto.fullTimeEquivalency,
        staffClassificationDescriptor: createDto.staffClassificationDescriptor,
        orderOfAssignment: createDto.orderOfAssignment,
        assignmentStatus: 'active',
        staffName: `${staff.firstName} ${staff.lastSurname}`,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );

    await this.dynamoDBClient.putItem(client, assignment);

    // If this is primary, update the Staff entity's primarySchoolId
    if (createDto.isPrimary) {
      await this.dynamoDBClient.updateItem(
        client,
        context.tenantId,
        StaffKeyBuilder.staff(staffId),
        'SET primarySchoolId = :schoolId, gsi1pk = :gsi1pk, updatedAt = :updatedAt',
        {
          ':schoolId': createDto.schoolId,
          ':gsi1pk': StaffKeyBuilder.schoolLookup(context.tenantId, createDto.schoolId),
          ':updatedAt': now,
        }
      );
    }

    this.logger.log(`Staff assignment created: ${staffId} -> ${createDto.schoolId} (${assignmentId})`);

    // Publish event (non-blocking)
    this.eventsService.publishEvent({
      eventType: 'StaffAssigned',
      timestamp: now,
      tenantId: context.tenantId,
      staffId,
      schoolId: createDto.schoolId,
      assignmentId,
      role: createDto.role,
    }).catch(err => this.logger.error('Failed to publish StaffAssigned event', err));

    return this.toResponse(assignment);
  }

  // ============================================
  // Get Assignment by ID
  // ============================================

  async getAssignment(
    staffId: string,
    assignmentId: string,
    context: RequestContext
  ): Promise<StaffAssignmentResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const assignment = await this.dynamoDBClient.getItem<StaffAssignment>(
      client,
      context.tenantId,
      EntityKeyBuilder.staffAssignment(staffId, assignmentId)
    );

    if (!assignment) {
      throw new NotFoundException('Staff assignment not found');
    }

    return this.toResponse(assignment);
  }

  // ============================================
  // List Assignments for Staff
  // ============================================

  async listAssignmentsForStaff(
    staffId: string,
    context: RequestContext
  ): Promise<PaginatedResult<StaffAssignmentResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const result = await this.dynamoDBClient.query<StaffAssignment>(
      client,
      context.tenantId,
      `STAFF#${staffId}#ASSIGN#`,
      'entityType = :entityType',
      { ':entityType': 'STAFF_ASSIGNMENT' },
      undefined,
      100
    );

    return {
      items: result.items.map(a => this.toResponse(a)),
      hasMore: result.hasMore,
    };
  }

  // ============================================
  // List Assignments by School
  // ============================================

  async listAssignmentsBySchool(
    schoolId: string,
    context: RequestContext
  ): Promise<PaginatedResult<StaffAssignmentResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const result = await this.dynamoDBClient.queryGSI<StaffAssignment>(
      client,
      'GSI1',
      StaffAssignmentKeyBuilder.schoolLookup(context.tenantId, schoolId),
      'ASSIGN#',
      'begins_with',
      'entityType = :entityType',
      { ':entityType': 'STAFF_ASSIGNMENT' },
      undefined,
      100
    );

    return {
      items: result.items.map(a => this.toResponse(a)),
      hasMore: result.hasMore,
    };
  }

  // ============================================
  // Update Assignment
  // ============================================

  async updateAssignment(
    staffId: string,
    assignmentId: string,
    updateDto: UpdateStaffAssignmentDto,
    context: RequestContext
  ): Promise<StaffAssignmentResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const sk = EntityKeyBuilder.staffAssignment(staffId, assignmentId);

    const existing = await this.dynamoDBClient.getItem<StaffAssignment>(
      client,
      context.tenantId,
      sk
    );

    if (!existing) {
      throw new NotFoundException('Staff assignment not found');
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};

    const fields = [
      'role', 'department', 'isPrimary', 'endDate', 'positionTitle',
      'fullTimeEquivalency', 'staffClassificationDescriptor', 'orderOfAssignment',
      'assignmentStatus',
    ];

    for (const field of fields) {
      const value = (updateDto as any)[field];
      if (value !== undefined) {
        updates.push(`${field} = :${field}`);
        values[`:${field}`] = value;
      }
    }

    if (updates.length === 0) {
      return this.toResponse(existing);
    }

    updates.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy', '#version = #version + :inc');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;
    values[':inc'] = 1;

    const updated = await this.dynamoDBClient.updateItem<StaffAssignment>(
      client,
      context.tenantId,
      sk,
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      { '#version': 'version' }
    );

    // If making this primary, update the Staff entity
    if (updateDto.isPrimary === true) {
      await this.dynamoDBClient.updateItem(
        client,
        context.tenantId,
        StaffKeyBuilder.staff(staffId),
        'SET primarySchoolId = :schoolId, gsi1pk = :gsi1pk, updatedAt = :updatedAt',
        {
          ':schoolId': existing.schoolId,
          ':gsi1pk': StaffKeyBuilder.schoolLookup(context.tenantId, existing.schoolId),
          ':updatedAt': new Date().toISOString(),
        }
      );
    }

    this.logger.log(`Staff assignment updated: ${assignmentId}`);

    return this.toResponse(updated);
  }

  // ============================================
  // End Assignment (Soft Delete)
  // ============================================

  async endAssignment(
    staffId: string,
    assignmentId: string,
    endDate: string,
    context: RequestContext
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const sk = EntityKeyBuilder.staffAssignment(staffId, assignmentId);

    const existing = await this.dynamoDBClient.getItem<StaffAssignment>(
      client,
      context.tenantId,
      sk
    );

    if (!existing) {
      throw new NotFoundException('Staff assignment not found');
    }

    if (existing.assignmentStatus === 'ended') {
      throw new BadRequestException('Assignment is already ended');
    }

    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      sk,
      'SET assignmentStatus = :status, endDate = :endDate, updatedAt = :updatedAt, updatedBy = :updatedBy',
      {
        ':status': 'ended',
        ':endDate': endDate,
        ':updatedAt': new Date().toISOString(),
        ':updatedBy': context.userId,
      }
    );

    this.logger.log(`Staff assignment ended: ${assignmentId}`);

    // Publish event (non-blocking)
    this.eventsService.publishEvent({
      eventType: 'StaffAssignmentEnded',
      timestamp: new Date().toISOString(),
      tenantId: context.tenantId,
      staffId,
      schoolId: existing.schoolId,
      assignmentId,
      endDate,
    }).catch(err => this.logger.error('Failed to publish StaffAssignmentEnded event', err));
  }

  // ============================================
  // Response Mapper
  // ============================================

  private toResponse(assignment: StaffAssignment): StaffAssignmentResponseDto {
    return {
      assignmentId: assignment.id,
      staffId: assignment.staffId,
      schoolId: assignment.schoolId,
      role: assignment.role as any,
      department: assignment.department,
      isPrimary: assignment.isPrimary,
      beginDate: assignment.beginDate,
      endDate: assignment.endDate,
      positionTitle: assignment.positionTitle,
      fullTimeEquivalency: assignment.fullTimeEquivalency,
      staffClassificationDescriptor: assignment.staffClassificationDescriptor,
      orderOfAssignment: assignment.orderOfAssignment,
      assignmentStatus: assignment.assignmentStatus as any,
      staffName: assignment.staffName,
      schoolName: assignment.schoolName,
      createdAt: assignment.createdAt,
      updatedAt: assignment.updatedAt,
    };
  }
}
