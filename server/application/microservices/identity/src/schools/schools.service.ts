/**
 * Schools Service - School management for Identity Service
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
import { IdentityEventsService } from '../common/services/identity-events.service';
import { 
  School, 
  createSchoolEntity,
} from '../common/entities/school.entity';
import {
  Department,
  SchoolConfiguration,
  createDepartmentEntity,
  createSchoolConfigEntity,
  DEFAULT_SCHOOL_CONFIG,
} from '../common/entities/department.entity';
import { 
  EntityKeyBuilder, 
  RequestContext,
  PaginatedResult,
} from '../common/entities/base.entity';
import type {
  CreateSchoolDto,
  UpdateSchoolDto,
  SchoolResponseDto,
  CreateDepartmentDto,
  UpdateDepartmentDto,
  DepartmentResponseDto,
  UpdateSchoolConfigDto,
  SchoolConfigResponseDto,
} from '@aibrains/shared-types';

@Injectable()
export class SchoolsService {
  private readonly logger = new Logger(SchoolsService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: IdentityEventsService,
  ) {}

  /**
   * Create a new school
   */
  async createSchool(
    createDto: CreateSchoolDto,
    context: RequestContext
  ): Promise<SchoolResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Check for duplicate school code
    const existingSchools = await this.dynamoDBClient.query<School>(
      client,
      context.tenantId,
      'SCHOOL#',
      'entityType = :entityType',
      { ':entityType': 'SCHOOL' }
    );

    const duplicateSchool = existingSchools.items.find(
      s => s.schoolCode?.toUpperCase() === createDto.schoolCode?.toUpperCase()
    );

    if (duplicateSchool) {
      throw new ConflictException('A school with this code already exists');
    }

    const now = new Date().toISOString();
    const schoolId = uuid();

    // Validate LEA reference if provided
    if (createDto.localEducationAgencyId) {
      const leaExists = await this.dynamoDBClient.getItem(
        client,
        context.tenantId,
        EntityKeyBuilder.lea(createDto.localEducationAgencyId)
      );
      if (!leaExists) {
        throw new BadRequestException(
          `Local Education Agency with ID '${createDto.localEducationAgencyId}' not found within this tenant`
        );
      }
    }

    const school = createSchoolEntity(
      context.tenantId,
      schoolId,
      {
        schoolCode: createDto.schoolCode,
        name: createDto.name,
        shortName: createDto.shortName,
        schoolType: createDto.schoolType,
        gradeRange: createDto.gradeRange as { start: string; end: string },
        phone: createDto.phone,
        email: createDto.email,
        website: createDto.website,
        address: createDto.address as any,
        principalName: createDto.principalName,
        principalEmail: createDto.principalEmail,
        status: 'setup',
        timezone: createDto.timezone || 'America/New_York',
        locale: createDto.locale || 'en-US',
        academicCalendarType: createDto.academicCalendarType || 'semester',
        logoUrl: createDto.logoUrl,
        // Ed-Fi Education Organization Fields
        localEducationAgencyId: createDto.localEducationAgencyId,
        schoolCategories: createDto.schoolCategories as string[] | undefined,
        schoolTypeDescriptor: createDto.schoolTypeDescriptor as string | undefined,
        gradeLevels: createDto.gradeLevels as string[] | undefined,
        charterStatusDescriptor: createDto.charterStatusDescriptor as string | undefined,
        administrativeFundingControlDescriptor: createDto.administrativeFundingControlDescriptor as string | undefined,
        titleIPartASchoolDesignationDescriptor: createDto.titleIPartASchoolDesignationDescriptor,
        identificationCodes: createDto.identificationCodes as any,
        institutionTelephones: createDto.institutionTelephones as any,
        accountabilityRatings: createDto.accountabilityRatings as any,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );

    await this.dynamoDBClient.putItem(client, school);

    this.logger.log(`School created: ${school.name} (${schoolId})`);

    // Publish school created event (non-blocking)
    this.eventsService.publishSchoolCreated(
      context.tenantId,
      schoolId,
      createDto.schoolCode,
      createDto.name,
      createDto.schoolType
    ).catch(err => this.logger.error('Failed to publish SchoolCreated event', err));

    return this.toSchoolResponse(school);
  }

  /**
   * Get school by ID
   */
  async getSchool(
    schoolId: string,
    context: RequestContext
  ): Promise<SchoolResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const school = await this.dynamoDBClient.getItem<School>(
      client,
      context.tenantId,
      EntityKeyBuilder.school(schoolId)
    );

    if (!school) {
      throw new NotFoundException('School not found');
    }

    return this.toSchoolResponse(school);
  }

  /**
   * List all schools for tenant.
   *
   * No DynamoDB-level Limit is used because sub-entities (calendar dates,
   * departments, configs, etc.) share the SCHOOL# sort-key prefix and
   * outnumber actual school entities ~400:1. DynamoDB's Limit caps items
   * *evaluated*, not items *returned* after FilterExpression, so a Limit
   * of 51 can return ≤1 school while reporting hasMore=false.
   *
   * Instead we paginate through all 1MB DynamoDB pages and apply the
   * requested limit at the application level — safe because school count
   * per tenant is naturally bounded (< 100).
   */
  async listSchools(
    context: RequestContext,
    limit: number = 50,
    leaId?: string
  ): Promise<PaginatedResult<SchoolResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Build filter: always by entityType, optionally by LEA (cc33d5c pattern).
    const filterParts = ['entityType = :entityType'];
    const exprValues: Record<string, any> = { ':entityType': 'SCHOOL' };

    if (leaId) {
      filterParts.push('localEducationAgencyId = :leaId');
      exprValues[':leaId'] = leaId;
    }

    // Paginate through all DynamoDB pages to collect every school.
    let allSchools: School[] = [];
    let exclusiveStartKey: Record<string, any> | undefined;

    do {
      const result = await this.dynamoDBClient.query<School>(
        client,
        context.tenantId,
        'SCHOOL#',
        filterParts.join(' AND '),
        exprValues,
        undefined,
        undefined, // no DynamoDB Limit — avoids filter starvation
        exclusiveStartKey
      );
      allSchools.push(...result.items);
      exclusiveStartKey = result.lastEvaluatedKey
        ? JSON.parse(Buffer.from(result.lastEvaluatedKey, 'base64').toString())
        : undefined;
    } while (exclusiveStartKey);

    // Application-level pagination
    const hasMore = allSchools.length > limit;
    const returnSchools = hasMore ? allSchools.slice(0, limit) : allSchools;

    return {
      items: returnSchools.map(s => this.toSchoolResponse(s)),
      lastEvaluatedKey: undefined,
      hasMore,
    };
  }

  /**
   * Update school
   */
  async updateSchool(
    schoolId: string,
    updateDto: UpdateSchoolDto,
    context: RequestContext
  ): Promise<SchoolResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const school = await this.dynamoDBClient.getItem<School>(
      client,
      context.tenantId,
      EntityKeyBuilder.school(schoolId)
    );

    if (!school) {
      throw new NotFoundException('School not found');
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};
    const names: Record<string, string> = {};

    // Validate LEA reference if being updated
    if (updateDto.localEducationAgencyId) {
      const leaExists = await this.dynamoDBClient.getItem(
        client,
        context.tenantId,
        EntityKeyBuilder.lea(updateDto.localEducationAgencyId)
      );
      if (!leaExists) {
        throw new BadRequestException(
          `Local Education Agency with ID '${updateDto.localEducationAgencyId}' not found within this tenant`
        );
      }
    }

    // Use expression attribute names for all fields to avoid DynamoDB reserved keyword issues
    const simpleFields = [
      'name', 'shortName', 'schoolType', 'phone', 'email', 'website',
      'principalName', 'principalEmail', 'timezone', 'currentAcademicYearId', 'logoUrl',
      'schoolTypeDescriptor', 'charterStatusDescriptor',
      'administrativeFundingControlDescriptor', 'titleIPartASchoolDesignationDescriptor',
    ];

    for (const field of simpleFields) {
      if (updateDto[field as keyof UpdateSchoolDto] !== undefined) {
        updates.push(`#${field} = :${field}`);
        values[`:${field}`] = updateDto[field as keyof UpdateSchoolDto];
        names[`#${field}`] = field;
      }
    }

    if (updateDto.status) {
      updates.push('#status = :status');
      values[':status'] = updateDto.status;
      names['#status'] = 'status';
    }

    if (updateDto.gradeRange) {
      updates.push('#gradeRange = :gradeRange');
      values[':gradeRange'] = updateDto.gradeRange;
      names['#gradeRange'] = 'gradeRange';
    }

    if (updateDto.address) {
      updates.push('#address = :address');
      values[':address'] = updateDto.address;
      names['#address'] = 'address';
    }

    // Handle localEducationAgencyId (null means unlink from LEA)
    if (updateDto.localEducationAgencyId !== undefined) {
      updates.push('#localEducationAgencyId = :localEducationAgencyId');
      values[':localEducationAgencyId'] = updateDto.localEducationAgencyId;
      names['#localEducationAgencyId'] = 'localEducationAgencyId';
    }

    // Ed-Fi array fields
    const arrayFields = [
      'schoolCategories', 'gradeLevels', 'identificationCodes',
      'institutionTelephones', 'accountabilityRatings'
    ] as const;
    for (const field of arrayFields) {
      if ((updateDto as any)[field] !== undefined) {
        updates.push(`#${field} = :${field}`);
        values[`:${field}`] = (updateDto as any)[field];
        names[`#${field}`] = field;
      }
    }

    if (updates.length === 0) {
      return this.toSchoolResponse(school);
    }

    updates.push('#updatedAt = :updatedAt', '#updatedBy = :updatedBy', '#version = #version + :inc');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;
    values[':inc'] = 1;
    names['#updatedAt'] = 'updatedAt';
    names['#updatedBy'] = 'updatedBy';
    names['#version'] = 'version';

    const updatedSchool = await this.dynamoDBClient.updateItem<School>(
      client,
      context.tenantId,
      EntityKeyBuilder.school(schoolId),
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      names
    );

    this.logger.log(`School updated: ${schoolId}`);

    // Publish school updated event (non-blocking)
    const updatedFields = Object.keys(updateDto).filter(k => updateDto[k as keyof UpdateSchoolDto] !== undefined);
    this.eventsService.publishSchoolUpdated(
      context.tenantId,
      schoolId,
      updatedFields
    ).catch(err => this.logger.error('Failed to publish SchoolUpdated event', err));

    return this.toSchoolResponse(updatedSchool);
  }

  /**
   * Delete school (soft delete)
   */
  async deleteSchool(
    schoolId: string,
    context: RequestContext
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const school = await this.dynamoDBClient.getItem<School>(
      client,
      context.tenantId,
      EntityKeyBuilder.school(schoolId)
    );

    if (!school) {
      throw new NotFoundException('School not found');
    }

    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      EntityKeyBuilder.school(schoolId),
      'SET #status = :status, updatedAt = :updatedAt',
      {
        ':status': 'inactive',
        ':updatedAt': new Date().toISOString(),
      },
      undefined,
      { '#status': 'status' }
    );

    this.logger.log(`School deleted (soft): ${schoolId}`);
  }

  private toSchoolResponse(school: School): SchoolResponseDto {
    return {
      schoolId: school.schoolId,
      schoolCode: school.schoolCode,
      name: school.name,
      shortName: school.shortName,
      schoolType: school.schoolType,
      gradeRange: school.gradeRange,
      phone: school.phone,
      email: school.email,
      website: school.website,
      address: school.address,
      principalName: school.principalName,
      principalEmail: school.principalEmail,
      status: school.status,
      timezone: school.timezone,
      locale: school.locale,
      academicCalendarType: school.academicCalendarType,
      currentAcademicYearId: school.currentAcademicYearId,
      studentCount: school.studentCount,
      staffCount: school.staffCount,
      teacherCount: school.teacherCount,
      logoUrl: school.logoUrl,
      // Ed-Fi Education Organization Fields
      localEducationAgencyId: school.localEducationAgencyId,
      schoolCategories: school.schoolCategories as SchoolResponseDto['schoolCategories'],
      schoolTypeDescriptor: school.schoolTypeDescriptor as SchoolResponseDto['schoolTypeDescriptor'],
      gradeLevels: school.gradeLevels as SchoolResponseDto['gradeLevels'],
      charterStatusDescriptor: school.charterStatusDescriptor as SchoolResponseDto['charterStatusDescriptor'],
      administrativeFundingControlDescriptor: school.administrativeFundingControlDescriptor as SchoolResponseDto['administrativeFundingControlDescriptor'],
      titleIPartASchoolDesignationDescriptor: school.titleIPartASchoolDesignationDescriptor,
      identificationCodes: school.identificationCodes as SchoolResponseDto['identificationCodes'],
      institutionTelephones: school.institutionTelephones as SchoolResponseDto['institutionTelephones'],
      accountabilityRatings: school.accountabilityRatings,
      createdAt: school.createdAt,
      updatedAt: school.updatedAt,
    };
  }

  // ============================================
  // Configuration Methods
  // ============================================

  /**
   * Get school configuration
   */
  async getConfiguration(
    schoolId: string,
    context: RequestContext
  ): Promise<SchoolConfigResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const config = await this.dynamoDBClient.getItem<SchoolConfiguration>(
      client,
      context.tenantId,
      EntityKeyBuilder.schoolConfig(schoolId)
    );

    // If no config exists, create default
    if (!config) {
      return this.createDefaultConfig(schoolId, context);
    }

    return this.toConfigResponse(config);
  }

  /**
   * Update school configuration
   */
  async updateConfiguration(
    schoolId: string,
    updateDto: UpdateSchoolConfigDto,
    context: RequestContext
  ): Promise<SchoolConfigResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    
    // Get existing or create default
    let config = await this.dynamoDBClient.getItem<SchoolConfiguration>(
      client,
      context.tenantId,
      EntityKeyBuilder.schoolConfig(schoolId)
    );

    if (!config) {
      await this.createDefaultConfig(schoolId, context);
      config = await this.dynamoDBClient.getItem<SchoolConfiguration>(
        client,
        context.tenantId,
        EntityKeyBuilder.schoolConfig(schoolId)
      );
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};
    const names: Record<string, string> = {};

    // Use expression attribute names for all fields to avoid DynamoDB reserved keyword issues
    // (e.g., 'timezone', 'locale' are reserved keywords)
    const simpleFields = [
      'timezone', 'locale', 'dateFormat', 'timeFormat',
      'academicCalendarType', 'attendanceRequired', 'startTime', 'endTime',
      'periodDuration', 'notificationsEnabled', 'emailNotifications', 'smsNotifications'
    ];

    for (const field of simpleFields) {
      if (updateDto[field as keyof UpdateSchoolConfigDto] !== undefined) {
        updates.push(`#${field} = :${field}`);
        values[`:${field}`] = updateDto[field as keyof UpdateSchoolConfigDto];
        names[`#${field}`] = field;
      }
    }

    if (updateDto.schoolDays) {
      updates.push('#schoolDays = :schoolDays');
      values[':schoolDays'] = updateDto.schoolDays;
      names['#schoolDays'] = 'schoolDays';
    }

    if (updateDto.gradingScale) {
      updates.push('#gradingScale = :gradingScale');
      values[':gradingScale'] = updateDto.gradingScale;
      names['#gradingScale'] = 'gradingScale';
    }

    if (updateDto.features) {
      updates.push('#features = :features');
      values[':features'] = { ...config!.features, ...updateDto.features };
      names['#features'] = 'features';
    }

    if (updates.length === 0) {
      return this.toConfigResponse(config!);
    }

    updates.push('#updatedAt = :updatedAt', '#updatedBy = :updatedBy');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;
    names['#updatedAt'] = 'updatedAt';
    names['#updatedBy'] = 'updatedBy';

    const updatedConfig = await this.dynamoDBClient.updateItem<SchoolConfiguration>(
      client,
      context.tenantId,
      EntityKeyBuilder.schoolConfig(schoolId),
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      names
    );

    this.logger.log(`School configuration updated: ${schoolId}`);

    return this.toConfigResponse(updatedConfig);
  }

  /**
   * Create default configuration for a school
   */
  private async createDefaultConfig(
    schoolId: string,
    context: RequestContext
  ): Promise<SchoolConfigResponseDto> {
    const now = new Date().toISOString();
    const config = createSchoolConfigEntity(
      context.tenantId,
      schoolId,
      {
        ...DEFAULT_SCHOOL_CONFIG,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    await this.dynamoDBClient.putItem(client, config);

    this.logger.log(`Default configuration created for school: ${schoolId}`);

    return this.toConfigResponse(config);
  }

  private toConfigResponse(config: SchoolConfiguration): SchoolConfigResponseDto {
    return {
      schoolId: config.schoolId,
      timezone: config.timezone,
      locale: config.locale,
      dateFormat: config.dateFormat,
      timeFormat: config.timeFormat,
      academicCalendarType: config.academicCalendarType,
      gradingScale: config.gradingScale,
      attendanceRequired: config.attendanceRequired,
      schoolDays: config.schoolDays,
      startTime: config.startTime,
      endTime: config.endTime,
      periodDuration: config.periodDuration,
      notificationsEnabled: config.notificationsEnabled,
      emailNotifications: config.emailNotifications,
      smsNotifications: config.smsNotifications,
      features: config.features,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
  }

  // ============================================
  // Department Methods
  // ============================================

  /**
   * Create department
   */
  async createDepartment(
    schoolId: string,
    createDto: CreateDepartmentDto,
    context: RequestContext
  ): Promise<DepartmentResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Check for duplicate department code within the school
    const existingDepts = await this.dynamoDBClient.query<Department>(
      client,
      context.tenantId,
      `SCHOOL#${schoolId}#DEPT#`,
      'entityType = :entityType',
      { ':entityType': 'DEPARTMENT' }
    );

    const duplicateDept = existingDepts.items.find(
      d => d.code?.toUpperCase() === createDto.code?.toUpperCase()
    );

    if (duplicateDept) {
      throw new ConflictException('A department with this code already exists in this school');
    }

    const now = new Date().toISOString();
    const departmentId = uuid();

    const department = createDepartmentEntity(
      context.tenantId,
      schoolId,
      departmentId,
      {
        code: createDto.code.toUpperCase(),
        name: createDto.name,
        description: createDto.description,
        headUserId: createDto.headUserId,
        isActive: true,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );

    await this.dynamoDBClient.putItem(client, department);

    this.logger.log(`Department created: ${department.name} (${departmentId}) for school ${schoolId}`);

    return this.toDepartmentResponse(department);
  }

  /**
   * Get department by ID
   */
  async getDepartment(
    schoolId: string,
    departmentId: string,
    context: RequestContext
  ): Promise<DepartmentResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const department = await this.dynamoDBClient.getItem<Department>(
      client,
      context.tenantId,
      `SCHOOL#${schoolId}#DEPT#${departmentId}`
    );

    if (!department) {
      throw new NotFoundException('Department not found');
    }

    return this.toDepartmentResponse(department);
  }

  /**
   * List departments for a school
   */
  async listDepartments(
    schoolId: string,
    context: RequestContext,
    limit: number = 50
  ): Promise<PaginatedResult<DepartmentResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const result = await this.dynamoDBClient.query<Department>(
      client,
      context.tenantId,
      `SCHOOL#${schoolId}#DEPT#`,
      'entityType = :entityType',
      { ':entityType': 'DEPARTMENT' },
      undefined,
      limit
    );

    return {
      items: result.items.map(d => this.toDepartmentResponse(d)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Update department
   */
  async updateDepartment(
    schoolId: string,
    departmentId: string,
    updateDto: UpdateDepartmentDto,
    context: RequestContext
  ): Promise<DepartmentResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const department = await this.dynamoDBClient.getItem<Department>(
      client,
      context.tenantId,
      `SCHOOL#${schoolId}#DEPT#${departmentId}`
    );

    if (!department) {
      throw new NotFoundException('Department not found');
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};

    if (updateDto.name) {
      updates.push('name = :name');
      values[':name'] = updateDto.name;
    }
    if (updateDto.description !== undefined) {
      updates.push('description = :description');
      values[':description'] = updateDto.description;
    }
    if (updateDto.headUserId !== undefined) {
      updates.push('headUserId = :headUserId');
      values[':headUserId'] = updateDto.headUserId;
    }
    if (updateDto.isActive !== undefined) {
      updates.push('isActive = :isActive');
      values[':isActive'] = updateDto.isActive;
    }

    if (updates.length === 0) {
      return this.toDepartmentResponse(department);
    }

    updates.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;

    const updatedDepartment = await this.dynamoDBClient.updateItem<Department>(
      client,
      context.tenantId,
      `SCHOOL#${schoolId}#DEPT#${departmentId}`,
      `SET ${updates.join(', ')}`,
      values
    );

    this.logger.log(`Department updated: ${departmentId}`);

    return this.toDepartmentResponse(updatedDepartment);
  }

  /**
   * Delete department (soft delete)
   */
  async deleteDepartment(
    schoolId: string,
    departmentId: string,
    context: RequestContext
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const department = await this.dynamoDBClient.getItem<Department>(
      client,
      context.tenantId,
      `SCHOOL#${schoolId}#DEPT#${departmentId}`
    );

    if (!department) {
      throw new NotFoundException('Department not found');
    }

    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      `SCHOOL#${schoolId}#DEPT#${departmentId}`,
      'SET isActive = :isActive, updatedAt = :updatedAt',
      {
        ':isActive': false,
        ':updatedAt': new Date().toISOString(),
      }
    );

    this.logger.log(`Department deleted (soft): ${departmentId}`);
  }

  private toDepartmentResponse(department: Department): DepartmentResponseDto {
    return {
      departmentId: department.departmentId,
      schoolId: department.schoolId,
      code: department.code,
      name: department.name,
      description: department.description,
      headUserId: department.headUserId,
      headName: department.headName,
      isActive: department.isActive,
      teacherCount: department.teacherCount,
      courseCount: department.courseCount,
      createdAt: department.createdAt,
      updatedAt: department.updatedAt,
    };
  }
}

