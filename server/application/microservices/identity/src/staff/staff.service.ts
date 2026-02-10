/**
 * Staff Service - Identity Service
 * 
 * Manages staff members with Ed-Fi aligned data model.
 * Supports CRUD operations, school assignments, and search.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { StaffEmploymentHistoryService } from './staff-employment-history.service';
import {
  Staff,
  StaffRole,
  StaffSchoolAssignment,
  createStaffEntity,
  StaffKeyBuilder,
} from '../common/entities/staff.entity';
import {
  RequestContext,
  PaginatedResult,
} from '../common/entities/base.entity';
import type {
  CreateStaffDto,
  UpdateStaffDto,
  StaffResponseDto,
  StaffFilterDto,
  AssignStaffToSchoolDto,
  UpdateEmploymentStatusDto,
} from '@aibrains/shared-types';

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: IdentityEventsService,
    private readonly employmentHistoryService: StaffEmploymentHistoryService,
  ) {}

  // ============================================
  // Create Staff
  // ============================================

  async createStaff(
    createDto: CreateStaffDto,
    context: RequestContext
  ): Promise<StaffResponseDto> {
    const now = new Date().toISOString();
    const staffId = uuid();

    // Check for duplicate email
    await this.checkEmailNotExists(createDto.email, context);

    // Check for duplicate staffUniqueId within tenant
    await this.checkStaffUniqueIdNotExists(createDto.staffUniqueId, context);

    // Build initial school assignment
    const primaryAssignment: StaffSchoolAssignment = {
      schoolId: createDto.primarySchoolId,
      role: createDto.role as StaffRole,
      department: createDto.department,
      isPrimary: true,
      beginDate: createDto.hireDate,
      positionTitle: createDto.title,
    };

    const staff = createStaffEntity(
      context.tenantId,
      staffId,
      {
        userId: createDto.userId,
        staffUniqueId: createDto.staffUniqueId,
        firstName: createDto.firstName,
        lastSurname: createDto.lastSurname,
        middleName: createDto.middleName,
        generationCodeSuffix: createDto.generationCodeSuffix,
        maidenName: createDto.maidenName,
        birthDate: createDto.birthDate,
        gender: createDto.gender as any,
        hispanicLatinoEthnicity: createDto.hispanicLatinoEthnicity,
        highlyQualifiedTeacher: createDto.highlyQualifiedTeacher,
        yearsOfPriorTeachingExperience: createDto.yearsOfPriorTeachingExperience,
        yearsOfPriorProfessionalExperience: createDto.yearsOfPriorProfessionalExperience,
        email: createDto.email,
        phone: createDto.phone,
        addresses: createDto.addresses as any,
        telephones: createDto.telephones as any,
        primarySchoolId: createDto.primarySchoolId,
        schoolAssignments: [primaryAssignment],
        role: createDto.role as StaffRole,
        employmentType: createDto.employmentType as any,
        employmentStatus: 'active',
        hireDate: createDto.hireDate,
        department: createDto.department,
        title: createDto.title,
        emergencyContacts: createDto.emergencyContacts as any,
        status: 'active',
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    await this.dynamoDBClient.putItem(client, staff);

    this.logger.log(`Staff created: ${staff.firstName} ${staff.lastSurname} (${staffId})`);

    // Publish staff created event (non-blocking)
    this.eventsService.publishEvent({
      eventType: 'StaffCreated',
      timestamp: new Date().toISOString(),
      tenantId: context.tenantId,
      staffId,
      staffUniqueId: createDto.staffUniqueId,
      name: `${staff.firstName} ${staff.lastSurname}`,
      email: staff.email,
      role: staff.role,
      schoolId: staff.primarySchoolId,
    }).catch(err => this.logger.error('Failed to publish StaffCreated event', err));

    return this.toStaffResponse(staff);
  }

  // ============================================
  // Get Staff by ID
  // ============================================

  async getStaff(
    staffId: string,
    context: RequestContext
  ): Promise<StaffResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const staff = await this.dynamoDBClient.getItem<Staff>(
      client,
      context.tenantId,
      StaffKeyBuilder.staff(staffId)
    );

    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }

    return this.toStaffResponse(staff);
  }

  // ============================================
  // List Staff by School
  // ============================================

  async listStaffBySchool(
    schoolId: string,
    context: RequestContext,
    filter?: StaffFilterDto
  ): Promise<PaginatedResult<StaffResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const limit = filter?.limit || 20;

    // Query GSI1 for school's staff (tenant-scoped)
    const result = await this.dynamoDBClient.queryGSI<Staff>(
      client,
      'GSI1',
      StaffKeyBuilder.schoolLookup(context.tenantId, schoolId),
      'STAFF#',
      'begins_with',
      'entityType = :entityType',
      { ':entityType': 'STAFF' },
      undefined,
      limit
    );

    // Apply filters in memory (for MVP)
    let filtered = result.items;
    
    if (filter?.role) {
      filtered = filtered.filter(s => s.role === filter.role);
    }
    
    if (filter?.employmentStatus) {
      filtered = filtered.filter(s => s.employmentStatus === filter.employmentStatus);
    }

    return {
      items: filtered.map(s => this.toStaffResponse(s)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  // ============================================
  // List All Staff (Tenant-wide)
  // ============================================

  async listStaff(
    context: RequestContext,
    filter?: StaffFilterDto
  ): Promise<PaginatedResult<StaffResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const limit = filter?.limit || 20;

    const result = await this.dynamoDBClient.query<Staff>(
      client,
      context.tenantId,
      'STAFF#',
      'entityType = :entityType',
      { ':entityType': 'STAFF' },
      undefined,
      limit
    );

    // Apply filters in memory (for MVP)
    let filtered = result.items;

    if (filter?.schoolId) {
      filtered = filtered.filter(s => s.primarySchoolId === filter.schoolId);
    }

    if (filter?.role) {
      filtered = filtered.filter(s => s.role === filter.role);
    }

    if (filter?.employmentStatus) {
      filtered = filtered.filter(s => s.employmentStatus === filter.employmentStatus);
    }

    return {
      items: filtered.map(s => this.toStaffResponse(s)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  // ============================================
  // Update Staff
  // ============================================

  async updateStaff(
    staffId: string,
    updateDto: UpdateStaffDto,
    context: RequestContext
  ): Promise<StaffResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const staff = await this.dynamoDBClient.getItem<Staff>(
      client,
      context.tenantId,
      StaffKeyBuilder.staff(staffId)
    );

    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }

    // Build update expression
    const updates: string[] = [];
    const values: Record<string, any> = {};
    const names: Record<string, string> = {};

    const simpleFields = [
      'firstName', 'lastSurname', 'middleName', 'generationCodeSuffix',
      'maidenName', 'birthDate', 'gender', 'phone', 'department', 'title',
      'hispanicLatinoEthnicity', 'highlyQualifiedTeacher',
      'yearsOfPriorTeachingExperience', 'yearsOfPriorProfessionalExperience',
    ];

    for (const field of simpleFields) {
      const value = (updateDto as any)[field];
      if (value !== undefined) {
        updates.push(`${field} = :${field}`);
        values[`:${field}`] = value;
      }
    }

    if (updateDto.addresses) {
      updates.push('addresses = :addresses');
      values[':addresses'] = updateDto.addresses;
    }

    if (updateDto.telephones) {
      updates.push('telephones = :telephones');
      values[':telephones'] = updateDto.telephones;
    }

    if (updateDto.emergencyContacts) {
      updates.push('emergencyContacts = :emergencyContacts');
      values[':emergencyContacts'] = updateDto.emergencyContacts;
    }

    if (updateDto.status) {
      updates.push('#status = :status');
      values[':status'] = updateDto.status;
      names['#status'] = 'status';
    }

    if (updateDto.employmentStatus) {
      updates.push('employmentStatus = :employmentStatus');
      values[':employmentStatus'] = updateDto.employmentStatus;
    }

    if (updateDto.terminationDate) {
      updates.push('terminationDate = :terminationDate');
      values[':terminationDate'] = updateDto.terminationDate;
    }

    if (updateDto.terminationReason) {
      updates.push('terminationReason = :terminationReason');
      values[':terminationReason'] = updateDto.terminationReason;
    }

    if (updates.length === 0) {
      return this.toStaffResponse(staff);
    }

    updates.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy', '#version = #version + :inc');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;
    values[':inc'] = 1;
    names['#version'] = 'version';

    const updatedStaff = await this.dynamoDBClient.updateItem<Staff>(
      client,
      context.tenantId,
      StaffKeyBuilder.staff(staffId),
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      Object.keys(names).length > 0 ? names : undefined
    );

    this.logger.log(`Staff updated: ${staffId}`);

    return this.toStaffResponse(updatedStaff);
  }

  // ============================================
  // Update Employment Status
  // ============================================

  async updateEmploymentStatus(
    staffId: string,
    statusDto: UpdateEmploymentStatusDto,
    context: RequestContext
  ): Promise<StaffResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const staff = await this.dynamoDBClient.getItem<Staff>(
      client,
      context.tenantId,
      StaffKeyBuilder.staff(staffId)
    );

    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }

    const updates: string[] = [
      'employmentStatus = :employmentStatus',
      'updatedAt = :updatedAt',
      'updatedBy = :updatedBy',
      '#version = #version + :inc',
    ];

    const values: Record<string, any> = {
      ':employmentStatus': statusDto.employmentStatus,
      ':updatedAt': new Date().toISOString(),
      ':updatedBy': context.userId,
      ':inc': 1,
    };

    const names: Record<string, string> = {
      '#version': 'version',
    };

    // If terminated, set termination date
    if (['terminated', 'retired', 'resigned'].includes(statusDto.employmentStatus)) {
      updates.push('terminationDate = :terminationDate');
      values[':terminationDate'] = statusDto.effectiveDate;
      
      if (statusDto.reason) {
        updates.push('terminationReason = :terminationReason');
        values[':terminationReason'] = statusDto.reason;
      }

      // Also set status to inactive
      updates.push('#status = :status');
      values[':status'] = 'inactive';
      names['#status'] = 'status';
    }

    const updatedStaff = await this.dynamoDBClient.updateItem<Staff>(
      client,
      context.tenantId,
      StaffKeyBuilder.staff(staffId),
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      names
    );

    this.logger.log(`Staff employment status updated: ${staffId} -> ${statusDto.employmentStatus}`);

    // Record employment history (non-blocking)
    this.employmentHistoryService.recordStatusChange(
      staffId,
      staff.employmentStatus,
      statusDto.employmentStatus,
      statusDto.effectiveDate,
      context,
      statusDto.reason,
      statusDto.notes,
      `${staff.firstName} ${staff.lastSurname}`,
    ).catch(err => this.logger.error('Failed to record employment history', err));

    // Publish event (non-blocking)
    this.eventsService.publishEvent({
      eventType: 'StaffStatusChanged',
      timestamp: new Date().toISOString(),
      tenantId: context.tenantId,
      staffId,
      previousStatus: staff.employmentStatus,
      newStatus: statusDto.employmentStatus,
      effectiveDate: statusDto.effectiveDate,
    }).catch(err => this.logger.error('Failed to publish StaffStatusChanged event', err));

    return this.toStaffResponse(updatedStaff);
  }

  // ============================================
  // Assign Staff to School
  // ============================================

  async assignToSchool(
    staffId: string,
    assignmentDto: AssignStaffToSchoolDto,
    context: RequestContext
  ): Promise<StaffResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const staff = await this.dynamoDBClient.getItem<Staff>(
      client,
      context.tenantId,
      StaffKeyBuilder.staff(staffId)
    );

    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }

    // Check if already assigned to this school
    const existingAssignment = staff.schoolAssignments.find(
      a => a.schoolId === assignmentDto.schoolId && !a.endDate
    );

    if (existingAssignment) {
      throw new ConflictException('Staff is already assigned to this school');
    }

    // Create new assignment
    const newAssignment: StaffSchoolAssignment = {
      schoolId: assignmentDto.schoolId,
      role: assignmentDto.role as StaffRole,
      department: assignmentDto.department,
      isPrimary: assignmentDto.isPrimary,
      beginDate: assignmentDto.beginDate,
      endDate: assignmentDto.endDate,
      positionTitle: assignmentDto.positionTitle,
      fullTimeEquivalency: assignmentDto.fullTimeEquivalency,
    };

    // If this is primary, unset other primary assignments
    let updatedAssignments = [...staff.schoolAssignments];
    if (assignmentDto.isPrimary) {
      updatedAssignments = updatedAssignments.map(a => ({
        ...a,
        isPrimary: false,
      }));
    }
    updatedAssignments.push(newAssignment);

    const updates: string[] = [
      'schoolAssignments = :schoolAssignments',
      'updatedAt = :updatedAt',
      'updatedBy = :updatedBy',
      '#version = #version + :inc',
    ];

    const values: Record<string, any> = {
      ':schoolAssignments': updatedAssignments,
      ':updatedAt': new Date().toISOString(),
      ':updatedBy': context.userId,
      ':inc': 1,
    };

    const names: Record<string, string> = { '#version': 'version' };

    // Update primary school if this is the new primary
    if (assignmentDto.isPrimary) {
      updates.push('primarySchoolId = :primarySchoolId');
      updates.push('gsi1pk = :gsi1pk');
      values[':primarySchoolId'] = assignmentDto.schoolId;
      values[':gsi1pk'] = StaffKeyBuilder.schoolLookup(context.tenantId, assignmentDto.schoolId);
    }

    const updatedStaff = await this.dynamoDBClient.updateItem<Staff>(
      client,
      context.tenantId,
      StaffKeyBuilder.staff(staffId),
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      names
    );

    this.logger.log(`Staff assigned to school: ${staffId} -> ${assignmentDto.schoolId}`);

    return this.toStaffResponse(updatedStaff);
  }

  // ============================================
  // Delete Staff (Soft Delete)
  // ============================================

  async deleteStaff(
    staffId: string,
    context: RequestContext
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const staff = await this.dynamoDBClient.getItem<Staff>(
      client,
      context.tenantId,
      StaffKeyBuilder.staff(staffId)
    );

    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }

    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      StaffKeyBuilder.staff(staffId),
      'SET #status = :status, employmentStatus = :employmentStatus, updatedAt = :updatedAt',
      {
        ':status': 'inactive',
        ':employmentStatus': 'terminated',
        ':updatedAt': new Date().toISOString(),
      },
      undefined,
      { '#status': 'status' }
    );

    this.logger.log(`Staff deleted (soft): ${staffId}`);
  }

  // ============================================
  // Search Staff
  // ============================================

  async searchStaff(
    searchTerm: string,
    context: RequestContext,
    limit: number = 20
  ): Promise<PaginatedResult<StaffResponseDto>> {
    // For DynamoDB, we do a query with filter
    // In production, consider using OpenSearch/Elasticsearch
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const searchLower = searchTerm.toLowerCase();

    const result = await this.dynamoDBClient.query<Staff>(
      client,
      context.tenantId,
      'STAFF#',
      'entityType = :entityType',
      { ':entityType': 'STAFF' },
      undefined,
      100  // Get more to filter
    );

    // Filter in memory (not ideal for large datasets)
    const filtered = result.items.filter(s =>
      s.firstName.toLowerCase().includes(searchLower) ||
      s.lastSurname.toLowerCase().includes(searchLower) ||
      s.email.toLowerCase().includes(searchLower) ||
      s.staffUniqueId.toLowerCase().includes(searchLower)
    );

    const items = filtered.slice(0, limit).map(s => this.toStaffResponse(s));

    return {
      items,
      hasMore: filtered.length > limit,
    };
  }

  // ============================================
  // Get Staff by Email
  // ============================================

  async getStaffByEmail(
    email: string,
    context: RequestContext
  ): Promise<StaffResponseDto | null> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    
    const result = await this.dynamoDBClient.queryGSI<Staff>(
      client,
      'GSI2',
      StaffKeyBuilder.emailLookup(email),
      'STAFF#',
      'begins_with',
      'entityType = :entityType',
      { ':entityType': 'STAFF' },
      undefined,
      1
    );

    if (result.items.length === 0) {
      return null;
    }

    return this.toStaffResponse(result.items[0]);
  }

  // ============================================
  // Helper Methods
  // ============================================

  private async checkEmailNotExists(email: string, context: RequestContext): Promise<void> {
    const existing = await this.getStaffByEmail(email, context);
    if (existing) {
      throw new ConflictException('A staff member with this email already exists');
    }
  }

  private async checkStaffUniqueIdNotExists(staffUniqueId: string, context: RequestContext): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    
    // For MVP, do a simple query with filter
    const result = await this.dynamoDBClient.query<Staff>(
      client,
      context.tenantId,
      'STAFF#',
      'entityType = :entityType AND staffUniqueId = :staffUniqueId',
      { 
        ':entityType': 'STAFF',
        ':staffUniqueId': staffUniqueId,
      },
      undefined,
      1
    );

    if (result.items.length > 0) {
      throw new ConflictException('A staff member with this unique ID already exists');
    }
  }

  private toStaffResponse(staff: Staff): StaffResponseDto {
    const primaryAssignment = staff.schoolAssignments?.find(a => a.isPrimary);
    
    return {
      staffId: staff.staffId,
      staffUniqueId: staff.staffUniqueId,
      tenantId: staff.tenantId,
      userId: staff.userId,
      firstName: staff.firstName,
      lastSurname: staff.lastSurname,
      middleName: staff.middleName,
      generationCodeSuffix: staff.generationCodeSuffix,
      birthDate: staff.birthDate,
      gender: staff.gender,
      email: staff.email,
      phone: staff.phone,
      addresses: staff.addresses,
      primarySchoolId: staff.primarySchoolId,
      primarySchoolName: primaryAssignment?.schoolName,
      schoolAssignments: staff.schoolAssignments,
      role: staff.role,
      employmentType: staff.employmentType,
      employmentStatus: staff.employmentStatus,
      hireDate: staff.hireDate,
      terminationDate: staff.terminationDate,
      department: staff.department,
      title: staff.title,
      highlyQualifiedTeacher: staff.highlyQualifiedTeacher,
      yearsOfPriorTeachingExperience: staff.yearsOfPriorTeachingExperience,
      status: staff.status,
      hispanicLatinoEthnicity: staff.hispanicLatinoEthnicity,
      createdAt: staff.createdAt,
      updatedAt: staff.updatedAt,
    };
  }
}
