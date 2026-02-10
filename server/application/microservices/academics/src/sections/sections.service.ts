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
} from '@edforge/shared-types';
import { sectionEntityToDto } from '../common/mappers/section.mapper';

@Injectable()
export class SectionsService {
  private readonly logger = new Logger(SectionsService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: AcademicsEventsService,
    private readonly identityClient: IdentityClientService,
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
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

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

    // Validate school exists
    const schoolExists = await this.identityClient.validateSchoolExists(
      dto.schoolId,
      { userId: context.userId, jwtToken: context.jwtToken, tenantId: context.tenantId },
    );
    if (!schoolExists) {
      throw new NotFoundException(`School ${dto.schoolId} not found`);
    }

    // Validate academic year exists (SP4-5)
    if (dto.academicYearId) {
      const identityCtx = { userId: context.userId, jwtToken: context.jwtToken, tenantId: context.tenantId };
      const years = await this.identityClient.getAcademicYears(dto.schoolId, identityCtx);
      const year = years.find(y => y.yearId === dto.academicYearId);
      if (!year) {
        throw new BadRequestException(`Academic year ${dto.academicYearId} not found for school ${dto.schoolId}`);
      }
      if (year.status !== 'active' && year.status !== 'planning') {
        throw new BadRequestException(`Academic year ${dto.academicYearId} is ${year.status} and cannot accept new sections`);
      }
    }

    // Resolve primary teacher (validates existence + gets name for denormalization)
    const identityCtx = { userId: context.userId, jwtToken: context.jwtToken, tenantId: context.tenantId };
    let teacher;
    try {
      teacher = await this.identityClient.getStaff(dto.primaryTeacherId, identityCtx);
    } catch {
      throw new NotFoundException(`Teacher ${dto.primaryTeacherId} not found`);
    }

    // Validate co-teachers exist (SP4-4)
    if (dto.coTeacherIds && dto.coTeacherIds.length > 0) {
      for (const coTeacherId of dto.coTeacherIds) {
        const exists = await this.identityClient.validateStaffExists(coTeacherId, identityCtx);
        if (!exists) {
          throw new NotFoundException(`Co-teacher ${coTeacherId} not found`);
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
        academicYearId: dto.academicYearId,
        termId: dto.termId,
        courseCode: course.courseCode,
        courseName: course.courseName,
        sectionNumber: dto.sectionNumber,
        sectionName: dto.sectionName,
        primaryTeacherId: dto.primaryTeacherId,
        primaryTeacherName,
        coTeacherIds: dto.coTeacherIds,
        roomId: dto.roomId,
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
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const section = await this.dynamoDBClient.getItem<CourseSection>(
      client,
      context.tenantId,
      EntityKeyBuilder.section(schoolId, sectionId),
    );

    if (!section) {
      throw new NotFoundException(`Section ${sectionId} not found`);
    }

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
      teacherId?: string;
      academicYearId?: string;
      isActive?: boolean;
    },
  ): Promise<PaginatedResult<SectionResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const filterParts: string[] = [];
    const expressionValues: Record<string, any> = {};

    if (filters?.courseId) {
      filterParts.push('courseId = :courseId');
      expressionValues[':courseId'] = filters.courseId;
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

    const result = await this.dynamoDBClient.queryGSI<CourseSection>(
      client,
      'GSI1',
      GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
      'SECTION#',
      'begins_with',
      filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
      Object.keys(expressionValues).length > 0 ? expressionValues : undefined,
      undefined,
      limit,
    );

    return {
      items: result.items.map(sectionEntityToDto),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
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

    // Update GSI1SK if sectionNumber changed
    if (dto.sectionNumber) {
      updateParts.push('gsi1sk = :gsi1sk');
      expressionValues[':gsi1sk'] = `SECTION#${existing.courseId}#${dto.sectionNumber}`;
    }

    const updated = await this.dynamoDBClient.updateItem<CourseSection>(
      client,
      context.tenantId,
      entityKey,
      `SET ${updateParts.join(', ')}`,
      expressionValues,
      'version = :currentVersion',
    );

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

    this.logger.log(`Propagated teacher name to ${updated} sections for teacher ${teacherId}`);
    return updated;
  }
}
