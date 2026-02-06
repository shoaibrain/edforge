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
} from '@edforge/shared-types';

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

    // Validate section exists and is active
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

    // Check if student is already enrolled
    const existingEnrollment = await this.dynamoDBClient.getItem<SectionEnrollment>(
      client,
      context.tenantId,
      sectionEnrollmentKey(schoolId, sectionId, studentId),
    );

    if (existingEnrollment && existingEnrollment.isActive) {
      throw new ConflictException(
        `Student ${studentId} is already enrolled in section ${sectionId}`,
      );
    }

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
        enrolledBy: context.userId,
      },
    );

    // Write enrollment record
    await this.dynamoDBClient.putItem(client, enrollment);

    // Atomically increment section enrollment counter
    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      EntityKeyBuilder.section(schoolId, sectionId),
      'SET currentEnrollment = currentEnrollment + :inc, updatedAt = :updatedAt',
      {
        ':inc': 1,
        ':updatedAt': new Date().toISOString(),
      },
    );

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

    // Soft-delete the enrollment
    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      enrollmentKey,
      'SET isActive = :isActive, droppedAt = :droppedAt, droppedBy = :droppedBy, dropReason = :dropReason, updatedAt = :updatedAt, updatedBy = :updatedBy',
      {
        ':isActive': false,
        ':droppedAt': now,
        ':droppedBy': context.userId,
        ':dropReason': reason || 'dropped',
        ':updatedAt': now,
        ':updatedBy': context.userId,
      },
    );

    // Atomically decrement section enrollment counter
    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      EntityKeyBuilder.section(schoolId, sectionId),
      'SET currentEnrollment = currentEnrollment - :dec, updatedAt = :updatedAt',
      {
        ':dec': 1,
        ':updatedAt': now,
      },
    );

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
