/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Staff Service - CRUD operations for Staff entities
 */

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/dynamodb-client.service';
import { Staff, StaffWithGSI } from '../common/entities/staff.entities';
import { RequestContext } from '../common/entities/base.entity';
import { EntityKeyBuilder } from '../common/entities/base.entity';
import { CreateStaffDto, UpdateStaffDto } from './dto/staff.dto';
import { StaffEventsService } from '../common/services/staff-events.service';
import { SchoolHttpClientService } from '../common/services/school-http-client.service';

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: StaffEventsService,
    private readonly schoolHttpClient: SchoolHttpClientService
  ) {}

  async createStaff(
    tenantId: string,
    createStaffDto: CreateStaffDto,
    context: RequestContext
  ): Promise<Staff> {
    const staffId = uuid();
    const timestamp = new Date().toISOString();
    const year = new Date().getFullYear();
    const employeeNumber = `EMP-${year}-${uuid().substring(0, 8).toUpperCase()}`;

    // Determine primary school from roles
    const primaryRole = createStaffDto.roles.find(r => r.isPrimary) || createStaffDto.roles[0];
    const primarySchoolId = primaryRole?.schoolId || 'UNASSIGNED';
    const primaryDepartmentId = primaryRole?.departmentId;

    // Validate department exists if provided
    if (primaryDepartmentId && primarySchoolId !== 'UNASSIGNED') {
      try {
        await this.schoolHttpClient.validateDepartment(tenantId, primarySchoolId, primaryDepartmentId);
      } catch (error: any) {
        this.logger.error(`Department validation failed: ${error.message}`);
        throw new BadRequestException(`Invalid department: ${error.message}`);
      }
    }

    const staff: Staff = {
      tenantId,
      entityKey: EntityKeyBuilder.staff(staffId),
      entityType: 'STAFF',
      
      staffId,
      employeeNumber,
      firstName: createStaffDto.firstName,
      lastName: createStaffDto.lastName,
      middleName: createStaffDto.middleName,
      dateOfBirth: createStaffDto.dateOfBirth,
      gender: createStaffDto.gender,
      
      contactInfo: createStaffDto.contactInfo,
      
      employment: {
        hireDate: createStaffDto.hireDate,
        employmentType: createStaffDto.employmentType,
        status: 'active'
      },
      
      roles: createStaffDto.roles,
      qualifications: createStaffDto.qualifications ? {
        education: createStaffDto.qualifications.education.map(edu => ({
          degree: edu.degree,
          institution: edu.institution,
          year: typeof edu.year === 'string' ? parseInt(edu.year, 10) : edu.year
        })),
        certifications: createStaffDto.qualifications.certifications || [],
        licenses: createStaffDto.qualifications.licenses || []
      } : {
        education: [],
        certifications: [],
        licenses: []
      },
      
      createdAt: timestamp,
      createdBy: context.userId,
      updatedAt: timestamp,
      updatedBy: context.userId,
      version: 1,
      
      gsi1pk: primarySchoolId,
      gsi1sk: `STAFF#${staffId}`,
      gsi8pk: staffId,
      gsi8sk: 'STAFF#current',
      gsi11pk: primaryDepartmentId,
      gsi11sk: `STAFF#${staffId}`
    };

    await this.dynamoDBClient.putItem(staff);
    this.logger.log(`Staff created: ${staff.firstName} ${staff.lastName} (${staffId})`);
    return staff;
  }

  async getStaff(tenantId: string, staffId: string): Promise<Staff> {
    const entityKey = EntityKeyBuilder.staff(staffId);
    const staff = await this.dynamoDBClient.getItem(tenantId, entityKey);

    if (!staff || staff.entityType !== 'STAFF') {
      throw new NotFoundException(`Staff not found: ${staffId}`);
    }

    return staff as Staff;
  }

  /**
   * Update Staff
   * Updates staff member details with optimistic locking
   */
  async updateStaff(
    tenantId: string,
    staffId: string,
    updateDto: UpdateStaffDto,
    context: RequestContext
  ): Promise<Staff> {
    const entityKey = EntityKeyBuilder.staff(staffId);
    
    // 1. Get existing staff
    const existingStaff = await this.getStaff(tenantId, staffId);
    
    // 2. Validate department exists if roles are being updated
    if (updateDto.roles !== undefined) {
      const existingStaffWithGSI = existingStaff as StaffWithGSI;
      const primaryRole = updateDto.roles.find(r => r.isPrimary) || updateDto.roles[0];
      const primarySchoolId = primaryRole?.schoolId || existingStaffWithGSI.gsi1pk;
      const primaryDepartmentId = primaryRole?.departmentId;
      
      if (primaryDepartmentId && primarySchoolId !== 'UNASSIGNED') {
        try {
          await this.schoolHttpClient.validateDepartment(tenantId, primarySchoolId, primaryDepartmentId);
        } catch (error: any) {
          this.logger.error(`Department validation failed: ${error.message}`);
          throw new BadRequestException(`Invalid department: ${error.message}`);
        }
      }
    }
    
    // 3. Build update expression
    const timestamp = new Date().toISOString();
    const updateExpressions: string[] = [];
    const expressionAttributeValues: any = {
      ':updatedAt': timestamp,
      ':updatedBy': context.userId,
      ':inc': 1,
      ':currentVersion': existingStaff.version
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

    if (updateDto.roles !== undefined) {
      updateExpressions.push('roles = :roles');
      expressionAttributeValues[':roles'] = updateDto.roles;
      
      // Update GSI keys if roles changed
      const existingStaffWithGSI = existingStaff as StaffWithGSI;
      const primaryRole = updateDto.roles.find(r => r.isPrimary) || updateDto.roles[0];
      const primarySchoolId = primaryRole?.schoolId || existingStaffWithGSI.gsi1pk;
      const primaryDepartmentId = primaryRole?.departmentId;
      
      updateExpressions.push('gsi1pk = :gsi1pk');
      expressionAttributeValues[':gsi1pk'] = primarySchoolId;
      
      if (primaryDepartmentId) {
        updateExpressions.push('gsi11pk = :gsi11pk');
        expressionAttributeValues[':gsi11pk'] = primaryDepartmentId;
      }
    }

    if (updateDto.qualifications !== undefined) {
      updateExpressions.push('qualifications = :qualifications');
      expressionAttributeValues[':qualifications'] = updateDto.qualifications;
    }

    // Always update metadata
    updateExpressions.push('updatedAt = :updatedAt');
    updateExpressions.push('updatedBy = :updatedBy');
    updateExpressions.push('#version = #version + :inc');

    const updateExpression = `SET ${updateExpressions.join(', ')}`;
    const conditionExpression = '#version = :currentVersion';

    // 4. Update staff with optimistic locking
    try {
      const updatedStaff = await this.dynamoDBClient.updateItem(
        tenantId,
        entityKey,
        updateExpression,
        expressionAttributeValues,
        conditionExpression,
        expressionAttributeNames
      ) as Staff;

      // 5. Publish StaffUpdated event
      const updatedFields = Object.keys(updateDto).filter(key => updateDto[key as keyof UpdateStaffDto] !== undefined);
      try {
        await this.eventsService.publishStaffUpdated({
          tenantId,
          staffId: updatedStaff.staffId,
          schoolId: (updatedStaff as StaffWithGSI).gsi1pk,
          departmentId: (updatedStaff as StaffWithGSI).gsi11pk,
          firstName: updatedStaff.firstName,
          lastName: updatedStaff.lastName,
          updatedFields
        });
      } catch (eventError: unknown) {
        // Log but don't fail the update if event publishing fails
        const errorMessage = eventError instanceof Error ? eventError.message : 'Unknown error';
        this.logger.warn(`Failed to publish StaffUpdated event: ${errorMessage}`);
      }

      this.logger.log(`Staff updated: ${updatedStaff.firstName} ${updatedStaff.lastName} (${staffId})`);
      return updatedStaff;
    } catch (error: any) {
      if (error.message?.includes('condition not met') || error.message?.includes('ConditionalCheckFailedException')) {
        throw new BadRequestException('Staff was modified by another operation. Please retry.');
      }
      throw error;
    }
  }

  /**
   * Delete Staff (Soft Delete)
   * Sets status to 'inactive' instead of hard delete
   */
  async deleteStaff(
    tenantId: string,
    staffId: string,
    context: RequestContext
  ): Promise<{ message: string; staffId: string }> {
    const entityKey = EntityKeyBuilder.staff(staffId);
    
    // 1. Get existing staff
    const existingStaff = await this.getStaff(tenantId, staffId);
    
    // 2. Validate no active roles
    const activeRoles = existingStaff.roles?.filter(role => {
      const now = new Date().toISOString();
      return !role.endDate || role.endDate > now;
    }) || [];
    
    if (activeRoles.length > 0) {
      throw new BadRequestException(`Cannot delete staff with active roles. Please end all roles first.`);
    }
    
    // 3. Soft delete: Update status to 'inactive'
    const timestamp = new Date().toISOString();
    const updateExpression = 'SET employment.status = :status, updatedAt = :updatedAt, updatedBy = :updatedBy, #version = #version + :inc';
    const expressionAttributeValues = {
      ':status': 'inactive',
      ':updatedAt': timestamp,
      ':updatedBy': context.userId,
      ':inc': 1,
      ':currentVersion': existingStaff.version
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

      // 4. Publish StaffDeleted event (optional for MVP)
      try {
        await this.eventsService.publishStaffTerminated({
          tenantId,
          staffId: existingStaff.staffId,
          schoolId: (existingStaff as StaffWithGSI).gsi1pk,
          terminationDate: timestamp,
          reason: 'Soft deleted via API'
        });
      } catch (eventError: unknown) {
        // Log but don't fail the delete if event publishing fails
        const errorMessage = eventError instanceof Error ? eventError.message : 'Unknown error';
        this.logger.warn(`Failed to publish StaffDeleted event: ${errorMessage}`);
      }

      this.logger.log(`Staff deleted (soft): ${existingStaff.firstName} ${existingStaff.lastName} (${staffId})`);
      return {
        message: 'Staff deleted successfully',
        staffId
      };
    } catch (error: any) {
      if (error.message?.includes('condition not met') || error.message?.includes('ConditionalCheckFailedException')) {
        throw new BadRequestException('Staff was modified by another operation. Please retry.');
      }
      throw error;
    }
  }

  async listStaffBySchool(tenantId: string, schoolId: string): Promise<Staff[]> {
    const items = await this.dynamoDBClient.queryGSI(
      'GSI1',
      schoolId,
      'STAFF#',
      'begins_with',
      undefined,
      undefined,
      undefined,
      100
    );

    return items.filter(item => item.tenantId === tenantId && item.entityType === 'STAFF') as Staff[];
  }

  async listStaffByDepartment(tenantId: string, departmentId: string): Promise<Staff[]> {
    const items = await this.dynamoDBClient.queryGSI(
      'GSI11',
      departmentId,
      'STAFF#',
      'begins_with',
      undefined,
      undefined,
      undefined,
      100
    );

    return items.filter(item => item.tenantId === tenantId && item.entityType === 'STAFF') as Staff[];
  }
}

