/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Schools Service - EdForge.net
 * 
 * ARCHITECTURE:
 * - Single DynamoDB table with hierarchical keys
 * - Tenant isolation at partition key level (tenantId)
 * - GSIs for efficient school-centric and year-scoped queries
 * - Events published to EventBridge for decoupled architecture
 */

import { Injectable, HttpException, HttpStatus, NotFoundException, ConflictException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ClientFactoryService } from '@app/client-factory';
import { v4 as uuid } from 'uuid';
import {
  School,
  Department,
  SchoolConfiguration,
  EntityKeyBuilder,
  RequestContext
} from './entities/school.entity.enhanced';
import { ValidationService } from './services/validation.service';
import { EventService } from './services/event.service';
import { CreateSchoolDto, UpdateSchoolDto, CreateDepartmentDto } from './dto/school.dto';
import { retryWithBackoff } from '../common/utils/retry.util';

@Injectable()
export class SchoolsService {
  constructor(
    private readonly clientFac: ClientFactoryService,
    private readonly validationService: ValidationService,
    private readonly eventService: EventService
  ) {}
  
  private tableName: string = process.env.TABLE_NAME || 'SCHOOL_TABLE_NAME';

  /**
   * Create School
   * 
   * WORKFLOW:
   * 1. Validate input (format, uniqueness, business rules)
   * 2. Create School entity with proper DynamoDB keys
   * 3. Write to DynamoDB
   * 4. Publish SchoolCreated event
   * 
   * KEYS STRUCTURE:
   * - PK: tenantId
   * - SK: SCHOOL#schoolId
   * - GSI1-PK: schoolId (enables school-centric queries)
   * - GSI3-PK: tenantId#SCHOOL (enables listing/filtering schools)
   */
  async createSchool(
    tenantId: string,
    createSchoolDto: CreateSchoolDto,
    context: RequestContext
  ): Promise<School> {
    try {
      // 1. Validate (checks school code uniqueness, format validation, etc.)
      await this.validationService.validateSchoolCreation(tenantId, createSchoolDto, context.jwtToken);

    // 2. Build school entity
    const schoolId = uuid();
    const timestamp = new Date().toISOString();

    const school: School = {
      // DynamoDB Keys
      tenantId,
      entityKey: EntityKeyBuilder.school(schoolId), // SCHOOL#schoolId
      
      // Core Identity
      schoolId,
      schoolName: createSchoolDto.schoolName,
      schoolCode: createSchoolDto.schoolCode.toUpperCase(),
      schoolType: createSchoolDto.schoolType,
      
      // Structured Fields
      contactInfo: createSchoolDto.contactInfo,
      address: createSchoolDto.address,
      
      // Capacity
      maxStudentCapacity: createSchoolDto.maxStudentCapacity,
      currentEnrollment: 0,
      gradeRange: createSchoolDto.gradeRange,
      
      // Administrative
      principalUserId: createSchoolDto.principalUserId,
      vicePrincipalUserIds: createSchoolDto.vicePrincipalUserIds,
      
      // Status
      status: 'active',
      
      // Metadata
      foundedDate: createSchoolDto.foundedDate,
      description: createSchoolDto.description,
      motto: createSchoolDto.motto,
      logoUrl: createSchoolDto.logoUrl,
      
      // Audit
      createdAt: timestamp,
      createdBy: context.userId,
      updatedAt: timestamp,
      updatedBy: context.userId,
      version: 1,
      
      // DynamoDB Metadata
      entityType: 'SCHOOL',
      
      // GSI Keys
      gsi1pk: schoolId,
      gsi1sk: `METADATA#${schoolId}`,
      gsi3pk: `${tenantId}#SCHOOL`,
      gsi3sk: `active#${timestamp}`
    };

    // 3. Save to DynamoDB
    const client = await this.clientFac.getClient(tenantId, context.jwtToken);
    
    await client.send(new PutCommand({
      TableName: this.tableName,
      Item: school
    }));

    // 4. Publish event
    await this.eventService.publishEvent({
      eventType: 'SchoolCreated',
      timestamp,
      tenantId,
      schoolId,
      schoolName: school.schoolName,
      schoolCode: school.schoolCode,
      schoolType: school.schoolType,
      timezone: school.address.timezone,
      maxCapacity: school.maxStudentCapacity
    });

      console.log(`✅ School created: ${school.schoolName} (${schoolId})`);
      return school;
    } catch (error) {
      // Enhanced error handling with proper HTTP status codes
      if (error instanceof BadRequestException) {
        // Re-throw validation errors as-is (they're already properly formatted)
        throw error;
      }
      
      if (error.name === 'ConditionalCheckFailedException') {
        throw new ConflictException({
          message: 'School with this code already exists',
          code: 'SCHOOL_CODE_EXISTS'
        });
      }
      
      if (error.name === 'ValidationException' && error.message.includes('Missing the key')) {
        throw new InternalServerErrorException({
          message: 'Database schema mismatch - please contact support',
          code: 'SCHEMA_ERROR'
        });
      }
      
      // Log the full error for debugging
      console.error('❌ School creation failed:', {
        tenantId,
        schoolCode: createSchoolDto.schoolCode,
        error: error.message,
        stack: error.stack
      });
      
      throw new InternalServerErrorException({
        message: 'Failed to create school',
        code: 'INTERNAL_ERROR'
      });
    }
  }

  /**
   * Get all schools for tenant
   * 
   * ACCESS PATTERN: Query by tenantId, filter by entityType
   * Excludes closed schools
   */
  async getSchools(tenantId: string, jwtToken: string): Promise<School[]> {
    const client = await this.clientFac.getClient(tenantId, jwtToken);

    const result = await client.send(new QueryCommand({
        TableName: this.tableName,
      KeyConditionExpression: 'tenantId = :tenantId',
      FilterExpression: 'entityType = :type AND #status <> :closed',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
        ExpressionAttributeValues: {
        ':tenantId': tenantId,
        ':type': 'SCHOOL',
        ':closed': 'closed'
      }
    }));

    return (result.Items || []) as School[];
  }

  /**
   * Get school by ID
   * 
   * ACCESS PATTERN: Primary key lookup
   * - PK: tenantId
   * - SK: SCHOOL#schoolId
   */
  async getSchool(tenantId: string, schoolId: string, jwtToken: string): Promise<School> {
    const client = await this.clientFac.getClient(tenantId, jwtToken);

    const result = await client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'tenantId = :tenantId AND entityKey = :entityKey',
      ExpressionAttributeValues: {
        ':tenantId': tenantId,
        ':entityKey': EntityKeyBuilder.school(schoolId)
      }
    }));

    if (!result.Items || result.Items.length === 0) {
      throw new NotFoundException('School not found');
    }

    return result.Items[0] as School;
  }

  /**
   * Update school with optimistic locking and retry mechanism
   * 
   * OPTIMISTIC LOCKING prevents concurrent modification conflicts
   * RETRY MECHANISM: On conflict, fetches fresh data and retries with latest version
   */
  async updateSchool(
    tenantId: string,
    schoolId: string,
    updateDto: UpdateSchoolDto,
    context: RequestContext
  ): Promise<School> {
    const client = await this.clientFac.getClient(tenantId, context.jwtToken);
    const timestamp = new Date().toISOString();

    // Store original beforeState for event publishing
    const beforeState = await this.getSchool(tenantId, schoolId, context.jwtToken);

    // Use retry mechanism with fresh data fetch on conflict
    const updatedSchool = await retryWithBackoff(
      async () => {
        // Fetch fresh school data on each retry attempt to get latest version
        const currentSchool = await this.getSchool(tenantId, schoolId, context.jwtToken);
        const currentVersion = currentSchool.version;

        // Use the fresh version from database, not the one from DTO
        // This handles cases where the school was updated between retries
        const versionToUse = currentVersion;

        const updates: string[] = [];
        const names: Record<string, string> = {};
        const values: Record<string, any> = {};

        if (updateDto.schoolName) {
          updates.push('#schoolName = :schoolName');
          names['#schoolName'] = 'schoolName';
          values[':schoolName'] = updateDto.schoolName;
        }

        if (updateDto.contactInfo) {
          updates.push('#contactInfo = :contactInfo');
          names['#contactInfo'] = 'contactInfo';
          values[':contactInfo'] = updateDto.contactInfo;
        }

        if (updateDto.address) {
          updates.push('#address = :address');
          names['#address'] = 'address';
          values[':address'] = updateDto.address;
        }

        if (updateDto.description !== undefined) {
          updates.push('#description = :description');
          names['#description'] = 'description';
          values[':description'] = updateDto.description;
        }

        if (updateDto.accreditationInfo) {
          updates.push('#accreditationInfo = :accreditationInfo');
          names['#accreditationInfo'] = 'accreditationInfo';
          values[':accreditationInfo'] = updateDto.accreditationInfo;
        }

        if (updateDto.status) {
          updates.push('#status = :status');
          names['#status'] = 'status';
          values[':status'] = updateDto.status;
        }

        // Always update audit fields
        updates.push('#updatedAt = :updatedAt', '#updatedBy = :updatedBy', '#version = :newVersion');
        names['#updatedAt'] = 'updatedAt';
        names['#updatedBy'] = 'updatedBy';
        names['#version'] = 'version';
        values[':updatedAt'] = timestamp;
        values[':updatedBy'] = context.userId;
        values[':newVersion'] = versionToUse + 1;
        values[':currentVersion'] = versionToUse;

        const result = await client.send(new UpdateCommand({
          TableName: this.tableName,
          Key: {
            tenantId,
            entityKey: EntityKeyBuilder.school(schoolId)
          },
          UpdateExpression: `SET ${updates.join(', ')}`,
          ConditionExpression: '#version = :currentVersion',
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ReturnValues: 'ALL_NEW'
        }));

        return result.Attributes as School;
      },
      {
        maxAttempts: 3,
        baseDelay: 100,
        maxDelay: 2000
      },
      console // Use console as logger
    ).catch((error) => {
      // Transform error to user-friendly message
      if (error.name === 'ConditionalCheckFailedException') {
        throw new ConflictException(
          'School was modified by another user. Please refresh and try again.'
        );
      }
      if (error instanceof ConflictException) {
        throw error;
      }
      throw new HttpException(
        { status: HttpStatus.INTERNAL_SERVER_ERROR, error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    });

    // Publish event only once after successful update (outside retry loop)
    await this.eventService.publishEvent({
      eventType: 'SchoolUpdated',
      timestamp,
      tenantId,
      schoolId,
      changes: { before: beforeState, after: updatedSchool }
    });

    console.log(`✅ School updated: ${updatedSchool.schoolName} (v${updatedSchool.version})`);
    return updatedSchool;
  }

  /**
   * Delete school (soft delete)
   */
  async deleteSchool(
    tenantId: string,
    schoolId: string,
    context: RequestContext
  ): Promise<void> {
    const client = await this.clientFac.getClient(tenantId, context.jwtToken);
    const school = await this.getSchool(tenantId, schoolId, context.jwtToken);

    await client.send(new UpdateCommand({
        TableName: this.tableName,
        Key: {
          tenantId,
        entityKey: EntityKeyBuilder.school(schoolId)
        },
      UpdateExpression: 'SET #status = :status, statusReason = :reason, updatedAt = :now, updatedBy = :userId, #version = #version + :inc',
        ExpressionAttributeNames: {
        '#status': 'status',
        '#version': 'version'
        },
        ExpressionAttributeValues: {
        ':status': 'closed',
        ':reason': 'Deleted by user',
        ':now': new Date().toISOString(),
        ':userId': context.userId,
        ':inc': 1
      }
    }));

    await this.eventService.publishEvent({
      eventType: 'SchoolDeleted',
      timestamp: new Date().toISOString(),
      tenantId,
      schoolId,
      schoolName: school.schoolName,
      reason: 'Deleted by user'
    });

    console.log(`✅ School soft-deleted: ${school.schoolName}`);
  }

  /**
   * Create Department
   * 
   * VALIDATION: Checks school exists and department code is unique
   */
  async createDepartment(
    tenantId: string,
    schoolId: string,
    createDto: CreateDepartmentDto,
    context: RequestContext
  ): Promise<Department> {
    await this.validationService.validateDepartmentCreation(
      tenantId,
      schoolId,
      createDto,
      context.jwtToken
    );

    const departmentId = uuid();
    const timestamp = new Date().toISOString();

    const department: Department = {
      tenantId,
      entityKey: EntityKeyBuilder.department(schoolId, departmentId),
      
      schoolId,
      departmentId,
      
      departmentName: createDto.departmentName,
      departmentCode: createDto.departmentCode.toUpperCase(),
      category: createDto.category,
      
      headOfDepartmentUserId: createDto.headOfDepartmentUserId,
      
      academicScope: {
        gradeLevels: [],
        subjects: [],
        curriculumStandards: []
      },
      staffing: {
        allocatedPositions: 0,
        filledPositions: 0,
        vacantPositions: 0
      },
      resources: {
        facilities: [],
        equipment: []
      },
      
      status: 'active',
      
      createdAt: timestamp,
      createdBy: context.userId,
      updatedAt: timestamp,
      updatedBy: context.userId,
      version: 1,
      
      entityType: 'DEPARTMENT',
      gsi1pk: schoolId,
      gsi1sk: `DEPT#${departmentId}`
    };

    const client = await this.clientFac.getClient(tenantId, context.jwtToken);

    await client.send(new PutCommand({
      TableName: this.tableName,
      Item: department
    }));

    await this.eventService.publishEvent({
      eventType: 'DepartmentCreated',
      timestamp,
      tenantId,
      schoolId,
      departmentId,
      departmentName: department.departmentName,
      departmentCode: department.departmentCode,
      category: department.category
    });

    console.log(`✅ Department created: ${department.departmentName}`);
    return department;
  }

  /**
   * Get departments for school
   * 
   * ACCESS PATTERN: GSI1 (school-centric)
   * - Query: gsi1pk=schoolId, gsi1sk begins_with DEPT#
   * 
   * PERFORMANCE: Much faster than FilterExpression on tenant partition
   */
  async getDepartments(
    tenantId: string,
    schoolId: string,
    jwtToken: string
  ): Promise<Department[]> {
    const client = await this.clientFac.getClient(tenantId, jwtToken);

    const result = await client.send(new QueryCommand({
        TableName: this.tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :schoolId AND begins_with(gsi1sk, :prefix)',
      FilterExpression: '#status <> :dissolved',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
        ExpressionAttributeValues: {
        ':schoolId': schoolId,
        ':prefix': 'DEPT#',
        ':dissolved': 'dissolved'
      }
    }));

    return (result.Items || []) as Department[];
  }

  /**
   * Get School Configuration
   * 
   * ACCESS PATTERN: Primary key lookup
   * - PK: tenantId
   * - SK: SCHOOL#schoolId#CONFIG
   */
  async getSchoolConfiguration(
    tenantId: string,
    schoolId: string,
    jwtToken: string
  ): Promise<SchoolConfiguration | null> {
    const client = await this.clientFac.getClient(tenantId, jwtToken);

    const result = await client.send(new QueryCommand({
        TableName: this.tableName,
      KeyConditionExpression: 'tenantId = :tenantId AND entityKey = :entityKey',
        ExpressionAttributeValues: {
        ':tenantId': tenantId,
        ':entityKey': EntityKeyBuilder.schoolConfig(schoolId)
      }
    }));

    return (result.Items?.[0] as SchoolConfiguration) || null;
  }

  /**
   * Create or Update School Configuration (UPSERT)
   */
  async upsertSchoolConfiguration(
    tenantId: string,
    schoolId: string,
    configDto: any,
    context: RequestContext
  ): Promise<SchoolConfiguration> {
    const timestamp = new Date().toISOString();
    const existing = await this.getSchoolConfiguration(tenantId, schoolId, context.jwtToken);

    const config: SchoolConfiguration = {
      tenantId,
      entityKey: EntityKeyBuilder.schoolConfig(schoolId),
      
      schoolId,
      
      academicSettings: configDto.academicSettings,
      attendanceSettings: configDto.attendanceSettings,
      calendarSettings: configDto.calendarSettings || {},
      communicationSettings: configDto.communicationSettings || {},
      securitySettings: configDto.securitySettings || {
        dataRetentionYears: 2,
        exportEnabled: true,
        apiAccessEnabled: true,
        requireMFA: false,
        sessionTimeoutMinutes: 30
      },
      featureFlags: configDto.featureFlags || {},
      
      createdAt: existing?.createdAt || timestamp,
      createdBy: existing?.createdBy || context.userId,
      updatedAt: timestamp,
      updatedBy: context.userId,
      version: existing ? existing.version + 1 : 1,
      
      entityType: 'SCHOOL_CONFIG',
      gsi1pk: schoolId,
      gsi1sk: 'CONFIG#current'
    };

    const client = await this.clientFac.getClient(tenantId, context.jwtToken);

    await client.send(new PutCommand({
      TableName: this.tableName,
      Item: config
    }));

    console.log(`✅ School configuration ${existing ? 'updated' : 'created'} for school ${schoolId}`);
    return config;
  }
}
