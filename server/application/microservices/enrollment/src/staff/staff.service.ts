/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Staff Service - CRUD operations for Staff entities
 */

import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/dynamodb-client.service';
import { Staff, RequestContext } from '../common/entities/staff.entities';
import { EntityKeyBuilder } from '../common/entities/base.entity';
import { CreateStaffDto, UpdateStaffDto } from './dto/staff.dto';

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService
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
      qualifications: createStaffDto.qualifications || {
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
      throw new Error(`Staff not found: ${staffId}`);
    }

    return staff as Staff;
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

