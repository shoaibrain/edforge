/**
 * Course Offering Service - CourseOffering CRUD
 *
 * Manages Ed-Fi CourseOffering entities — a Course offered in a specific
 * academic session at a school. Validates course locally and session
 * via cross-service call to Identity.
 *
 * Chain: Course → CourseOffering → Section
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import {
  CourseOffering,
  CourseOfferingKeyBuilder,
  createCourseOfferingEntity,
} from '../common/entities/course-offering.entity';
import { Course } from '../common/entities/course.entity';
import {
  EntityKeyBuilder,
  GSIKeyBuilder,
  RequestContext,
  PaginatedResult,
} from '../common/entities/base.entity';
import type {
  CreateCourseOfferingDto,
  UpdateCourseOfferingDto,
  CourseOfferingResponseDto,
} from '@aibrains/shared-types';

@Injectable()
export class CourseOfferingService {
  private readonly logger = new Logger(CourseOfferingService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly identityClient: IdentityClientService,
  ) {}

  /**
   * Create a new course offering
   */
  async createCourseOffering(
    dto: CreateCourseOfferingDto,
    context: RequestContext,
  ): Promise<CourseOfferingResponseDto> {
    this.logger.debug(`createCourseOffering: entry, schoolId=${dto.schoolId}, courseId=${dto.courseId}, academicSessionId=${dto.academicSessionId}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const courseOfferingId = uuid();
    const now = new Date().toISOString();

    // Validate course exists locally
    const course = await this.dynamoDBClient.getItem<Course>(
      client,
      context.tenantId,
      EntityKeyBuilder.course(dto.schoolId, dto.courseId),
    );
    if (!course) {
      throw new NotFoundException(`Course ${dto.courseId} not found`);
    }

    // Validate academic session exists via Identity service
    const identityContext = { userId: context.userId, jwtToken: context.jwtToken, tenantId: context.tenantId };
    const sessionValid = await this.validateAcademicSession(dto.schoolId, dto.academicSessionId, identityContext);
    if (!sessionValid.exists) {
      throw new NotFoundException(`Academic session ${dto.academicSessionId} not found`);
    }

    // Check for duplicate offering (same course + session)
    await this.assertUniqueOffering(client, context.tenantId, dto.schoolId, dto.courseId, dto.academicSessionId);

    const entity = createCourseOfferingEntity(
      context.tenantId,
      dto.schoolId,
      courseOfferingId,
      {
        courseId: dto.courseId,
        academicSessionId: dto.academicSessionId,
        localCourseCode: dto.localCourseCode,
        localCourseTitle: dto.localCourseTitle,
        // Denormalize
        courseName: course.courseName,
        courseCode: course.courseCode,
        sessionName: sessionValid.sessionName,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );

    await this.dynamoDBClient.putItem(client, entity);
    this.logger.debug(`createCourseOffering: courseOfferingId=${courseOfferingId}, courseId=${dto.courseId}, schoolId=${dto.schoolId} persisted`);

    this.logger.log(`CourseOffering created: ${course.courseCode} in session ${sessionValid.sessionName} (${courseOfferingId})`);

    return this.toResponse(entity);
  }

  /**
   * Get course offering by ID
   */
  async getCourseOffering(
    courseOfferingId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<CourseOfferingResponseDto> {
    this.logger.debug(`getCourseOffering: entry, courseOfferingId=${courseOfferingId}, schoolId=${schoolId}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entity = await this.dynamoDBClient.getItem<CourseOffering>(
      client,
      context.tenantId,
      CourseOfferingKeyBuilder.courseOffering(schoolId, courseOfferingId),
    );

    if (!entity) {
      throw new NotFoundException('Course offering not found');
    }

    this.logger.debug(`getCourseOffering: found courseOfferingId=${courseOfferingId}, courseId=${entity.courseId}`);
    return this.toResponse(entity);
  }

  /**
   * List course offerings for a school (with optional filters)
   */
  async listCourseOfferings(
    schoolId: string,
    context: RequestContext,
    filters?: { courseId?: string; academicSessionId?: string },
    limit = 50,
    cursor?: string,
  ): Promise<PaginatedResult<CourseOfferingResponseDto>> {
    this.logger.debug(`listCourseOfferings: entry, schoolId=${schoolId}, limit=${limit}, hasCursor=${!!cursor}, courseIdFilter=${filters?.courseId ?? 'none'}, sessionIdFilter=${filters?.academicSessionId ?? 'none'}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    let exclusiveStartKey: Record<string, any> | undefined;
    if (cursor) {
      try {
        exclusiveStartKey = JSON.parse(Buffer.from(cursor, 'base64').toString());
      } catch {
        // Invalid cursor, ignore
      }
    }

    // Use GSI1 for school-scoped queries
    let skPrefix = 'COURSE#';
    if (filters?.courseId) {
      skPrefix = `COURSE#${filters.courseId}#`;
      if (filters?.academicSessionId) {
        skPrefix = `COURSE#${filters.courseId}#ACADSESSION#${filters.academicSessionId}`;
      }
    }

    const result = await this.dynamoDBClient.queryGSI<CourseOffering>(
      client,
      'GSI1',
      GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
      skPrefix,
      'begins_with',
      'entityType = :entityType',
      { ':entityType': 'COURSE_OFFERING' },
      undefined,
      limit,
      true,
      exclusiveStartKey,
    );

    this.logger.debug(`listCourseOfferings: resultCount=${result.items.length}, hasMore=${result.hasMore}`);
    return {
      items: result.items.map(o => this.toResponse(o)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Update course offering
   */
  async updateCourseOffering(
    courseOfferingId: string,
    schoolId: string,
    dto: UpdateCourseOfferingDto,
    context: RequestContext,
  ): Promise<CourseOfferingResponseDto> {
    this.logger.debug(`updateCourseOffering: entry, courseOfferingId=${courseOfferingId}, schoolId=${schoolId}, updatedFields=${Object.keys(dto).join(',')}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entity = await this.dynamoDBClient.getItem<CourseOffering>(
      client,
      context.tenantId,
      CourseOfferingKeyBuilder.courseOffering(schoolId, courseOfferingId),
    );

    if (!entity) {
      throw new NotFoundException('Course offering not found');
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};

    if (dto.localCourseCode !== undefined) {
      updates.push('localCourseCode = :localCourseCode');
      values[':localCourseCode'] = dto.localCourseCode;
    }
    if (dto.localCourseTitle !== undefined) {
      updates.push('localCourseTitle = :localCourseTitle');
      values[':localCourseTitle'] = dto.localCourseTitle;
    }

    if (updates.length === 0) {
      this.logger.debug(`updateCourseOffering: courseOfferingId=${courseOfferingId}, no fields to update`);
      return this.toResponse(entity);
    }

    updates.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;

    const updated = await this.dynamoDBClient.updateItem<CourseOffering>(
      client,
      context.tenantId,
      CourseOfferingKeyBuilder.courseOffering(schoolId, courseOfferingId),
      `SET ${updates.join(', ')}`,
      values,
    );

    this.logger.debug(`updateCourseOffering: courseOfferingId=${courseOfferingId}, schoolId=${schoolId} updated`);
    this.logger.log(`CourseOffering updated: ${courseOfferingId}`);

    return this.toResponse(updated);
  }

  /**
   * Delete course offering
   */
  async deleteCourseOffering(
    courseOfferingId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<void> {
    this.logger.debug(`deleteCourseOffering: entry, courseOfferingId=${courseOfferingId}, schoolId=${schoolId}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entity = await this.dynamoDBClient.getItem<CourseOffering>(
      client,
      context.tenantId,
      CourseOfferingKeyBuilder.courseOffering(schoolId, courseOfferingId),
    );

    if (!entity) {
      throw new NotFoundException('Course offering not found');
    }

    // TODO: Check if any sections reference this offering before deleting

    await this.dynamoDBClient.deleteItem(
      client,
      context.tenantId,
      CourseOfferingKeyBuilder.courseOffering(schoolId, courseOfferingId),
    );

    this.logger.debug(`deleteCourseOffering: courseOfferingId=${courseOfferingId}, schoolId=${schoolId} deleted`);
    this.logger.log(`CourseOffering deleted: ${courseOfferingId}`);
  }

  // ============================================
  // Validation Helpers
  // ============================================

  /**
   * Validate academic session exists via Identity service
   */
  private async validateAcademicSession(
    schoolId: string,
    academicSessionId: string,
    identityContext: { userId: string; jwtToken: string; tenantId: string },
  ): Promise<{ exists: boolean; sessionName?: string }> {
    try {
      const session = await this.identityClient.getAcademicSession(
        schoolId,
        academicSessionId,
        identityContext as any,
      );
      return { exists: true, sessionName: session?.sessionName };
    } catch {
      return { exists: false };
    }
  }

  /**
   * Assert no duplicate offering for same course + session
   */
  private async assertUniqueOffering(
    client: any,
    tenantId: string,
    schoolId: string,
    courseId: string,
    sessionId: string,
  ): Promise<void> {
    const gsi1pk = GSIKeyBuilder.schoolScope(tenantId, schoolId);
    const gsi1sk = CourseOfferingKeyBuilder.courseSessionSort(courseId, sessionId);

    const result = await this.dynamoDBClient.queryGSI<CourseOffering>(
      client,
      'GSI1',
      gsi1pk,
      gsi1sk,
      'eq',
      undefined,
      undefined,
      undefined,
      1,
    );

    if (result.items.length > 0) {
      throw new ConflictException(
        `A course offering already exists for course ${courseId} in session ${sessionId}`
      );
    }
  }

  // ============================================
  // Response Mapper
  // ============================================

  private toResponse(entity: CourseOffering): CourseOfferingResponseDto {
    return {
      courseOfferingId: entity.courseOfferingId,
      tenantId: entity.tenantId,
      courseId: entity.courseId,
      academicSessionId: entity.academicSessionId,
      schoolId: entity.schoolId,
      localCourseCode: entity.localCourseCode,
      localCourseTitle: entity.localCourseTitle,
      courseName: entity.courseName,
      courseCode: entity.courseCode,
      sessionName: entity.sessionName,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
