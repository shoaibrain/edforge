/**
 * Section Enrollment Service
 *
 * Manages student enrollment in course sections (junction entity).
 * Atomically updates section currentEnrollment counter.
 *
 * Ed-Fi Alignment:
 * - Maps to Ed-Fi StudentSectionAssociation
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import {
  CourseSection,
} from '../common/entities/course.entity';
import {
  SectionEnrollment,
  sectionEnrollmentKey,
  createSectionEnrollmentEntity,
} from '../common/entities/section-enrollment.entity';
import {
  EntityKeyBuilder,
  GSIKeyBuilder,
  RequestContext,
  PaginatedResult,
} from '../common/entities/base.entity';
import {
  StudentSectionResponseDto,
  SectionRosterResponseDto,
} from '@aibrains/shared-types';

@Injectable()
export class SectionEnrollmentService {
  private readonly logger = new Logger(SectionEnrollmentService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: AcademicsEventsService,
  ) {}

  /**
   * Enroll a student in a section
   *
   * Validates:
   * - Section exists and is active
   * - Section is not at capacity
   * - Student is not already enrolled in this section
   *
   * Atomically increments section currentEnrollment counter.
   */
  async enrollStudent(
    sectionId: string,
    schoolId: string,
    studentId: string,
    context: RequestContext,
  ): Promise<StudentSectionResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const tableName = this.dynamoDBClient.getTableName();

    // Validate section exists and is active (pre-check for better error messages)
    const section = await this.dynamoDBClient.getItem<CourseSection>(
      client,
      context.tenantId,
      EntityKeyBuilder.section(schoolId, sectionId),
    );

    if (!section) {
      throw new NotFoundException(`Section ${sectionId} not found`);
    }

    if (!section.isActive) {
      throw new BadRequestException(`Section ${sectionId} is inactive`);
    }

    if (section.currentEnrollment >= section.maxEnrollment) {
      throw new BadRequestException(
        `Section ${sectionId} is at capacity (${section.maxEnrollment}/${section.maxEnrollment})`,
      );
    }

    // Validate student exists (SP4-3)
    const student = await this.dynamoDBClient.getItem<{ entityType: string; firstName?: string; lastSurname?: string; status?: string }>(
      client,
      context.tenantId,
      EntityKeyBuilder.student(studentId),
    );
    if (!student) {
      throw new NotFoundException(`Student ${studentId} not found`);
    }
    if (student.status === 'inactive' || student.status === 'withdrawn') {
      throw new BadRequestException(`Student ${studentId} is ${student.status} and cannot be enrolled`);
    }

    // Validate student has active annual enrollment for this school/year (SP4-3)
    const annualEnrollment = await this.dynamoDBClient.getItem<{ entityType: string; status?: string }>(
      client,
      context.tenantId,
      EntityKeyBuilder.enrollment(schoolId, section.academicYearId, studentId),
    );
    if (!annualEnrollment) {
      throw new BadRequestException(
        `Student ${studentId} does not have an annual enrollment for school ${schoolId} in academic year ${section.academicYearId}`,
      );
    }

    // Build student display name for denormalization
    const studentName = student.firstName && student.lastSurname
      ? `${student.firstName} ${student.lastSurname}`
      : undefined;

    // Create section enrollment entity
    const enrollment = createSectionEnrollmentEntity(
      context.tenantId,
      schoolId,
      sectionId,
      studentId,
      {
        courseId: section.courseId,
        academicYearId: section.academicYearId,
        courseCode: section.courseCode,
        courseName: section.courseName,
        sectionNumber: section.sectionNumber,
        studentName,
        enrolledBy: context.userId,
      },
    );

    // Atomic transaction: insert enrollment + increment counter + capacity guard
    try {
      await this.dynamoDBClient.transactWrite(client, [
        {
          // Insert enrollment (fails if already exists and active)
          Put: {
            TableName: tableName,
            Item: enrollment,
            ConditionExpression: 'attribute_not_exists(entityKey) OR isActive = :false',
            ExpressionAttributeValues: { ':false': false },
          },
        },
        {
          // Increment counter with capacity guard
          Update: {
            TableName: tableName,
            Key: {
              tenantId: context.tenantId,
              entityKey: EntityKeyBuilder.section(schoolId, sectionId),
            },
            UpdateExpression: 'SET currentEnrollment = currentEnrollment + :inc, updatedAt = :updatedAt',
            ConditionExpression: 'currentEnrollment < maxEnrollment AND isActive = :true',
            ExpressionAttributeValues: {
              ':inc': 1,
              ':updatedAt': new Date().toISOString(),
              ':true': true,
            },
          },
        },
      ]);
    } catch (error: any) {
      if (error.name === 'TransactionCanceledException') {
        const reasons = error.CancellationReasons || [];
        // First item = Put (duplicate), Second item = Update (capacity)
        if (reasons[0]?.Code === 'ConditionalCheckFailed') {
          throw new ConflictException(
            `Student ${studentId} is already enrolled in section ${sectionId}`,
          );
        }
        if (reasons[1]?.Code === 'ConditionalCheckFailed') {
          throw new BadRequestException(
            `Section ${sectionId} is at capacity or inactive`,
          );
        }
      }
      throw error;
    }

    this.logger.log(
      `Student ${studentId} enrolled in section ${sectionId} (${section.courseCode}-${section.sectionNumber})`,
    );

    return {
      studentId: enrollment.studentId,
      studentName: enrollment.studentName,
      sectionId: enrollment.sectionId,
      enrolledAt: enrollment.enrolledAt,
      enrolledBy: enrollment.enrolledBy,
    };
  }

  /**
   * Remove a student from a section (drop)
   *
   * Soft-deletes the enrollment record and decrements the counter.
   */
  async dropStudent(
    sectionId: string,
    schoolId: string,
    studentId: string,
    context: RequestContext,
    reason?: string,
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const tableName = this.dynamoDBClient.getTableName();
    const enrollmentKey = sectionEnrollmentKey(schoolId, sectionId, studentId);

    const enrollment = await this.dynamoDBClient.getItem<SectionEnrollment>(
      client,
      context.tenantId,
      enrollmentKey,
    );

    if (!enrollment || !enrollment.isActive) {
      throw new NotFoundException(
        `Student ${studentId} is not enrolled in section ${sectionId}`,
      );
    }

    const now = new Date().toISOString();

    // Atomic transaction: soft-delete enrollment + decrement counter
    await this.dynamoDBClient.transactWrite(client, [
      {
        Update: {
          TableName: tableName,
          Key: { tenantId: context.tenantId, entityKey: enrollmentKey },
          UpdateExpression: 'SET isActive = :isActive, droppedAt = :droppedAt, droppedBy = :droppedBy, dropReason = :dropReason, updatedAt = :updatedAt, updatedBy = :updatedBy',
          ConditionExpression: 'isActive = :true',
          ExpressionAttributeValues: {
            ':isActive': false,
            ':droppedAt': now,
            ':droppedBy': context.userId,
            ':dropReason': reason || 'dropped',
            ':updatedAt': now,
            ':updatedBy': context.userId,
            ':true': true,
          },
        },
      },
      {
        Update: {
          TableName: tableName,
          Key: {
            tenantId: context.tenantId,
            entityKey: EntityKeyBuilder.section(schoolId, sectionId),
          },
          UpdateExpression: 'SET currentEnrollment = currentEnrollment - :dec, updatedAt = :updatedAt',
          ConditionExpression: 'currentEnrollment > :zero',
          ExpressionAttributeValues: {
            ':dec': 1,
            ':updatedAt': now,
            ':zero': 0,
          },
        },
      },
    ]);

    this.logger.log(`Student ${studentId} dropped from section ${sectionId}`);
  }

  /**
   * Get the roster (list of enrolled students) for a section
   */
  async getSectionRoster(
    sectionId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<SectionRosterResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Get section details
    const section = await this.dynamoDBClient.getItem<CourseSection>(
      client,
      context.tenantId,
      EntityKeyBuilder.section(schoolId, sectionId),
    );

    if (!section) {
      throw new NotFoundException(`Section ${sectionId} not found`);
    }

    // Query all active enrollments for this section via GSI1
    const result = await this.dynamoDBClient.queryGSI<SectionEnrollment>(
      client,
      'GSI1',
      GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
      `SEC_ENROLL#${sectionId}#`,
      'begins_with',
      'isActive = :isActive',
      { ':isActive': true },
      undefined,
      500, // Max roster size
    );

    const students: StudentSectionResponseDto[] = result.items.map(e => ({
      studentId: e.studentId,
      studentName: e.studentName,
      sectionId: e.sectionId,
      enrolledAt: e.enrolledAt,
      enrolledBy: e.enrolledBy,
    }));

    return {
      sectionId,
      courseName: section.courseName,
      sectionNumber: section.sectionNumber,
      students,
      totalCount: students.length,
    };
  }

  /**
   * Get all sections a student is enrolled in (for a given academic year)
   */
  async getStudentSections(
    studentId: string,
    academicYearId: string,
    context: RequestContext,
  ): Promise<StudentSectionResponseDto[]> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const result = await this.dynamoDBClient.queryGSI<SectionEnrollment>(
      client,
      'GSI2',
      studentId,
      `SEC_ENROLL#${academicYearId}#`,
      'begins_with',
      'isActive = :isActive',
      { ':isActive': true },
      undefined,
      100,
    );

    return result.items.map(e => ({
      studentId: e.studentId,
      studentName: e.studentName,
      sectionId: e.sectionId,
      enrolledAt: e.enrolledAt,
      enrolledBy: e.enrolledBy,
    }));
  }
}
