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
import { IemisAuditLogger } from '../common/services/iemis-audit-logger.service';
import {
  StaffAssignment,
  StaffAssignmentKeyBuilder,
  createStaffAssignmentEntity,
} from '../common/entities/staff-assignment.entity';
import {
  Staff,
  StaffRole,
  StaffKeyBuilder,
} from '../common/entities/staff.entity';
import { School } from '../common/entities/school.entity';
import { Department } from '../common/entities/department.entity';
import { RoleSyncService } from '../roles/role-sync.service';
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
    private readonly roleSyncService: RoleSyncService,
    private readonly iemisAuditLogger: IemisAuditLogger,
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

    // Fetch school for denormalized schoolName
    const school = await this.dynamoDBClient.getItem<School>(
      client,
      context.tenantId,
      EntityKeyBuilder.school(createDto.schoolId)
    );

    // Resolve department if provided
    let deptName: string | undefined;
    if (createDto.departmentId) {
      deptName = await this.resolveDepartment(client, context.tenantId, createDto.schoolId, createDto.departmentId);
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
        departmentId: createDto.departmentId,
        departmentName: deptName,
        isPrimary: createDto.isPrimary ?? false,
        beginDate: createDto.beginDate,
        endDate: createDto.endDate,
        positionTitle: createDto.positionTitle,
        fullTimeEquivalency: createDto.fullTimeEquivalency,
        staffClassificationDescriptor: createDto.staffClassificationDescriptor,
        orderOfAssignment: createDto.orderOfAssignment,
        assignmentStatus: 'active',
        staffName: `${staff.firstName} ${staff.lastSurname}`,
        schoolName: school?.name,
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

    // Sync ABAC role assignment if staff has a linked user
    if (staff.userId) {
      await this.roleSyncService.syncRoleAssignment(
        staff.userId,
        createDto.schoolId,
        createDto.role as StaffRole,
        context,
      ).catch(err => this.logger.error('Failed to sync role assignment on assignment creation', err));
    }

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

    // Sprint 4 S4.7 — IEMIS audit emit (fail-open per logger contract).
    // Metadata holds Ed-Fi-aligned typed fields only — staffId, schoolId,
    // assignmentId, role, and the date range. No PII (staff names / emails
    // are looked up from staffId at audit-read time if needed).
    void this.iemisAuditLogger.emit(
      {
        eventType: 'staff.assignment.created',
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorName: context.email,
        schoolId: createDto.schoolId,
        metadata: {
          staffId,
          assignmentId,
          schoolId: createDto.schoolId,
          role: createDto.role,
          isPrimary: createDto.isPrimary ?? false,
          beginDate: createDto.beginDate,
          fullTimeEquivalency: createDto.fullTimeEquivalency,
        },
      },
      context.jwtToken,
    );

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

    const response = this.toResponse(assignment);

    // Enrich schoolName if missing from denormalized data
    if (!response.schoolName && assignment.schoolId) {
      const school = await this.dynamoDBClient.getItem<School>(
        client,
        context.tenantId,
        EntityKeyBuilder.school(assignment.schoolId)
      );
      if (school) {
        response.schoolName = school.name;
      }
    }

    return response;
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

    const items = result.items.map(a => this.toResponse(a));

    return {
      items: await this.enrichSchoolNames(client, context.tenantId, items),
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
      'role', 'isPrimary', 'endDate', 'positionTitle',
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

    // Resolve departmentId if provided
    if (updateDto.departmentId !== undefined) {
      const deptName = await this.resolveDepartment(
        client, context.tenantId, existing.schoolId, updateDto.departmentId,
      );
      updates.push('departmentId = :departmentId', 'departmentName = :departmentName');
      values[':departmentId'] = updateDto.departmentId;
      values[':departmentName'] = deptName;
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

    // Sync ABAC role assignment if role was changed
    if (updateDto.role) {
      const staffForSync = await this.dynamoDBClient.getItem<Staff>(
        client, context.tenantId, StaffKeyBuilder.staff(staffId)
      );
      if (staffForSync?.userId) {
        await this.roleSyncService.syncRoleAssignment(
          staffForSync.userId,
          existing.schoolId,
          updateDto.role as StaffRole,
          context,
        ).catch(err => this.logger.error('Failed to sync role assignment on update', err));
      }
    }

    // Sprint 4 S4.7 — IEMIS audit emit. `changedFields` lists which
    // whitelisted attributes the request actually updated.
    void this.iemisAuditLogger.emit(
      {
        eventType: 'staff.assignment.edited',
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorName: context.email,
        schoolId: existing.schoolId,
        metadata: {
          staffId,
          assignmentId,
          schoolId: existing.schoolId,
          changedFields: Object.keys(values)
            .map((k) => k.replace(/^:/, ''))
            .filter((f) => f !== 'updatedAt' && f !== 'updatedBy' && f !== 'inc'),
        },
      },
      context.jwtToken,
    );

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

    // Deactivate ABAC role assignment if staff has a linked user
    const staff = await this.dynamoDBClient.getItem<Staff>(
      client, context.tenantId, StaffKeyBuilder.staff(staffId)
    );
    if (staff?.userId) {
      await this.roleSyncService.deactivateRoleAssignment(
        staff.userId,
        existing.schoolId,
        'staff_assignment_ended',
        context,
      ).catch(err => this.logger.error('Failed to deactivate role assignment on assignment end', err));
    }

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

    // Sprint 4 S4.7 — IEMIS audit emit. Lifecycle "end" maps to the
    // `staff.assignment.deleted` event type. The DDB row stays (soft
    // delete via assignmentStatus='ended'); auditors see when the
    // teacher's tenure at the school concluded.
    void this.iemisAuditLogger.emit(
      {
        eventType: 'staff.assignment.deleted',
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorName: context.email,
        schoolId: existing.schoolId,
        metadata: {
          staffId,
          assignmentId,
          schoolId: existing.schoolId,
          role: existing.role,
          beginDate: existing.beginDate,
          endDate,
          softDelete: true,
        },
      },
      context.jwtToken,
    );
  }

  // ============================================
  // School Name Enrichment
  // ============================================

  /**
   * Fetches school names for assignments where the denormalized
   * schoolName is missing. Uses individual getItem calls (BatchGetItem
   * is not permitted by the current IAM ABAC policy). Only triggers
   * DynamoDB reads when needed — typically 1-3 schools per staff member.
   */
  private async enrichSchoolNames(
    client: any,
    tenantId: string,
    responses: StaffAssignmentResponseDto[],
  ): Promise<StaffAssignmentResponseDto[]> {
    const missingSchoolIds = new Set<string>();
    for (const r of responses) {
      if (!r.schoolName && r.schoolId) {
        missingSchoolIds.add(r.schoolId);
      }
    }

    if (missingSchoolIds.size === 0) return responses;

    const nameMap = new Map<string, string>();
    await Promise.all(
      [...missingSchoolIds].map(async (schoolId) => {
        const school = await this.dynamoDBClient.getItem<School>(
          client,
          tenantId,
          EntityKeyBuilder.school(schoolId),
        );
        if (school) {
          nameMap.set(school.schoolId, school.name);
        }
      }),
    );

    return responses.map(r => {
      if (!r.schoolName && r.schoolId) {
        r.schoolName = nameMap.get(r.schoolId);
      }
      return r;
    });
  }

  // ============================================
  // Response Mapper
  // ============================================

  /**
   * Resolve departmentId to department name. Validates the department
   * exists and is active for the given school.
   */
  private async resolveDepartment(
    client: any,
    tenantId: string,
    schoolId: string,
    departmentId: string,
  ): Promise<string> {
    const department = await this.dynamoDBClient.getItem<Department>(
      client,
      tenantId,
      `SCHOOL#${schoolId}#DEPT#${departmentId}`,
    );

    if (!department || !department.isActive) {
      throw new NotFoundException(
        `Department ${departmentId} not found or inactive for school ${schoolId}`,
      );
    }

    return department.name;
  }

  private toResponse(assignment: StaffAssignment): StaffAssignmentResponseDto {
    return {
      assignmentId: assignment.id,
      staffId: assignment.staffId,
      schoolId: assignment.schoolId,
      role: assignment.role as any,
      departmentId: assignment.departmentId,
      departmentName: assignment.departmentName,
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
