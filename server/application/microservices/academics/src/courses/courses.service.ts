/**
 * Courses Service - Course catalog management
 *
 * Manages the course catalog for schools. A course represents a subject
 * offering (e.g., "Algebra 1", "US History") independent of any specific
 * academic year or section.
 *
 * ARCHITECTURE: Uses application-level tenant isolation.
 * All queries use tenantId from JWT context as partition key.
 * School validation requires Identity service call.
 *
 * Ed-Fi Alignment:
 * - Course -> Ed-Fi Course entity
 * - courseCode -> Ed-Fi CourseCode
 * - subjectArea -> Ed-Fi AcademicSubjectDescriptor
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
  createCourseEntity,
} from '../common/entities/course.entity';
import {
  EntityKeyBuilder,
  GSIKeyBuilder,
  RequestContext,
  PaginatedResult,
} from '../common/entities/base.entity';
import {
  CreateCourseDto,
  UpdateCourseDto,
  CourseResponseDto,
} from '@aibrains/shared-types';
import { courseEntityToDto } from '../common/mappers/course.mapper';

@Injectable()
export class CoursesService {
  private readonly logger = new Logger(CoursesService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: AcademicsEventsService,
    private readonly identityClient: IdentityClientService,
  ) {}

  /**
   * Create a new course in the catalog
   *
   * Validates:
   * - School exists in Identity service
   * - Course code is unique within the school
   */
  async createCourse(
    dto: CreateCourseDto,
    context: RequestContext,
  ): Promise<CourseResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Validate school exists
    const schoolExists = await this.identityClient.validateSchoolExists(
      dto.schoolId,
      { userId: context.userId, jwtToken: context.jwtToken, tenantId: context.tenantId },
    );
    if (!schoolExists) {
      throw new NotFoundException(`School ${dto.schoolId} not found`);
    }

    // Check for duplicate course code within the school
    await this.assertCourseCodeUnique(client, context.tenantId, dto.schoolId, dto.courseCode);

    // Validate prerequisites exist if provided
    if (dto.prerequisites?.length) {
      await this.validatePrerequisites(client, context.tenantId, dto.schoolId, dto.prerequisites);
    }

    const now = new Date().toISOString();
    const courseId = uuid();

    const course = createCourseEntity(
      context.tenantId,
      courseId,
      dto.schoolId,
      {
        courseCode: dto.courseCode,
        courseName: dto.courseName,
        departmentId: dto.departmentId,
        departmentName: dto.departmentName,
        description: dto.description,
        objectives: dto.objectives,
        gradeLevels: dto.gradeLevels,
        credits: dto.credits,
        creditType: dto.creditType,
        subjectArea: dto.subjectArea,
        courseType: dto.courseType,
        prerequisites: dto.prerequisites,
        corequisites: dto.corequisites,
        typicalDuration: dto.typicalDuration,
        periodsPerWeek: dto.periodsPerWeek,
        isActive: true,
        academicYearId: dto.academicYearId,
        standards: dto.standards as Course['standards'],
        textbooks: dto.textbooks as Course['textbooks'],
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      },
    );

    await this.dynamoDBClient.putItem(client, course);

    this.logger.log(`Course created: ${course.courseCode} - ${course.courseName} (${courseId})`);

    // Non-blocking event publish
    this.eventsService.publishCourseCreated(
      context.tenantId,
      courseId,
      dto.schoolId,
      dto.courseCode,
      dto.courseName,
    ).catch(err => this.logger.error('Failed to publish CourseCreated event', err));

    return courseEntityToDto(course);
  }

  /**
   * Get a course by ID
   */
  async getCourse(
    courseId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<CourseResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const course = await this.dynamoDBClient.getItem<Course>(
      client,
      context.tenantId,
      EntityKeyBuilder.course(schoolId, courseId),
    );

    if (!course) {
      throw new NotFoundException(`Course ${courseId} not found`);
    }

    return courseEntityToDto(course);
  }

  /**
   * List courses for a school
   *
   * Uses GSI1 (school-scoped) for efficient querying.
   */
  async listCourses(
    schoolId: string,
    context: RequestContext,
    limit: number = 50,
    cursor?: string,
    filters?: {
      subjectArea?: string;
      courseType?: string;
      isActive?: boolean;
      departmentId?: string;
      searchTerm?: string;
    },
  ): Promise<PaginatedResult<CourseResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    let exclusiveStartKey: Record<string, any> | undefined;
    if (cursor) {
      try {
        exclusiveStartKey = JSON.parse(Buffer.from(cursor, 'base64').toString());
      } catch {
        // Invalid cursor, ignore
      }
    }

    // Build filter expressions
    const filterParts: string[] = [];
    const expressionValues: Record<string, any> = {};
    const expressionNames: Record<string, string> = {};

    if (filters?.subjectArea) {
      filterParts.push('subjectArea = :subjectArea');
      expressionValues[':subjectArea'] = filters.subjectArea;
    }

    if (filters?.courseType) {
      filterParts.push('courseType = :courseType');
      expressionValues[':courseType'] = filters.courseType;
    }

    if (filters?.isActive !== undefined) {
      filterParts.push('isActive = :isActive');
      expressionValues[':isActive'] = filters.isActive;
    }

    if (filters?.departmentId) {
      filterParts.push('departmentId = :departmentId');
      expressionValues[':departmentId'] = filters.departmentId;
    }

    if (filters?.searchTerm) {
      filterParts.push('(contains(courseName, :search) OR contains(courseCode, :search))');
      expressionValues[':search'] = filters.searchTerm;
    }

    const result = await this.dynamoDBClient.queryGSI<Course>(
      client,
      'GSI1',
      GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
      'COURSE#',
      'begins_with',
      filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
      Object.keys(expressionValues).length > 0 ? expressionValues : undefined,
      Object.keys(expressionNames).length > 0 ? expressionNames : undefined,
      limit,
      true,
      exclusiveStartKey,
    );

    return {
      items: result.items.map(courseEntityToDto),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Update an existing course
   */
  async updateCourse(
    courseId: string,
    schoolId: string,
    dto: UpdateCourseDto,
    context: RequestContext,
  ): Promise<CourseResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.course(schoolId, courseId);

    // Verify course exists
    const existing = await this.dynamoDBClient.getItem<Course>(
      client,
      context.tenantId,
      entityKey,
    );

    if (!existing) {
      throw new NotFoundException(`Course ${courseId} not found`);
    }

    // Validate prerequisites if updated
    if (dto.prerequisites?.length) {
      // Prevent self-referencing prerequisites
      if (dto.prerequisites.includes(courseId)) {
        throw new BadRequestException('A course cannot be a prerequisite of itself');
      }
      await this.validatePrerequisites(client, context.tenantId, schoolId, dto.prerequisites);
    }

    // Build update expression
    const now = new Date().toISOString();
    const updateParts: string[] = ['updatedAt = :updatedAt', 'updatedBy = :updatedBy', 'version = version + :inc'];
    const expressionValues: Record<string, any> = {
      ':updatedAt': now,
      ':updatedBy': context.userId,
      ':inc': 1,
      ':currentVersion': existing.version,
    };
    const expressionNames: Record<string, string> = {};

    const updateableFields: Array<{ key: keyof UpdateCourseDto; attr?: string; reserved?: boolean }> = [
      { key: 'courseName' },
      { key: 'departmentId' },
      { key: 'departmentName' },
      { key: 'description' },
      { key: 'objectives' },
      { key: 'gradeLevels' },
      { key: 'credits' },
      { key: 'creditType' },
      { key: 'subjectArea' },
      { key: 'courseType' },
      { key: 'prerequisites' },
      { key: 'corequisites' },
      { key: 'typicalDuration' },
      { key: 'periodsPerWeek' },
      { key: 'academicYearId' },
      { key: 'standards', reserved: true },
      { key: 'textbooks' },
    ];

    for (const field of updateableFields) {
      const value = dto[field.key];
      if (value !== undefined) {
        const attrName = field.attr || (field.key as string);
        if (field.reserved) {
          const placeholder = `#${attrName}`;
          expressionNames[placeholder] = attrName;
          updateParts.push(`${placeholder} = :${attrName}`);
        } else {
          updateParts.push(`${attrName} = :${attrName}`);
        }
        expressionValues[`:${attrName}`] = value;
      }
    }

    // Update GSI1SK if courseName changed
    if (dto.courseName) {
      const departmentId = dto.departmentId || existing.departmentId || 'general';
      updateParts.push('gsi1sk = :gsi1sk');
      expressionValues[':gsi1sk'] = `COURSE#${departmentId}#${dto.courseName.toUpperCase()}`;
    }

    const updated = await this.dynamoDBClient.updateItem<Course>(
      client,
      context.tenantId,
      entityKey,
      `SET ${updateParts.join(', ')}`,
      expressionValues,
      'version = :currentVersion', // Optimistic locking
      Object.keys(expressionNames).length > 0 ? expressionNames : undefined,
    );

    this.logger.log(`Course updated: ${courseId}`);

    // Non-blocking event
    this.eventsService.publishCourseUpdated(
      context.tenantId,
      courseId,
      schoolId,
      Object.keys(dto),
    ).catch(err => this.logger.error('Failed to publish CourseUpdated event', err));

    // Propagate course name changes to denormalized sections (non-blocking)
    if (dto.courseName) {
      this.propagateCourseNameToSections(
        client, context.tenantId, schoolId, courseId,
        dto.courseName,
        existing.courseCode,
        context.userId,
      ).catch((err: any) => this.logger.error('Failed to propagate course name to sections', err));
    }

    return courseEntityToDto(updated);
  }

  /**
   * Soft-delete a course (set isActive=false)
   *
   * Does not physically remove the record to maintain referential integrity
   * with historical sections, grades, and transcripts.
   */
  async deleteCourse(
    courseId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.course(schoolId, courseId);

    const existing = await this.dynamoDBClient.getItem<Course>(
      client,
      context.tenantId,
      entityKey,
    );

    if (!existing) {
      throw new NotFoundException(`Course ${courseId} not found`);
    }

    // Cascade check: block if active sections exist
    const activeSections = await this.dynamoDBClient.queryGSI<CourseSection>(
      client,
      'GSI1',
      GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
      `SECTION#${courseId}#`,
      'begins_with',
      'isActive = :isActive',
      { ':isActive': true },
      undefined,
      1, // Only need to know if at least one exists
    );

    if (activeSections.items.length > 0) {
      throw new BadRequestException(
        'Cannot deactivate course with active sections. Deactivate all sections first.',
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

    this.logger.log(`Course soft-deleted: ${courseId}`);

    this.eventsService.publishCourseDeleted(
      context.tenantId,
      courseId,
      schoolId,
    ).catch(err => this.logger.error('Failed to publish CourseDeleted event', err));
  }

  /**
   * Assert course code is unique within a school.
   * Uses GSI1 to search for courses with the same code.
   */
  private async assertCourseCodeUnique(
    client: any,
    tenantId: string,
    schoolId: string,
    courseCode: string,
  ): Promise<void> {
    const result = await this.dynamoDBClient.queryGSI<Course>(
      client,
      'GSI1',
      GSIKeyBuilder.schoolScope(tenantId, schoolId),
      'COURSE#',
      'begins_with',
      'courseCode = :code',
      { ':code': courseCode },
      undefined,
      1,
    );

    if (result.items.length > 0) {
      throw new ConflictException(
        `Course with code '${courseCode}' already exists in this school`,
      );
    }
  }

  /**
   * Validate that all prerequisite course IDs exist within the same school.
   */
  private async validatePrerequisites(
    client: any,
    tenantId: string,
    schoolId: string,
    prerequisiteIds: string[],
  ): Promise<void> {
    const keys = prerequisiteIds.map(id => ({
      tenantId,
      entityKey: EntityKeyBuilder.course(schoolId, id),
    }));

    const courses = await this.dynamoDBClient.batchGetItems<Course>(client, keys);
    const foundIds = new Set(courses.map(c => c.courseId));

    const missing = prerequisiteIds.filter(id => !foundIds.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Prerequisite courses not found: ${missing.join(', ')}`,
      );
    }
  }

  /**
   * Propagate updated course name to all denormalized sections.
   * Best-effort — failures are logged but don't block the course update.
   */
  private async propagateCourseNameToSections(
    client: any,
    tenantId: string,
    schoolId: string,
    courseId: string,
    courseName: string,
    courseCode: string,
    userId: string,
  ): Promise<void> {
    const result = await this.dynamoDBClient.queryGSI<CourseSection>(
      client,
      'GSI1',
      GSIKeyBuilder.schoolScope(tenantId, schoolId),
      `SECTION#${courseId}#`,
      'begins_with',
      undefined,
      undefined,
      undefined,
      500,
    );

    const now = new Date().toISOString();
    for (const section of result.items) {
      try {
        await this.dynamoDBClient.updateItem(
          client,
          tenantId,
          EntityKeyBuilder.section(schoolId, section.sectionId),
          'SET courseName = :courseName, courseCode = :courseCode, updatedAt = :updatedAt, updatedBy = :updatedBy',
          {
            ':courseName': courseName,
            ':courseCode': courseCode,
            ':updatedAt': now,
            ':updatedBy': userId,
          },
        );
      } catch (err: any) {
        this.logger.error(`Failed to propagate course name to section ${section.sectionId}`, err);
      }
    }

    this.logger.log(`Propagated course name to ${result.items.length} sections for course ${courseId}`);
  }
}
