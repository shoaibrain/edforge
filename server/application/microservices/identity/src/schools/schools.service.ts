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
  getDefaultConfigForCountry,
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
import { validateSchoolTypeGradeRange, classifyUpdateFields, getLockedFieldsMessage } from '@aibrains/shared-types';
import { AuditLogEntry, createAuditLogEntity, computeFieldChanges } from '../common/entities/audit.entity';

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

    // Cross-validate schoolType vs gradeRange
    if (createDto.gradeRange) {
      const rangeError = validateSchoolTypeGradeRange(createDto.schoolType, createDto.gradeRange);
      if (rangeError) {
        throw new BadRequestException(rangeError);
      }
    }

    const now = new Date().toISOString();
    const schoolId = uuid();
    const countryCode = (createDto.address as any)?.country || 'USA';
    const countryDefaults = getDefaultConfigForCountry(countryCode);

    // Sprint C Gap 1: PABSON tenants must populate `emisSchoolCode` at school
    // creation. The IEMIS school code anchors:
    //   - GSI7-based dedup on bulk student imports (students carry
    //     emisSchoolCode in their import payload).
    //   - Government reporting to Nepal's IEMIS portal.
    //   - Row-level mismatch warnings when the importer sees a student whose
    //     declared school code doesn't match the target school.
    // It's also in FIELD_MUTABILITY.immutable (shared-types 0.29.0) — so
    // once written it cannot be PATCHed. That makes "required at create" the
    // only enforcement point; missing it means the school is effectively
    // un-onboardable into IEMIS flows without a DDB rewrite.
    //
    // The 400 is structured so the wizard can highlight the right field; the
    // shape matches Sprint B's `{ details: { ... } }` envelope that the
    // GlobalExceptionFilter whitelists.
    const tenantRow = await this.dynamoDBClient.getItem<{ archetype?: string }>(
      client,
      context.tenantId,
      EntityKeyBuilder.tenantMetadata(),
    );
    const archetype = tenantRow?.archetype?.toUpperCase();
    if (archetype === 'PABSON' && !(createDto as any).emisSchoolCode) {
      this.logger.warn(
        `PABSON create rejected — missing emisSchoolCode. ` +
          `tenantId=${context.tenantId} schoolCode=${createDto.schoolCode} actor=${context.userId}`,
      );
      throw new BadRequestException({
        message: 'emisSchoolCode is required for PABSON tenants',
        errorCode: 'EMIS_CODE_REQUIRED',
        details: {
          archetype: 'PABSON',
          field: 'emisSchoolCode',
          reason:
            'Nepal IEMIS integration requires the government-issued school ' +
            'code at creation. It cannot be added later because it is ' +
            'immutable — rename requires a cross-system migration.',
        },
      });
    }

    // Sprint 1 S1.3 — cross-tenant IEMIS School Code uniqueness.
    //
    // An IEMIS School Code is issued by the local municipality to exactly
    // one school. Two EdForge tenants claiming the same code is a data-
    // integrity red flag: either one of them typo'd the code, or both are
    // trying to operate the same physical school (which indicates a
    // tenant-onboarding mistake). In either case, EdForge rejects at
    // create time rather than silently letting the collision land — the
    // field is immutable, so the only recovery from a bad code is a
    // cross-tenant delete.
    //
    // The check uses the SYSTEM client (not tenant-scoped) because the
    // lookup spans all tenants. GSI8 is sparse on emisSchoolCode so
    // cardinality is small (one row per school that has a code).
    const emisSchoolCode = (createDto as any).emisSchoolCode as string | undefined;
    if (emisSchoolCode) {
      const systemClient = this.dynamoDBClient.getSystemClient();
      const existing = await this.dynamoDBClient.queryGSI<{ tenantId: string; schoolId: string }>(
        systemClient,
        'GSI8',
        emisSchoolCode,
      );
      if (existing.items.length > 0) {
        const conflictSchoolId = existing.items[0].schoolId;
        // Log for operator visibility, but expose only the high-level
        // reason to the caller (the conflicting tenantId / schoolId are
        // not the requester's to know).
        this.logger.warn(
          `Cross-tenant IEMIS School Code collision: code=${emisSchoolCode} ` +
            `requester=${context.tenantId} conflictSchoolId=${conflictSchoolId}`,
        );
        throw new ConflictException({
          message: 'IEMIS School Code is already in use by another tenant',
          errorCode: 'DUPLICATE_IEMIS_CODE',
          details: {
            field: 'emisSchoolCode',
            reason:
              'Each IEMIS School Code maps to exactly one school nationally. ' +
              'If you believe this is an error, contact EdForge support — the ' +
              'code is immutable so we cannot silently reassign it.',
          },
        });
      }
    }

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
        emisSchoolCode: emisSchoolCode,
        // Sparse GSI8 — populated only when an IEMIS code is present, so
        // the index stays small. The SK carries tenant+school context so
        // an ops query from the console can see which tenant holds the
        // code without round-tripping to the main row.
        gsi8pk: emisSchoolCode,
        gsi8sk: emisSchoolCode
          ? `TENANT#${context.tenantId}#SCHOOL#${schoolId}`
          : undefined,
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
        timezone: createDto.timezone || countryDefaults.timezone,
        locale: createDto.locale || countryDefaults.locale,
        academicCalendarType: createDto.academicCalendarType || countryDefaults.academicCalendarType,
        calendarSystem: (createDto as any).calendarSystem || (countryCode === 'NPL' ? 'bikram_sambat' : 'gregorian'),
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

    // Create school and default config together
    await this.dynamoDBClient.putItem(client, school);

    // Eagerly create default config — country-aware defaults
    const config = createSchoolConfigEntity(
      context.tenantId,
      schoolId,
      {
        ...countryDefaults,
        timezone: createDto.timezone || countryDefaults.timezone,
        academicCalendarType: createDto.academicCalendarType || countryDefaults.academicCalendarType,
        locale: createDto.locale || countryDefaults.locale,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );
    await this.dynamoDBClient.putItem(client, config);

    this.logger.log(
      `School created: ${school.name} (${schoolId}) with default config` +
        (archetype === 'PABSON'
          ? ` [PABSON emisSchoolCode=${(createDto as any).emisSchoolCode}]`
          : ''),
    );

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

    // Field governance: check mutability
    const { immutable, locked } = classifyUpdateFields(updateDto as Record<string, any>);
    if (immutable.length > 0) {
      throw new BadRequestException(`The following fields cannot be changed after creation: ${immutable.map(f => `"${f}"`).join(', ')}`);
    }

    // P0.17 — deprecation warning for school-level regional fields.
    // Decision #3: regional settings live at the tenant level only. Schools
    // must not override `timezone`/`locale`/`calendarSystem`/`academicCalendarType`.
    // P0 emits a warning (don't reject yet — would break existing flows);
    // P1 removes these from the DTO and entity entirely.
    const regionalFieldsAtSchoolLevel = (
      ['timezone', 'locale', 'calendarSystem', 'academicCalendarType'] as const
    ).filter((k) => (updateDto as any)[k] !== undefined);
    if (regionalFieldsAtSchoolLevel.length > 0) {
      this.logger.warn(
        `DEPRECATED school-level regional fields written: ${regionalFieldsAtSchoolLevel.join(', ')}. ` +
          `These fields are moving to tenant-level only (Project Midnight Lockin decision #3, P1). ` +
          `schoolId=${schoolId} tenantId=${context.tenantId} actor=${context.userId}`,
      );
    }

    // Check for locked-during-active-year fields (without emergency override)
    const forceOverride = (updateDto as any).forceOverride === true;
    const overrideReason = (updateDto as any).overrideReason as string | undefined;
    if (locked.length > 0) {
      // Query for active academic years
      const academicYears = await this.dynamoDBClient.query(
        client,
        context.tenantId,
        `SCHOOL#${schoolId}#YEAR#`,
        'entityType = :et AND #s = :active',
        { ':et': 'ACADEMIC_YEAR', ':active': 'active' },
        { '#s': 'status' },
        1,
      );
      const hasActiveYear = academicYears.items.length > 0;

      if (hasActiveYear) {
        if (!forceOverride) {
          throw new BadRequestException(getLockedFieldsMessage(locked));
        }
        if (!overrideReason) {
          throw new BadRequestException('Override reason is required when force-overriding locked fields');
        }
        this.logger.warn(`FORCE OVERRIDE: User ${context.userId} overriding locked fields [${locked.join(', ')}] on school ${schoolId}. Reason: ${overrideReason}`);
      }
    }

    // Cross-validate schoolType vs gradeRange (use updated values or fall back to existing)
    const effectiveSchoolType = updateDto.schoolType || school.schoolType;
    const effectiveGradeRange = updateDto.gradeRange || school.gradeRange;
    if (effectiveSchoolType && effectiveGradeRange) {
      const rangeError = validateSchoolTypeGradeRange(effectiveSchoolType, effectiveGradeRange);
      if (rangeError) {
        throw new BadRequestException(rangeError);
      }
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

    // NOTE: status is NOT settable via updateSchool — use transitionStatus() instead

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

    // Write audit log entry (non-blocking)
    const fieldChanges = computeFieldChanges(school as Record<string, any>, updateDto as Record<string, any>);
    if (fieldChanges.length > 0) {
      const auditEntry = createAuditLogEntity(context.tenantId, schoolId, uuid(), {
        targetEntity: 'SCHOOL',
        targetEntityId: schoolId,
        action: 'update',
        changes: fieldChanges,
        changedBy: context.userId,
        changedByName: context.username,
        changedAt: new Date().toISOString(),
        reason: overrideReason,
        severity: forceOverride ? 'high' : 'normal',
      });
      this.dynamoDBClient.putItem(client, auditEntry)
        .catch(err => this.logger.error('Failed to write audit log', err));
    }

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
   * Transition school status with validation and preconditions
   */
  async transitionStatus(
    schoolId: string,
    newStatus: string,
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

    const VALID_TRANSITIONS: Record<string, string[]> = {
      setup: ['active'],
      active: ['suspended', 'inactive', 'closed'],
      suspended: ['active'],
      inactive: ['active'],
      closed: [],
    };

    const currentStatus = school.status || 'setup';
    const allowed = VALID_TRANSITIONS[currentStatus] || [];

    if (!allowed.includes(newStatus)) {
      throw new BadRequestException(
        `Cannot transition from '${currentStatus}' to '${newStatus}'. Allowed: ${allowed.join(', ') || 'none'}`
      );
    }

    // Preconditions for specific transitions
    if (currentStatus === 'setup' && newStatus === 'active') {
      // setup→active: requires at least one academic year
      const years = await this.dynamoDBClient.query(
        client,
        context.tenantId,
        `SCHOOL#${schoolId}#YEAR#`,
        'entityType = :et',
        { ':et': 'ACADEMIC_YEAR' },
        undefined,
        1,
      );
      if (years.items.length === 0) {
        throw new BadRequestException(
          'Cannot activate school: at least one academic year must be created first'
        );
      }
    }

    if (newStatus === 'closed') {
      // active→closed: requires no active academic year
      const activeYears = await this.dynamoDBClient.query(
        client,
        context.tenantId,
        `SCHOOL#${schoolId}#YEAR#`,
        'entityType = :et AND #s = :active',
        { ':et': 'ACADEMIC_YEAR', ':active': 'active' },
        { '#s': 'status' },
        1,
      );
      if (activeYears.items.length > 0) {
        throw new BadRequestException(
          'Cannot close school: complete or archive all active academic years first'
        );
      }
    }

    const now = new Date().toISOString();
    const updatedSchool = await this.dynamoDBClient.updateItem<School>(
      client,
      context.tenantId,
      EntityKeyBuilder.school(schoolId),
      'SET #status = :status, #updatedAt = :updatedAt, #updatedBy = :updatedBy, #version = #version + :inc',
      {
        ':status': newStatus,
        ':updatedAt': now,
        ':updatedBy': context.userId,
        ':inc': 1,
      },
      undefined,
      { '#status': 'status', '#updatedAt': 'updatedAt', '#updatedBy': 'updatedBy', '#version': 'version' }
    );

    this.logger.log(`School ${schoolId} status: ${currentStatus} → ${newStatus}`);

    // Write audit log for status transition (non-blocking)
    const auditEntry = createAuditLogEntity(context.tenantId, schoolId, uuid(), {
      targetEntity: 'SCHOOL',
      targetEntityId: schoolId,
      action: 'status_change',
      changes: [{ field: 'status', oldValue: currentStatus, newValue: newStatus }],
      changedBy: context.userId,
      changedByName: context.username,
      changedAt: now,
    });
    this.dynamoDBClient.putItem(client, auditEntry)
      .catch(err => this.logger.error('Failed to write status audit log', err));

    this.eventsService.publishSchoolUpdated(
      context.tenantId,
      schoolId,
      ['status']
    ).catch(err => this.logger.error('Failed to publish SchoolUpdated event', err));

    return this.toSchoolResponse(updatedSchool);
  }

  /**
   * Get audit log for a school
   */
  async getAuditLog(
    schoolId: string,
    context: RequestContext,
    limit: number = 50,
    startDate?: string,
    endDate?: string,
    action?: string,
  ): Promise<PaginatedResult<AuditLogEntry>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Verify school exists
    const school = await this.dynamoDBClient.getItem<School>(
      client,
      context.tenantId,
      EntityKeyBuilder.school(schoolId)
    );
    if (!school) {
      throw new NotFoundException('School not found');
    }

    // Build filter expression
    const filterParts = ['entityType = :et'];
    const exprValues: Record<string, any> = { ':et': 'AUDIT_LOG' };

    if (action) {
      filterParts.push('#action = :action');
      exprValues[':action'] = action;
    }
    if (startDate) {
      filterParts.push('changedAt >= :startDate');
      exprValues[':startDate'] = startDate;
    }
    if (endDate) {
      filterParts.push('changedAt <= :endDate');
      exprValues[':endDate'] = endDate;
    }

    const names: Record<string, string> = {};
    if (action) {
      names['#action'] = 'action';
    }

    const result = await this.dynamoDBClient.query<AuditLogEntry>(
      client,
      context.tenantId,
      `SCHOOL#${schoolId}#AUDIT#`,
      filterParts.join(' AND '),
      exprValues,
      Object.keys(names).length > 0 ? names : undefined,
      limit,
    );

    return {
      items: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
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

    const currentStatus = school.status || 'setup';

    if (currentStatus === 'inactive' || currentStatus === 'closed') {
      throw new BadRequestException(`School is already ${currentStatus} and cannot be deleted`);
    }

    if (currentStatus === 'setup') {
      // Hard-delete: permanently remove school entity and its config
      await this.dynamoDBClient.deleteItem(
        client,
        context.tenantId,
        EntityKeyBuilder.school(schoolId)
      );
      // Also remove school config if it exists
      await this.dynamoDBClient.deleteItem(
        client,
        context.tenantId,
        EntityKeyBuilder.schoolConfig(schoolId)
      ).catch(() => { /* config may not exist yet */ });

      this.logger.log(`School hard-deleted (setup): ${schoolId}`);

      this.eventsService.publishSchoolUpdated(
        context.tenantId,
        schoolId,
        ['deleted']
      ).catch(err => this.logger.error('Failed to publish SchoolDeleted event', err));
    } else {
      // Soft-delete: transition active/suspended → inactive
      await this.dynamoDBClient.updateItem(
        client,
        context.tenantId,
        EntityKeyBuilder.school(schoolId),
        'SET #status = :status, #updatedAt = :updatedAt, #updatedBy = :updatedBy, #version = #version + :inc',
        {
          ':status': 'inactive',
          ':updatedAt': new Date().toISOString(),
          ':updatedBy': context.userId,
          ':inc': 1,
          ':currentVersion': school.version || 0,
        },
        '#version = :currentVersion',
        { '#status': 'status', '#updatedAt': 'updatedAt', '#updatedBy': 'updatedBy', '#version': 'version' }
      );

      this.logger.log(`School soft-deleted (${currentStatus} → inactive): ${schoolId}`);

      this.eventsService.publishSchoolUpdated(
        context.tenantId,
        schoolId,
        ['status', 'deleted']
      ).catch(err => this.logger.error('Failed to publish SchoolUpdated event', err));
    }
  }

  private toSchoolResponse(school: School): SchoolResponseDto {
    return {
      schoolId: school.schoolId,
      schoolCode: school.schoolCode,
      emisSchoolCode: school.emisSchoolCode,
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
      calendarSystem: school.calendarSystem || 'gregorian',
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

    // Field governance: config fields locked during active academic year
    const CONFIG_LOCKED_FIELDS = ['gradingScale', 'schoolDays', 'startTime', 'endTime', 'periodDuration', 'academicCalendarType'];
    const lockedFieldsInUpdate = CONFIG_LOCKED_FIELDS.filter(f => (updateDto as any)[f] !== undefined);
    const forceOverride = (updateDto as any).forceOverride === true;
    const overrideReason = (updateDto as any).overrideReason as string | undefined;

    if (lockedFieldsInUpdate.length > 0) {
      const academicYears = await this.dynamoDBClient.query(
        client,
        context.tenantId,
        `SCHOOL#${schoolId}#YEAR#`,
        'entityType = :et AND #s = :active',
        { ':et': 'ACADEMIC_YEAR', ':active': 'active' },
        { '#s': 'status' },
        1,
      );
      const hasActiveYear = academicYears.items.length > 0;

      if (hasActiveYear) {
        if (!forceOverride) {
          throw new BadRequestException(getLockedFieldsMessage(lockedFieldsInUpdate));
        }
        if (!overrideReason) {
          throw new BadRequestException('Override reason is required when force-overriding locked fields');
        }
        this.logger.warn(`FORCE OVERRIDE CONFIG: User ${context.userId} overriding locked config fields [${lockedFieldsInUpdate.join(', ')}] on school ${schoolId}. Reason: ${overrideReason}`);
      }
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

    // Write audit log entry for config changes (non-blocking)
    const configChanges = computeFieldChanges(config as Record<string, any>, updateDto as Record<string, any>);
    if (configChanges.length > 0) {
      const auditEntry = createAuditLogEntity(context.tenantId, schoolId, uuid(), {
        targetEntity: 'CONFIG',
        targetEntityId: schoolId,
        action: 'update',
        changes: configChanges,
        changedBy: context.userId,
        changedByName: context.username,
        changedAt: new Date().toISOString(),
        reason: overrideReason,
        severity: forceOverride ? 'high' : 'normal',
      });
      this.dynamoDBClient.putItem(client, auditEntry)
        .catch(err => this.logger.error('Failed to write config audit log', err));
    }

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

