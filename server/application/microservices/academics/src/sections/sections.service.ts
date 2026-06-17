/**
 * Sections Service - Course section management
 *
 * Manages sections (class instances) of courses. A section represents
 * a specific offering with a teacher, room, and enrollment cap.
 *
 * ARCHITECTURE: Uses application-level tenant isolation.
 * All queries use tenantId from JWT context as partition key.
 *
 * Ed-Fi Alignment:
 * - CourseSection -> Ed-Fi Section entity
 * - sectionNumber -> Ed-Fi sectionIdentifier
 * - primaryTeacherId -> Ed-Fi StaffSectionAssociation
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
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import {
  Course,
  CourseSection,
  createSectionEntity,
  HOMEROOM_SECTION_COURSE_KEY,
} from '../common/entities/course.entity';
import {
  EntityKeyBuilder,
  GSIKeyBuilder,
  RequestContext,
  PaginatedResult,
} from '../common/entities/base.entity';
import {
  CreateSectionDto,
  UpdateSectionDto,
  SectionResponseDto,
  validateScheduleSlot,
} from '@aibrains/shared-types';
import type { SchoolHoursConfig, SectionType } from '@aibrains/shared-types';
import { sectionEntityToDto } from '../common/mappers/section.mapper';
import { DataScopeService } from '../common/services/data-scope.service';

@Injectable()
export class SectionsService {
  private readonly logger = new Logger(SectionsService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: AcademicsEventsService,
    private readonly identityClient: IdentityClientService,
    private readonly dataScopeService: DataScopeService,
  ) {}

  /**
   * Create a new section for a course
   *
   * Validates:
   * - Course exists and is active
   * - School exists in Identity service
   * - Primary teacher exists in Identity service
   * - Section number is unique within the course
   */
  async createSection(
    dto: CreateSectionDto,
    context: RequestContext,
  ): Promise<SectionResponseDto> {
    this.logger.debug(`createSection: entry, schoolId=${dto.schoolId}, courseId=${dto.courseId}, sectionNumber=${dto.sectionNumber}, primaryTeacherId=${dto.primaryTeacherId}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Instructional sections require a courseId (the Zod refine enforces it;
    // re-assert so dto.courseId narrows to string for the lookup + key building
    // below). Homeroom sections are created via the S3.T4 designate path.
    if (!dto.courseId) {
      throw new BadRequestException('courseId is required for instructional sections');
    }

    // Validate course exists and is active
    const course = await this.dynamoDBClient.getItem<Course>(
      client,
      context.tenantId,
      EntityKeyBuilder.course(dto.schoolId, dto.courseId),
    );
    if (!course) {
      throw new NotFoundException(`Course ${dto.courseId} not found`);
    }
    if (!course.isActive) {
      throw new BadRequestException(`Course ${dto.courseId} is inactive and cannot have new sections`);
    }

    // Parallel Identity validation — Group 1: school, academic year, primary teacher
    const identityCtx = { userId: context.userId, jwtToken: context.jwtToken, tenantId: context.tenantId };

    const [schoolExists, years, teacher] = await Promise.all([
      this.identityClient.validateSchoolExists(dto.schoolId, identityCtx),
      dto.academicYearId
        ? this.identityClient.getAcademicYears(dto.schoolId, identityCtx)
        : Promise.resolve(null),
      this.identityClient.getStaff(dto.primaryTeacherId, identityCtx).catch(() => null),
    ]);

    if (!schoolExists) {
      throw new NotFoundException(`School ${dto.schoolId} not found`);
    }
    if (!teacher) {
      throw new NotFoundException(`Teacher ${dto.primaryTeacherId} not found`);
    }
    if (dto.academicYearId && years) {
      const year = years.find(y => y.yearId === dto.academicYearId);
      if (!year) {
        throw new BadRequestException(`Academic year ${dto.academicYearId} not found for school ${dto.schoolId}`);
      }
      if (year.status !== 'active' && year.status !== 'planning') {
        throw new BadRequestException(`Academic year ${dto.academicYearId} is ${year.status} and cannot accept new sections`);
      }
    }

    // Parallel Identity lookups — Group 2: optional fields + co-teachers
    const conditionalPromises: Promise<any>[] = [];

    // Class period (optional)
    const periodPromiseIdx = dto.classPeriodId ? conditionalPromises.push(
      this.identityClient.getClassPeriod(dto.schoolId, dto.classPeriodId, identityCtx).catch(() => null),
    ) - 1 : -1;

    // Location (optional)
    const locationPromiseIdx = dto.locationId ? conditionalPromises.push(
      this.identityClient.getLocation(dto.schoolId, dto.locationId, identityCtx).catch(() => null),
    ) - 1 : -1;

    // Co-teachers (optional)
    const coTeacherStartIdx = conditionalPromises.length;
    if (dto.coTeacherIds && dto.coTeacherIds.length > 0) {
      for (const coTeacherId of dto.coTeacherIds) {
        conditionalPromises.push(
          this.identityClient.validateStaffExists(coTeacherId, identityCtx),
        );
      }
    }

    const conditionalResults = conditionalPromises.length > 0
      ? await Promise.all(conditionalPromises)
      : [];

    // Extract results
    let periodName: string | undefined;
    let resolvedPeriod: any = null;
    if (periodPromiseIdx >= 0) {
      resolvedPeriod = conditionalResults[periodPromiseIdx];
      periodName = resolvedPeriod?.classPeriodName;
      if (!resolvedPeriod) {
        this.logger.warn(`Could not resolve class period ${dto.classPeriodId}, storing without name`);
      }
    }

    let locationRoomNumber: string | undefined;
    if (locationPromiseIdx >= 0) {
      const location = conditionalResults[locationPromiseIdx];
      locationRoomNumber = location?.roomNumber;
      if (!location) {
        this.logger.warn(`Could not resolve location ${dto.locationId}, storing without room number`);
      }
    }

    if (dto.coTeacherIds && dto.coTeacherIds.length > 0) {
      for (let i = 0; i < dto.coTeacherIds.length; i++) {
        if (!conditionalResults[coTeacherStartIdx + i]) {
          throw new NotFoundException(`Co-teacher ${dto.coTeacherIds[i]} not found`);
        }
      }
    }

    // Validate class period against school hours (Sprint 7)
    if (resolvedPeriod?.startTime && resolvedPeriod?.endTime) {
      const schoolConfig = await this.identityClient.getSchoolConfiguration(dto.schoolId, identityCtx);
      if (schoolConfig?.startTime && schoolConfig?.endTime) {
        const hoursConfig: SchoolHoursConfig = {
          startTime: schoolConfig.startTime,
          endTime: schoolConfig.endTime,
          schoolDays: schoolConfig.schoolDays || [1, 2, 3, 4, 5],
          periodDuration: schoolConfig.periodDuration || 45,
        };
        const slotError = validateScheduleSlot({
          startTime: resolvedPeriod.startTime,
          endTime: resolvedPeriod.endTime,
          dayOfWeek: 1, // Validate time range only; day enforcement is at scheduling time
          schoolConfig: hoursConfig,
        });
        if (slotError) {
          throw new BadRequestException(`Section schedule falls outside school hours: ${slotError}`);
        }
      }
    }

    // Check for duplicate section number within the course
    await this.assertSectionNumberUnique(
      client, context.tenantId, dto.schoolId, dto.courseId, dto.sectionNumber,
    );

    const now = new Date().toISOString();
    const sectionId = uuid();
    const primaryTeacherName = `${teacher.firstName} ${teacher.lastSurname}`;

    const section = createSectionEntity(
      context.tenantId,
      sectionId,
      dto.schoolId,
      {
        courseId: dto.courseId,
        sectionType: dto.sectionType,
        academicYearId: dto.academicYearId,
        termId: dto.termId,
        courseCode: course.courseCode,
        courseName: course.courseName,
        subjectArea: course.subjectArea,
        sectionNumber: dto.sectionNumber,
        sectionName: dto.sectionName,
        primaryTeacherId: dto.primaryTeacherId,
        primaryTeacherName,
        coTeacherIds: dto.coTeacherIds,
        roomId: dto.roomId,
        locationId: dto.locationId,
        classPeriodId: dto.classPeriodId,
        periodName,
        locationRoomNumber,
        courseOfferingId: dto.courseOfferingId,
        maxEnrollment: dto.maxEnrollment,
        currentEnrollment: 0,
        isActive: true,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      },
    );

    await this.dynamoDBClient.putItem(client, section);
    this.logger.debug(`createSection: section persisted, sectionId=${sectionId}, courseId=${dto.courseId}, schoolId=${dto.schoolId}`);

    this.logger.log(
      `Section created: ${course.courseCode}-${dto.sectionNumber} (${sectionId})`,
    );

    this.eventsService.publishSectionCreated(
      context.tenantId,
      sectionId,
      dto.courseId,
      dto.schoolId,
      dto.sectionNumber,
    ).catch(err => this.logger.error('Failed to publish SectionCreated event', err));

    return sectionEntityToDto(section);
  }

  /**
   * Get a section by ID
   */
  async getSection(
    sectionId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<SectionResponseDto> {
    this.logger.debug(`getSection: entry, sectionId=${sectionId}, schoolId=${schoolId}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const section = await this.dynamoDBClient.getItem<CourseSection>(
      client,
      context.tenantId,
      EntityKeyBuilder.section(schoolId, sectionId),
    );

    if (!section) {
      this.logger.debug(`getSection: section not found, sectionId=${sectionId}`);
      throw new NotFoundException(`Section ${sectionId} not found`);
    }

    this.logger.debug(`getSection: found, sectionId=${sectionId}, courseId=${section.courseId}`);
    return sectionEntityToDto(section);
  }

  /**
   * List sections for a school, optionally filtered by courseId
   */
  async listSections(
    schoolId: string,
    context: RequestContext,
    limit: number = 50,
    cursor?: string,
    filters?: {
      courseId?: string;
      sectionType?: SectionType;
      teacherId?: string;
      academicYearId?: string;
      isActive?: boolean;
    },
  ): Promise<PaginatedResult<SectionResponseDto>> {
    this.logger.debug(`listSections: entry, schoolId=${schoolId}, limit=${limit}, hasCursor=${!!cursor}, filters=${JSON.stringify(filters || {})}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    let exclusiveStartKey: Record<string, any> | undefined;
    if (cursor) {
      try {
        exclusiveStartKey = JSON.parse(Buffer.from(cursor, 'base64').toString());
      } catch {
        // Invalid cursor, ignore
      }
    }

    const filterParts: string[] = [];
    const expressionValues: Record<string, any> = {};

    if (filters?.courseId) {
      filterParts.push('courseId = :courseId');
      expressionValues[':courseId'] = filters.courseId;
    }

    if (filters?.sectionType === 'homeroom') {
      filterParts.push('sectionType = :sectionType');
      expressionValues[':sectionType'] = 'homeroom';
    } else if (filters?.sectionType === 'instructional') {
      // Legacy rows predate the discriminator and carry no sectionType
      // attribute; treat their absence as instructional.
      filterParts.push('(sectionType = :sectionType OR attribute_not_exists(sectionType))');
      expressionValues[':sectionType'] = 'instructional';
    }

    if (filters?.teacherId) {
      filterParts.push('primaryTeacherId = :teacherId');
      expressionValues[':teacherId'] = filters.teacherId;
    }

    if (filters?.academicYearId) {
      filterParts.push('academicYearId = :academicYearId');
      expressionValues[':academicYearId'] = filters.academicYearId;
    }

    if (filters?.isActive !== undefined) {
      filterParts.push('isActive = :isActive');
      expressionValues[':isActive'] = filters.isActive;
    }

    // When no schoolId but teacherId is provided, query base table across all schools
    if (!schoolId && filters?.teacherId) {
      const result = await this.dynamoDBClient.query<CourseSection>(
        client,
        context.tenantId,
        'SECTION#',
        filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
        Object.keys(expressionValues).length > 0 ? expressionValues : undefined,
        undefined,
        limit,
      );
      this.logger.debug(`listSections: cross-school teacher query, resultCount=${result.items.length}, hasMore=${result.hasMore}`);
      return {
        items: result.items.map(sectionEntityToDto),
        lastEvaluatedKey: result.lastEvaluatedKey,
        hasMore: result.hasMore,
      };
    }

    // Resolve data scope for row-level security (Teacher → their sections only)
    const scope = await this.dataScopeService.resolveScope(context.userId, schoolId, context);

    // Dense page: DDB applies Limit before the FilterExpression, so a plain
    // queryGSI over a partition full of soft-deleted section tombstones returns
    // a near-empty page + hasMore=true. queryGSIFilled drains until the page is
    // filled (or the partition is exhausted).
    const result = await this.dynamoDBClient.queryGSIFilled<CourseSection>(
      client,
      'GSI1',
      GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
      'SECTION#',
      'begins_with',
      filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
      Object.keys(expressionValues).length > 0 ? expressionValues : undefined,
      undefined,
      limit,
      true,
      exclusiveStartKey,
    );

    // Apply section scope filtering (Teacher → only their assigned sections)
    if (scope.type === 'section') {
      const scopedItems = result.items.filter(s => this.dataScopeService.isSectionInScope(scope, s.sectionId));
      this.logger.debug(`listSections: scope-filtered, totalFromQuery=${result.items.length}, afterScopeFilter=${scopedItems.length}, hasMore=${result.hasMore}`);
      return {
        items: scopedItems.map(sectionEntityToDto),
        lastEvaluatedKey: result.lastEvaluatedKey,
        hasMore: result.hasMore,
        // Teacher scope is a small, in-memory-filtered set; the dense drain
        // surfaces all of theirs, so the loaded count is the authoritative total.
        total: !cursor ? scopedItems.length : undefined,
      };
    }

    // Authoritative total — first page only (client reads pages[0].total).
    // A filtered Query counts after the Limit, so item count understates the
    // match count; a COUNT pass over the same key + filter is cheap and correct.
    let total: number | undefined;
    if (!cursor) {
      try {
        total = await this.dynamoDBClient.countGSI(
          client,
          'GSI1',
          GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
          'SECTION#',
          'begins_with',
          filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
          Object.keys(expressionValues).length > 0 ? expressionValues : undefined,
        );
      } catch (err) {
        this.logger.warn(
          `listSections: authoritative total unavailable for schoolId=${schoolId} — ${(err as Error).message}; continuing without total`,
        );
      }
    }

    this.logger.debug(`listSections: resultCount=${result.items.length}, hasMore=${result.hasMore}, total=${total ?? 'n/a'}`);
    return {
      items: result.items.map(sectionEntityToDto),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
      total,
    };
  }

  /**
   * Update a section
   */
  async updateSection(
    sectionId: string,
    schoolId: string,
    dto: UpdateSectionDto,
    context: RequestContext,
  ): Promise<SectionResponseDto> {
    this.logger.debug(`updateSection: entry, sectionId=${sectionId}, schoolId=${schoolId}, updatedFields=${Object.keys(dto).join(',')}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.section(schoolId, sectionId);

    const existing = await this.dynamoDBClient.getItem<CourseSection>(
      client,
      context.tenantId,
      entityKey,
    );

    if (!existing) {
      throw new NotFoundException(`Section ${sectionId} not found`);
    }

    // Resolve teacher name if teacher changed
    let newTeacherName: string | undefined;
    if (dto.primaryTeacherId && dto.primaryTeacherId !== existing.primaryTeacherId) {
      let teacher;
      try {
        teacher = await this.identityClient.getStaff(
          dto.primaryTeacherId,
          { userId: context.userId, jwtToken: context.jwtToken, tenantId: context.tenantId },
        );
      } catch {
        throw new NotFoundException(`Teacher ${dto.primaryTeacherId} not found`);
      }
      newTeacherName = `${teacher.firstName} ${teacher.lastSurname}`;
    }

    // Resolve period name when period changes
    let newPeriodName: string | undefined;
    if (dto.classPeriodId && dto.classPeriodId !== existing.classPeriodId) {
      try {
        const period = await this.identityClient.getClassPeriod(
          schoolId, dto.classPeriodId,
          { userId: context.userId, jwtToken: context.jwtToken, tenantId: context.tenantId },
        );
        if (period) {
          newPeriodName = period.classPeriodName;
        }
      } catch {
        this.logger.warn(`Could not resolve class period ${dto.classPeriodId}`);
      }
    }

    // Resolve location room number when location changes
    let newLocationRoomNumber: string | undefined;
    if (dto.locationId && dto.locationId !== existing.locationId) {
      try {
        const location = await this.identityClient.getLocation(
          schoolId, dto.locationId,
          { userId: context.userId, jwtToken: context.jwtToken, tenantId: context.tenantId },
        );
        if (location) {
          newLocationRoomNumber = location.roomNumber;
        }
      } catch {
        this.logger.warn(`Could not resolve location ${dto.locationId}`);
      }
    }

    // Check uniqueness if section number changed
    if (dto.sectionNumber && dto.sectionNumber !== existing.sectionNumber) {
      await this.assertSectionNumberUnique(
        client, context.tenantId, schoolId, existing.courseId, dto.sectionNumber,
      );
    }

    const now = new Date().toISOString();
    const updateParts: string[] = [
      'updatedAt = :updatedAt',
      'updatedBy = :updatedBy',
      'version = version + :inc',
    ];
    const expressionValues: Record<string, any> = {
      ':updatedAt': now,
      ':updatedBy': context.userId,
      ':inc': 1,
      ':currentVersion': existing.version,
    };

    const updateableFields: Array<{ key: keyof UpdateSectionDto; reserved?: boolean }> = [
      { key: 'sectionNumber' },
      { key: 'sectionName' },
      { key: 'primaryTeacherId' },
      { key: 'coTeacherIds' },
      { key: 'roomId' },
      { key: 'locationId' },
      { key: 'classPeriodId' },
      { key: 'courseOfferingId' },
      { key: 'maxEnrollment' },
      { key: 'termId' },
    ];

    for (const field of updateableFields) {
      const value = dto[field.key];
      if (value !== undefined) {
        const attrName = field.key as string;
        updateParts.push(`${attrName} = :${attrName}`);
        expressionValues[`:${attrName}`] = value;
      }
    }

    // Denormalize teacher name when teacher changes
    if (newTeacherName) {
      updateParts.push('primaryTeacherName = :primaryTeacherName');
      expressionValues[':primaryTeacherName'] = newTeacherName;
    }

    // Denormalize period name when period changes
    if (newPeriodName) {
      updateParts.push('periodName = :periodName');
      expressionValues[':periodName'] = newPeriodName;
    }

    // Denormalize location room number when location changes
    if (newLocationRoomNumber) {
      updateParts.push('locationRoomNumber = :locationRoomNumber');
      expressionValues[':locationRoomNumber'] = newLocationRoomNumber;
    }

    // Update GSI1SK if sectionNumber changed
    if (dto.sectionNumber) {
      updateParts.push('gsi1sk = :gsi1sk');
      expressionValues[':gsi1sk'] = `SECTION#${existing.courseId ?? HOMEROOM_SECTION_COURSE_KEY}#${dto.sectionNumber}`;
    }

    const updated = await this.dynamoDBClient.updateItem<CourseSection>(
      client,
      context.tenantId,
      entityKey,
      `SET ${updateParts.join(', ')}`,
      expressionValues,
      'version = :currentVersion',
    );

    this.logger.debug(`updateSection: persisted, sectionId=${sectionId}, newVersion=${(existing.version || 0) + 1}`);
    this.logger.log(`Section updated: ${sectionId}`);

    this.eventsService.publishSectionUpdated(
      context.tenantId,
      sectionId,
      existing.courseId,
      schoolId,
      Object.keys(dto),
    ).catch(err => this.logger.error('Failed to publish SectionUpdated event', err));

    return sectionEntityToDto(updated);
  }

  /**
   * Soft-delete a section (set isActive=false)
   */
  async deleteSection(
    sectionId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<void> {
    this.logger.debug(`deleteSection: entry, sectionId=${sectionId}, schoolId=${schoolId}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.section(schoolId, sectionId);

    const existing = await this.dynamoDBClient.getItem<CourseSection>(
      client,
      context.tenantId,
      entityKey,
    );

    if (!existing) {
      throw new NotFoundException(`Section ${sectionId} not found`);
    }

    if (existing.currentEnrollment > 0) {
      this.logger.debug(`deleteSection: blocked, sectionId=${sectionId}, currentEnrollment=${existing.currentEnrollment}`);
      throw new BadRequestException(
        `Cannot delete section with ${existing.currentEnrollment} enrolled students. Remove all enrollments first.`,
      );
    }

    const now = new Date().toISOString();

    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      entityKey,
      'SET isActive = :isActive, updatedAt = :updatedAt, updatedBy = :updatedBy, version = version + :inc',
      {
        ':isActive': false,
        ':updatedAt': now,
        ':updatedBy': context.userId,
        ':inc': 1,
      },
    );

    this.logger.debug(`deleteSection: soft-deleted, sectionId=${sectionId}, courseId=${existing.courseId}, schoolId=${schoolId}`);
    this.logger.log(`Section soft-deleted: ${sectionId}`);

    this.eventsService.publishSectionDeleted(
      context.tenantId,
      sectionId,
      existing.courseId,
      schoolId,
    ).catch(err => this.logger.error('Failed to publish SectionDeleted event', err));
  }

  /**
   * Assert section number is unique within a course
   */
  private async assertSectionNumberUnique(
    client: any,
    tenantId: string,
    schoolId: string,
    courseId: string,
    sectionNumber: string,
  ): Promise<void> {
    const result = await this.dynamoDBClient.queryGSI<CourseSection>(
      client,
      'GSI1',
      GSIKeyBuilder.schoolScope(tenantId, schoolId),
      `SECTION#${courseId}#${sectionNumber}`,
      'begins_with',
      undefined,
      undefined,
      undefined,
      1,
    );

    if (result.items.length > 0) {
      throw new ConflictException(
        `Section number '${sectionNumber}' already exists for this course`,
      );
    }
  }

  /**
   * Propagate teacher name changes to all sections assigned to a teacher.
   * Called when a staff member's name is updated in the Identity service.
   * Best-effort — failures are logged but don't block.
   */
  async propagateTeacherName(
    teacherId: string,
    teacherName: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<number> {
    this.logger.debug(`propagateTeacherName: entry, teacherId=${teacherId}, schoolId=${schoolId}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Query all sections in this school
    const result = await this.dynamoDBClient.queryGSI<CourseSection>(
      client,
      'GSI1',
      GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
      'SECTION#',
      'begins_with',
      'primaryTeacherId = :teacherId',
      { ':teacherId': teacherId },
      undefined,
      500,
    );

    this.logger.debug(`propagateTeacherName: sectionsFound=${result.items.length}, teacherId=${teacherId}, schoolId=${schoolId}`);

    const now = new Date().toISOString();
    let updated = 0;

    for (const section of result.items) {
      try {
        await this.dynamoDBClient.updateItem(
          client,
          context.tenantId,
          EntityKeyBuilder.section(schoolId, section.sectionId),
          'SET primaryTeacherName = :name, updatedAt = :updatedAt',
          {
            ':name': teacherName,
            ':updatedAt': now,
          },
        );
        updated++;
      } catch (err: any) {
        this.logger.error(`Failed to propagate teacher name to section ${section.sectionId}`, err);
      }
    }

    this.logger.debug(`propagateTeacherName: completed, updatedCount=${updated}, totalSections=${result.items.length}, teacherId=${teacherId}`);
    this.logger.log(`Propagated teacher name to ${updated} sections for teacher ${teacherId}`);
    return updated;
  }
}
