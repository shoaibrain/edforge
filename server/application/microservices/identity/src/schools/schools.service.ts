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
import { AuditedWriteService } from '../common/services/audited-write.service';
import { 
  School, 
  createSchoolEntity,
} from '../common/entities/school.entity';
import {
  Department,
  SchoolConfiguration,
  createDepartmentEntity,
  createSchoolConfigEntity,
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
import {
  getActivationRequirements,
  type ActivationRequirementKey,
  type ActivationRequirementCheck,
  type ActivationRequirementsResponse,
} from '@aibrains/shared-types';
import { AuditLogEntry, createAuditLogEntity, computeFieldChanges } from '../common/entities/audit.entity';

/**
 * Pure entity→DTO mapper. Extracted as a module-level function (rather than a
 * private method) so the round-trip contract can be regression-tested without
 * standing up the full SchoolsService DI graph. Mirrors the pattern of
 * `staffEntityToDto` (Sprint 4 S4.1) and `studentEntityToDto` (post-2026-04-24
 * mapper hotfix) — every field declared on the `School` entity that should
 * surface via `SchoolResponseDto` MUST be copied here. Forgetting a field
 * silently strips it from every response body.
 *
 * Sprint A.22 extracted this from the prior `SchoolsService.toSchoolResponse`
 * private method; behavior unchanged.
 */
export function schoolEntityToDto(school: School): SchoolResponseDto {
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
    // S0.2: academicCalendarType removed from School response — the AY-level
    // `AcademicYear.calendarType` is the authoritative source. Legacy rows in
    // DDB may still carry the field; we simply stop surfacing it.
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

@Injectable()
export class SchoolsService {
  private readonly logger = new Logger(SchoolsService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: IdentityEventsService,
    private readonly auditedWrite: AuditedWriteService,
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

    // Sprint C0.b.3 — `shortName` uniqueness within tenant scope.
    //
    // `shortName` shows up in operator-facing UI as a compact label (header
    // badges, dropdowns, breadcrumbs). Two schools with the same shortName
    // are operationally unworkable — operators can't tell which row they're
    // looking at. Match the schoolCode pattern: case-insensitive compare
    // against the existing tenant-scoped school list.
    //
    // Note: this shares the schoolCode check's TOCTOU race (two concurrent
    // creates with the same shortName could both pass). Race tolerance is
    // acceptable for V1 — operator-driven school creation is sequential per
    // tenant. A future hardening pass (sentinel row + TransactWrite) would
    // close it; tracked as deferrable cleanup once we have a second pilot.
    if (createDto.shortName) {
      const duplicateShortName = existingSchools.items.find(
        s => s.shortName?.toUpperCase() === createDto.shortName?.toUpperCase()
      );
      if (duplicateShortName) {
        this.logger.warn(
          `School create rejected — duplicate shortName. ` +
            `tenantId=${context.tenantId} shortName="${createDto.shortName}" ` +
            `conflictSchoolId=${duplicateShortName.schoolId} actor=${context.userId}`,
        );
        throw new ConflictException({
          message: 'A school with this short name already exists in this tenant',
          errorCode: 'SHORT_NAME_DUPLICATE',
          details: {
            field: 'shortName',
            value: createDto.shortName,
            reason:
              'shortName must be unique per tenant — it appears in UI ' +
              'badges and dropdowns where two collisions would be ' +
              'indistinguishable. Choose a different short name.',
          },
        });
      }
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

    return schoolEntityToDto(school);
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

    return schoolEntityToDto(school);
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
      items: returnSchools.map(s => schoolEntityToDto(s)),
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
      return schoolEntityToDto(school);
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

    return schoolEntityToDto(updatedSchool);
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

    // S0.6: archetype-aware activation gate. The prior implementation
    // accepted any school with ≥1 AcademicYear, regardless of whether
    // that year was active, had terms, had a bell schedule, or had a
    // calendar generated. For PABSON schools the realistic gate is all
    // four. The set is data-driven (packages/shared-types/src/archetype/
    // activation-requirements.ts) so adding a new archetype is a config
    // edit, not a code branch — Plan §J invariant #8.
    if (currentStatus === 'setup' && newStatus === 'active') {
      const evaluation = await this.evaluateActivationRequirements(schoolId, context);
      if (!evaluation.canActivate) {
        const missing = evaluation.requirements.filter(r => !r.met);
        throw new BadRequestException({
          message:
            `Cannot activate school: ${missing.length} required setup ` +
            `${missing.length === 1 ? 'task is' : 'tasks are'} incomplete.`,
          errorCode: 'ACTIVATION_REQUIREMENTS_NOT_MET',
          details: {
            archetype: evaluation.archetype,
            missing: missing.map(r => ({
              key: r.key,
              label: r.label,
              current: r.current,
              required: r.required,
            })),
          },
        });
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

    // S0.8: route audit emission through AuditedWriteService for uniform
    // shape + error handling. Helper is fire-and-forget on errors — see
    // the design note at common/services/audited-write.service.ts.
    await this.auditedWrite.emit(context, {
      schoolId,
      targetEntity: 'SCHOOL',
      targetEntityId: schoolId,
      action: 'status_change',
      changes: [{ field: 'status', oldValue: currentStatus, newValue: newStatus }],
    });

    this.eventsService.publishSchoolUpdated(
      context.tenantId,
      schoolId,
      ['status']
    ).catch(err => this.logger.error('Failed to publish SchoolUpdated event', err));

    return schoolEntityToDto(updatedSchool);
  }

  /**
   * S0.6 — Evaluate the archetype-aware activation requirements for a
   * school. Returns one check result per requirement (with current vs
   * required counts) plus a `canActivate` rollup. Used by both the
   * activation gate in `transitionStatus` and by
   * `GET /:schoolId/activation-requirements` so the frontend setup
   * checklist renders the same truth the backend would enforce.
   */
  async evaluateActivationRequirements(
    schoolId: string,
    context: RequestContext,
  ): Promise<ActivationRequirementsResponse> {
    const client = await this.dynamoDBClient.getClient(
      context.tenantId,
      context.jwtToken,
    );

    // Guard against the not-our-school case before any further work.
    const school = await this.dynamoDBClient.getItem<School>(
      client,
      context.tenantId,
      EntityKeyBuilder.school(schoolId),
    );
    if (!school) {
      throw new NotFoundException('School not found');
    }

    // Resolve the tenant's archetype. Unknown / missing → GENERIC, per
    // the locale defaults table. Fail-loud here would block legitimate
    // operations on a Cognito-claim typo, which is strictly worse than
    // under-gating on activation.
    const tenantRow = await this.dynamoDBClient.getItem<{ archetype?: string }>(
      client,
      context.tenantId,
      EntityKeyBuilder.tenantMetadata(),
    );
    const archetypeStr = tenantRow?.archetype?.toUpperCase() ?? 'GENERIC';
    const config = getActivationRequirements(archetypeStr);

    // Check each requirement.
    const checks: ActivationRequirementCheck[] = [];
    for (const req of config.requirements) {
      const current = await this.countRequirementResource(req.key, schoolId, context);
      checks.push({
        key: req.key,
        label: req.label,
        required: req.minCount,
        current,
        met: current >= req.minCount,
      });
    }

    return {
      archetype: archetypeStr,
      requirements: checks,
      canActivate: checks.every(c => c.met),
    };
  }

  /**
   * Count the resource backing an activation-requirement key. Each
   * key has a dedicated DDB query — the prefixes here must match the
   * entity-key contracts declared on each entity file. Keep in lockstep
   * with `ActivationRequirementKey` in shared-types.
   *
   * Returns the raw count; the caller computes met/not-met against the
   * archetype's `minCount`.
   */
  private async countRequirementResource(
    key: ActivationRequirementKey,
    schoolId: string,
    context: RequestContext,
  ): Promise<number> {
    const client = await this.dynamoDBClient.getClient(
      context.tenantId,
      context.jwtToken,
    );
    // Cap reads at 100 — every requirement's threshold is well below that
    // (largest is PABSON terms = 4), so once we see 100 items the check
    // is trivially satisfied; pagination is unnecessary overhead.
    const LIMIT = 100;

    switch (key) {
      case 'academic_year_active': {
        // SK pattern: SCHOOL#{schoolId}#YEAR#{yearId}. Filter on
        // entityType + status to count just the active AYs.
        const result = await this.dynamoDBClient.query(
          client,
          context.tenantId,
          `SCHOOL#${schoolId}#YEAR#`,
          'entityType = :et AND #s = :st',
          { ':et': 'ACADEMIC_YEAR', ':st': 'active' },
          { '#s': 'status' },
          LIMIT,
        );
        return result.items.length;
      }
      case 'grading_periods': {
        // GradingPeriod SK: SCHOOL#{schoolId}#YEAR#{yearId}#TERM#{termId}.
        // The same `SCHOOL#{schoolId}#YEAR#` prefix also catches the
        // parent AcademicYear rows, so we filter by entityType.
        const result = await this.dynamoDBClient.query(
          client,
          context.tenantId,
          `SCHOOL#${schoolId}#YEAR#`,
          'entityType = :et',
          { ':et': 'TERM' },
          undefined,
          LIMIT,
        );
        return result.items.length;
      }
      case 'bell_schedule': {
        // BellSchedule SK: SCHOOL#{schoolId}#BELL#{id}. No entityType
        // filter needed — the prefix is unique to BellSchedule rows.
        const result = await this.dynamoDBClient.query(
          client,
          context.tenantId,
          `SCHOOL#${schoolId}#BELL#`,
          undefined,
          undefined,
          undefined,
          LIMIT,
        );
        return result.items.length;
      }
      case 'calendar_generated': {
        // CalendarDate SK: SCHOOL#{schoolId}#DATE#{date}. Any CalendarDate
        // for this school proves generate-calendar has been run at least
        // once. A tighter "for the current AY specifically" check is a
        // future refinement once `current AY` semantics are airtight (S0.1
        // restored strict isCurrent honoring).
        const result = await this.dynamoDBClient.query(
          client,
          context.tenantId,
          `SCHOOL#${schoolId}#DATE#`,
          undefined,
          undefined,
          undefined,
          1, // we only need to know if >=1 exists; no need to count further
        );
        return result.items.length;
      }
    }
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

  // toSchoolResponse private method removed in Sprint A.22 — replaced by the
  // module-level pure function `schoolEntityToDto` (see top of this file).

  // ============================================
  // Configuration Methods
  // ============================================

  /**
   * Get school configuration.
   *
   * Returns 404 when no config row exists. Previously this would
   * lazy-create a row from DEFAULT_SCHOOL_CONFIG (US-shape: en-US,
   * America/New_York, A-F grading, Mon-Fri week), which silently produced
   * orphan US-defaults rows for any caller hitting the endpoint with a
   * non-existent schoolId — e.g. stale URLs to deleted schools, hand-
   * crafted requests, or a frontend page that loads before its parent
   * school resource resolves. The grade-level-audit found 2 such orphan
   * rows in dev-pabson-primary alone.
   *
   * The config row is ALWAYS created eagerly by `createSchool` with the
   * country-merged defaults (see line ~298). So a real school always has
   * a real config. A 404 here means the schoolId doesn't correspond to
   * an existing school — the caller should not silently get sensible-
   * looking defaults that mask the missing parent resource.
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

    if (!config) {
      throw new NotFoundException(
        `School configuration not found for schoolId=${schoolId}. ` +
          `Configurations are created eagerly with the school via POST /api/schools; ` +
          `a 404 here indicates the school does not exist in this tenant.`,
      );
    }

    // S0.4: also fetch the School entity to surface calendarSystem on the
    // configuration response. Two reads in the same tenant partition is
    // negligible cost vs. forcing every UI consumer to make two requests.
    const school = await this.dynamoDBClient.getItem<School>(
      client,
      context.tenantId,
      EntityKeyBuilder.school(schoolId),
    );

    return this.toConfigResponse(config, school);
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

    // The config row is created eagerly by createSchool with country-merged
    // defaults. If we can't read it here, either (a) the school doesn't
    // exist or (b) the schoolId is wrong. Either case is operator error,
    // not a recoverable "let me lazy-create defaults" situation — the old
    // lazy-create silently produced US-defaults orphan rows.
    const config = await this.dynamoDBClient.getItem<SchoolConfiguration>(
      client,
      context.tenantId,
      EntityKeyBuilder.schoolConfig(schoolId)
    );

    if (!config) {
      throw new NotFoundException(
        `School configuration not found for schoolId=${schoolId}. ` +
          `Cannot update a configuration that does not exist.`,
      );
    }

    // S0.4: fetch the School row once for calendarSystem so both response
    // paths in this method (no-op fast-path and post-update) surface it.
    const school = await this.dynamoDBClient.getItem<School>(
      client,
      context.tenantId,
      EntityKeyBuilder.school(schoolId),
    );

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
      return this.toConfigResponse(config!, school);
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

    // S0.8: route audit emission through AuditedWriteService. Only emit
    // when something actually changed — a no-op update (all fields equal)
    // should not produce an audit row.
    const configChanges = computeFieldChanges(config as Record<string, any>, updateDto as Record<string, any>);
    if (configChanges.length > 0) {
      await this.auditedWrite.emit(context, {
        schoolId,
        targetEntity: 'CONFIG',
        targetEntityId: schoolId,
        action: 'update',
        changes: configChanges,
        reason: overrideReason,
        severity: forceOverride ? 'high' : 'normal',
      });
    }

    return this.toConfigResponse(updatedConfig, school);
  }

  // `createDefaultConfig` was removed as part of grade-level-fix/T4 / F-CONFIG-1a.
  // It was the source of orphan US-defaults SchoolConfiguration rows: when
  // `getConfiguration` or `updateConfiguration` was called for a schoolId
  // with no config row, the method silently wrote DEFAULT_SCHOOL_CONFIG
  // (US-shape — en-US / America/New_York / A-F grading / Mon-Fri week)
  // without consulting the school's country or the tenant's archetype.
  // SchoolConfiguration rows are now created ONLY by `createSchool` with
  // country-merged defaults (see `getDefaultConfigForCountry` at ~line 144).
  // Any caller hitting an unknown schoolId gets a 404 — no orphan side-effect.

  private toConfigResponse(
    config: SchoolConfiguration,
    school?: Pick<School, 'calendarSystem'> | null,
  ): SchoolConfigResponseDto {
    return {
      schoolId: config.schoolId,
      timezone: config.timezone,
      locale: config.locale,
      // S0.4: surface the school's calendarSystem on the configuration
      // response. Lives on the School entity, not on SchoolConfiguration —
      // we read-through so frontend DateInput consumers can route to the
      // right picker from a single config GET.
      calendarSystem: school?.calendarSystem,
      dateFormat: config.dateFormat,
      timeFormat: config.timeFormat,
      // S0.2: academicCalendarType removed from configuration response —
      // AcademicYear.calendarType is authoritative. Legacy rows in DDB
      // may still carry the field; we simply stop surfacing it.
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

