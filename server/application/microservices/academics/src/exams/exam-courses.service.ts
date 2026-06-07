/**
 * ExamCourses Service — Sprint A.3.6
 *
 * Per-exam per-course CRUD. Validates Course FK via direct DDB GetItem
 * (no circular service-injection between ExamsModule + CoursesModule).
 * Denormalizes Course.courseName + courseCode + academicSubject at write
 * time so A.4 term-aggregation doesn't need extra GetItems per row.
 *
 * @see docs/pilot-greenlight/a3-sprint-plan.md §4 A.3.6
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import {
  ExamCourse,
  createExamCourseEntity,
} from '../common/entities/exam-course.entity';
import { Course } from '../common/entities/course.entity';
import { Exam } from '../common/entities/exam.entity';
import {
  EntityKeyBuilder,
  RequestContext,
  PaginatedResult,
} from '../common/entities/base.entity';
import {
  CreateExamCourseDto,
  UpdateExamCourseDto,
  ExamCourseResponseDto,
  PABSON_DEFAULT_PASSING_MARKS,
} from '@aibrains/shared-types';
import { examCourseEntityToDto } from '../common/mappers/exam-course.mapper';
import { acceptsExamCourseMutations, isExamTombstoned } from './exam-state-machine';

@Injectable()
export class ExamCoursesService {
  private readonly logger = new Logger(ExamCoursesService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: AcademicsEventsService,
  ) {}

  // ============================================================================
  // CREATE
  // ============================================================================

  async addExamCourse(
    examId: string,
    dto: CreateExamCourseDto,
    context: RequestContext,
  ): Promise<ExamCourseResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // 1. Validate Exam exists + accepts ExamCourse mutations
    const exam = await this.dynamoDBClient.getItem<Exam>(
      client,
      context.tenantId,
      EntityKeyBuilder.exam(dto.schoolId, examId),
    );
    if (!exam) {
      throw new NotFoundException({
        errorCode: 'EXAM_NOT_FOUND',
        message: `Exam ${examId} not found in school ${dto.schoolId}`,
      });
    }
    if (isExamTombstoned(exam)) {
      throw new ConflictException({
        errorCode: 'EXAM_TOMBSTONED',
        message: `Cannot add courses to a deleted exam (examId=${examId})`,
      });
    }
    if (!acceptsExamCourseMutations(exam.status)) {
      throw new ConflictException({
        errorCode: 'EXAM_LOCKED',
        message: `Cannot modify exam courses while exam.status=${exam.status} (accepts: draft, scheduled)`,
        currentStatus: exam.status,
      });
    }

    // 2. Validate Course exists via direct GetItem (no circular service inject)
    const course = await this.dynamoDBClient.getItem<Course>(
      client,
      context.tenantId,
      EntityKeyBuilder.course(dto.schoolId, dto.courseId),
    );
    if (!course) {
      throw new NotFoundException({
        errorCode: 'COURSE_NOT_FOUND',
        message: `Course ${dto.courseId} not found in school ${dto.schoolId}`,
      });
    }

    // ELS.2 — Course.gradeLevels must overlap with Exam.gradeLevels. Stops
    // operators from attaching a Grade 8 course to a Grade 2 exam, which
    // downstream would either produce empty rosters (no enrollments at the
    // shared grade) or score-sheet entries against off-scope students.
    // Skip when either side is missing/empty (pre-ELS.1 legacy exams, or
    // courses without a curated gradeLevels list — both fall through to
    // the legacy "all-grades" behavior).
    if (
      Array.isArray(exam.gradeLevels) &&
      exam.gradeLevels.length > 0 &&
      Array.isArray(course.gradeLevels) &&
      course.gradeLevels.length > 0
    ) {
      const examSet = new Set(exam.gradeLevels);
      const overlap = course.gradeLevels.some((g) => examSet.has(g));
      if (!overlap) {
        throw new BadRequestException({
          errorCode: 'EXAM_COURSE_GRADE_MISMATCH',
          message:
            `Course ${dto.courseId} gradeLevels [${course.gradeLevels.join(', ')}] ` +
            `do not overlap with exam.gradeLevels [${exam.gradeLevels.join(', ')}]`,
          courseGradeLevels: course.gradeLevels,
          examGradeLevels: exam.gradeLevels,
        });
      }
    }

    // 3. Validate passingMarks ≤ maxMarks (defensive; Zod refine already enforces on create)
    const passingMarks = dto.passingMarks ?? PABSON_DEFAULT_PASSING_MARKS;
    if (passingMarks > dto.maxMarks) {
      throw new BadRequestException({
        errorCode: 'PASSING_MARKS_EXCEEDS_MAX',
        message: `passingMarks (${passingMarks}) must not exceed maxMarks (${dto.maxMarks})`,
      });
    }

    const now = new Date().toISOString();
    const examCourseId = uuid();

    const entity = createExamCourseEntity(context.tenantId, examCourseId, examId, dto.schoolId, {
      courseId: dto.courseId,
      // Denormalized at write
      courseName: course.courseName,
      courseCode: course.courseCode,
      academicSubject: course.academicSubject,
      subjectArea: course.subjectArea,
      maxMarks: dto.maxMarks,
      passingMarks,
      creditHours: dto.creditHours,
      components: dto.components,
      createdAt: now,
      createdBy: context.userId,
      updatedAt: now,
      updatedBy: context.userId,
      version: 1,
    });

    await this.dynamoDBClient.putItem(client, entity);

    this.eventsService.publishExamCourseAdded(
      context.tenantId,
      examCourseId,
      examId,
      dto.schoolId,
      dto.courseId,
    ).catch(err => this.logger.error('Failed to publish ExamCourseAdded event', err));

    return examCourseEntityToDto(entity);
  }

  // ============================================================================
  // READ
  // ============================================================================

  async getExamCourse(
    examId: string,
    examCourseId: string,
    context: RequestContext,
  ): Promise<ExamCourseResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const ec = await this.dynamoDBClient.getItem<ExamCourse>(
      client,
      context.tenantId,
      EntityKeyBuilder.examCourse(examId, examCourseId),
    );
    if (!ec) {
      throw new NotFoundException(`ExamCourse ${examCourseId} not found in exam ${examId}`);
    }
    return examCourseEntityToDto(ec);
  }

  async listExamCourses(
    examId: string,
    context: RequestContext,
    limit: number = 100,
  ): Promise<PaginatedResult<ExamCourseResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const result = await this.dynamoDBClient.queryGSI<ExamCourse>(
      client,
      'GSI2',
      `exam#${examId}`,
      'course#',
      'begins_with',
      undefined,
      undefined,
      undefined,
      limit,
      true,
    );

    return {
      items: result.items.map(examCourseEntityToDto),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  // ============================================================================
  // UPDATE
  // ============================================================================

  async updateExamCourse(
    examId: string,
    examCourseId: string,
    dto: UpdateExamCourseDto,
    context: RequestContext,
  ): Promise<ExamCourseResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.examCourse(examId, examCourseId);

    const existing = await this.dynamoDBClient.getItem<ExamCourse>(
      client,
      context.tenantId,
      entityKey,
    );
    if (!existing) {
      throw new NotFoundException(`ExamCourse ${examCourseId} not found`);
    }

    // Guard: parent Exam must accept mutations
    const exam = await this.dynamoDBClient.getItem<Exam>(
      client,
      context.tenantId,
      EntityKeyBuilder.exam(existing.schoolId, examId),
    );
    if (!exam) {
      throw new NotFoundException(`Parent exam ${examId} not found`);
    }
    if (isExamTombstoned(exam)) {
      throw new ConflictException({
        errorCode: 'EXAM_TOMBSTONED',
        message: `Cannot modify courses of a deleted exam (examId=${examId})`,
      });
    }
    if (!acceptsExamCourseMutations(exam.status)) {
      throw new ConflictException({
        errorCode: 'EXAM_LOCKED',
        message: `Cannot modify exam courses while exam.status=${exam.status}`,
        currentStatus: exam.status,
      });
    }

    // Combine existing + new for passingMarks ≤ maxMarks check
    const maxMarks = dto.maxMarks ?? existing.maxMarks;
    const passingMarks = dto.passingMarks ?? existing.passingMarks;
    if (passingMarks > maxMarks) {
      throw new BadRequestException({
        errorCode: 'PASSING_MARKS_EXCEEDS_MAX',
        message: `passingMarks (${passingMarks}) must not exceed maxMarks (${maxMarks})`,
      });
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

    const fields: Array<keyof UpdateExamCourseDto> = ['maxMarks', 'passingMarks', 'creditHours'];
    for (const f of fields) {
      const v = dto[f];
      if (v !== undefined) {
        updateParts.push(`${f} = :${f}`);
        expressionValues[`:${f}`] = v;
      }
    }

    const updated = await this.dynamoDBClient.updateItem<ExamCourse>(
      client,
      context.tenantId,
      entityKey,
      `SET ${updateParts.join(', ')}`,
      expressionValues,
      'version = :currentVersion',
    );

    this.eventsService.publishExamCourseUpdated(
      context.tenantId,
      examCourseId,
      examId,
      existing.schoolId,
      Object.keys(dto),
    ).catch(err => this.logger.error('Failed to publish ExamCourseUpdated event', err));

    return examCourseEntityToDto(updated);
  }

  // ============================================================================
  // DELETE (soft via parent Exam ownership; uses DDB delete since per-exam-course is fine to fully remove pre-publish)
  // ============================================================================

  async removeExamCourse(
    examId: string,
    examCourseId: string,
    context: RequestContext,
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.examCourse(examId, examCourseId);

    const existing = await this.dynamoDBClient.getItem<ExamCourse>(
      client,
      context.tenantId,
      entityKey,
    );
    if (!existing) {
      throw new NotFoundException(`ExamCourse ${examCourseId} not found`);
    }

    const exam = await this.dynamoDBClient.getItem<Exam>(
      client,
      context.tenantId,
      EntityKeyBuilder.exam(existing.schoolId, examId),
    );
    if (!exam) {
      throw new NotFoundException(`Parent exam ${examId} not found`);
    }
    if (isExamTombstoned(exam)) {
      throw new ConflictException({
        errorCode: 'EXAM_TOMBSTONED',
        message: `Cannot remove courses from a deleted exam (examId=${examId})`,
      });
    }
    if (!acceptsExamCourseMutations(exam.status)) {
      throw new ConflictException({
        errorCode: 'EXAM_LOCKED',
        message: `Cannot remove exam courses while exam.status=${exam.status}`,
        currentStatus: exam.status,
      });
    }

    await this.dynamoDBClient.deleteItem(client, context.tenantId, entityKey);

    this.eventsService.publishExamCourseRemoved(
      context.tenantId,
      examCourseId,
      examId,
      existing.schoolId,
    ).catch(err => this.logger.error('Failed to publish ExamCourseRemoved event', err));
  }
}
