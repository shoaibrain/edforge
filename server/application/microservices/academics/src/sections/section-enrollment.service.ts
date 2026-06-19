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
  ForbiddenException,
} from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { DataScopeService } from '../common/services/data-scope.service';
import {
  CourseSection,
  HOMEROOM_SECTION_COURSE_KEY,
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

/**
 * Aggregate result of a bulk homeroom assignment. `assigned` counts both
 * fresh assignments and idempotent re-assignments of students already in this
 * homeroom; `skipped` lists students that were not (re)assigned, each with a
 * reason ('already in a homeroom' or 'homeroom full').
 */
export interface BulkHomeroomAssignResult {
  assigned: number;
  skipped: Array<{ studentId: string; reason: string }>;
}

@Injectable()
export class SectionEnrollmentService {
  private readonly logger = new Logger(SectionEnrollmentService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: AcademicsEventsService,
    private readonly dataScopeService: DataScopeService,
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
    this.logger.debug(`enrollStudent: entry, sectionId=${sectionId}, schoolId=${schoolId}, studentId=${studentId}`);
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

    // Write authorization: Teacher can only enroll students in their own sections
    const scope = await this.dataScopeService.resolveScope(context.userId, schoolId, context);
    if (!this.dataScopeService.isSectionInScope(scope, sectionId)) {
      throw new ForbiddenException('You do not have access to enroll students in this section');
    }

    // Validate student exists (SP4-3)
    const student = await this.dynamoDBClient.getItem<{ entityType: string; firstName?: string; lastName?: string; status?: string; studentNumber?: string; currentGradeLevel?: string }>(
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

    // Validate student has active annual enrollment for this school/year (SP4-3, SP5-1)
    const annualEnrollment = await this.dynamoDBClient.getItem<{
      entityType: string;
      status?: string;
      entryDate?: string;
      exitWithdrawDate?: string;
      enrollmentDate?: string;
      withdrawalDate?: string;
    }>(
      client,
      context.tenantId,
      EntityKeyBuilder.enrollment(schoolId, section.academicYearId, studentId),
    );
    if (!annualEnrollment) {
      throw new BadRequestException(
        `Student must have an active enrollment at school ${schoolId} in academic year ${section.academicYearId}`,
      );
    }

    // Verify enrollment is in an active status (not withdrawn/transferred/graduated)
    const activeStatuses = ['enrolled', 'active', 'pending'];
    if (annualEnrollment.status && !activeStatuses.includes(annualEnrollment.status)) {
      throw new BadRequestException(
        `Student ${studentId} has a "${annualEnrollment.status}" enrollment and cannot be rostered into a section`,
      );
    }

    // Verify enrollment date range is current (not past-exited)
    const exitDate = annualEnrollment.exitWithdrawDate || annualEnrollment.withdrawalDate;
    if (exitDate) {
      const today = new Date().toISOString().split('T')[0];
      if (exitDate < today) {
        throw new BadRequestException(
          `Student ${studentId}'s enrollment ended on ${exitDate} and cannot be rostered into a section`,
        );
      }
    }

    this.logger.debug(`enrollStudent: validation passed, sectionId=${sectionId}, studentId=${studentId}, currentEnrollment=${section.currentEnrollment}, maxEnrollment=${section.maxEnrollment}`);

    // Build student display name for denormalization
    const studentName = student.firstName && student.lastName
      ? `${student.firstName} ${student.lastName}`
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
        studentNumber: student.studentNumber,
        currentGradeLevel: student.currentGradeLevel,
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

    this.logger.debug(`enrollStudent: transaction committed, sectionId=${sectionId}, studentId=${studentId}, courseId=${section.courseId}`);
    this.logger.log(
      `Student ${studentId} enrolled in section ${sectionId} (${section.courseCode}-${section.sectionNumber})`,
    );

    return {
      studentId: enrollment.studentId,
      studentName: enrollment.studentName,
      studentNumber: enrollment.studentNumber,
      currentGradeLevel: enrollment.currentGradeLevel,
      sectionId: enrollment.sectionId,
      enrolledAt: enrollment.enrolledAt,
      enrolledBy: enrollment.enrolledBy,
    };
  }

  /**
   * Assign a student to a HOMEROOM section (S3.T4).
   *
   * Homeroom-only counterpart to enrollStudent: besides the roster row + the
   * section counter, it stamps the student's annual Enrollment with the homeroom
   * pointer (sectionId + homeroomTeacherId) — all in ONE transaction, so the
   * roster, the counter, and the pointer never drift apart. The generic
   * enrollStudent path is intentionally left untouched.
   */
  async assignToHomeroom(
    sectionId: string,
    schoolId: string,
    studentId: string,
    context: RequestContext,
  ): Promise<StudentSectionResponseDto> {
    this.logger.debug(`assignToHomeroom: entry, sectionId=${sectionId}, schoolId=${schoolId}, studentId=${studentId}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const tableName = this.dynamoDBClient.getTableName();

    const section = await this.dynamoDBClient.getItem<CourseSection>(
      client,
      context.tenantId,
      EntityKeyBuilder.section(schoolId, sectionId),
    );
    if (!section) {
      throw new NotFoundException(`Section ${sectionId} not found`);
    }
    if (section.sectionType !== 'homeroom') {
      throw new BadRequestException(
        `Section ${sectionId} is not a homeroom; use POST /sections/${sectionId}/students for subject-section enrollment`,
      );
    }
    if (!section.isActive) {
      throw new BadRequestException(`Homeroom ${sectionId} is inactive`);
    }
    if (section.currentEnrollment >= section.maxEnrollment) {
      throw new BadRequestException(
        `Homeroom ${sectionId} is at capacity (${section.maxEnrollment}/${section.maxEnrollment})`,
      );
    }

    const scope = await this.dataScopeService.resolveScope(context.userId, schoolId, context);
    if (!this.dataScopeService.isSectionInScope(scope, sectionId)) {
      throw new ForbiddenException('You do not have access to assign students to this homeroom');
    }

    const student = await this.dynamoDBClient.getItem<{ entityType: string; firstName?: string; lastName?: string; status?: string; studentNumber?: string; currentGradeLevel?: string }>(
      client,
      context.tenantId,
      EntityKeyBuilder.student(studentId),
    );
    if (!student) {
      throw new NotFoundException(`Student ${studentId} not found`);
    }
    if (student.status === 'inactive' || student.status === 'withdrawn') {
      throw new BadRequestException(`Student ${studentId} is ${student.status} and cannot be assigned`);
    }

    const enrollmentEntityKey = EntityKeyBuilder.enrollment(schoolId, section.academicYearId, studentId);
    const annualEnrollment = await this.dynamoDBClient.getItem<{ entityType: string; status?: string; sectionId?: string }>(
      client,
      context.tenantId,
      enrollmentEntityKey,
    );
    if (!annualEnrollment) {
      throw new BadRequestException(
        `Student must have an active enrollment at school ${schoolId} in academic year ${section.academicYearId} before being assigned a homeroom`,
      );
    }
    const activeStatuses = ['enrolled', 'active', 'pending'];
    if (annualEnrollment.status && !activeStatuses.includes(annualEnrollment.status)) {
      throw new BadRequestException(
        `Student ${studentId} has a "${annualEnrollment.status}" enrollment and cannot be assigned a homeroom`,
      );
    }
    // One homeroom per student: block silently moving a student already in a
    // different homeroom (a move is drop-then-assign), so they can't end up in
    // two homeroom rosters behind a single pointer.
    if (annualEnrollment.sectionId && annualEnrollment.sectionId !== sectionId) {
      throw new ConflictException(
        `Student ${studentId} is already assigned to homeroom ${annualEnrollment.sectionId}; drop them from it before assigning a new homeroom`,
      );
    }

    const studentName = student.firstName && student.lastName
      ? `${student.firstName} ${student.lastName}`
      : undefined;

    const enrollment = createSectionEnrollmentEntity(
      context.tenantId,
      schoolId,
      sectionId,
      studentId,
      {
        // Homerooms have no subject course; the roster row carries the sentinel
        // (the courseId field is informational here, not part of any key).
        courseId: section.courseId ?? HOMEROOM_SECTION_COURSE_KEY,
        academicYearId: section.academicYearId,
        sectionNumber: section.sectionNumber,
        studentName,
        studentNumber: student.studentNumber,
        currentGradeLevel: student.currentGradeLevel,
        enrolledBy: context.userId,
      },
    );

    const now = new Date().toISOString();

    // One transaction: roster row + homeroom counter + annual-Enrollment pointer.
    try {
      await this.dynamoDBClient.transactWrite(client, [
        {
          Put: {
            TableName: tableName,
            Item: enrollment,
            ConditionExpression: 'attribute_not_exists(entityKey) OR isActive = :false',
            ExpressionAttributeValues: { ':false': false },
          },
        },
        {
          Update: {
            TableName: tableName,
            Key: {
              tenantId: context.tenantId,
              entityKey: EntityKeyBuilder.section(schoolId, sectionId),
            },
            UpdateExpression: 'SET currentEnrollment = currentEnrollment + :inc, updatedAt = :updatedAt',
            ConditionExpression: 'currentEnrollment < maxEnrollment AND isActive = :true',
            ExpressionAttributeValues: { ':inc': 1, ':updatedAt': now, ':true': true },
          },
        },
        {
          // Stamp the student's annual Enrollment with the homeroom pointer (S3.T1).
          Update: {
            TableName: tableName,
            Key: { tenantId: context.tenantId, entityKey: enrollmentEntityKey },
            UpdateExpression: 'SET sectionId = :homeroomId, homeroomTeacherId = :homeroomTeacher, updatedAt = :updatedAt, updatedBy = :updatedBy',
            ConditionExpression: 'attribute_exists(entityKey)',
            ExpressionAttributeValues: {
              ':homeroomId': sectionId,
              ':homeroomTeacher': section.primaryTeacherId,
              ':updatedAt': now,
              ':updatedBy': context.userId,
            },
          },
        },
      ]);
    } catch (error: any) {
      if (error.name === 'TransactionCanceledException') {
        const reasons = error.CancellationReasons || [];
        if (reasons[0]?.Code === 'ConditionalCheckFailed') {
          throw new ConflictException(`Student ${studentId} is already in homeroom ${sectionId}`);
        }
        if (reasons[1]?.Code === 'ConditionalCheckFailed') {
          throw new BadRequestException(`Homeroom ${sectionId} is at capacity or inactive`);
        }
        if (reasons[2]?.Code === 'ConditionalCheckFailed') {
          throw new BadRequestException(`Student ${studentId}'s enrollment record changed concurrently; retry`);
        }
      }
      throw error;
    }

    this.logger.log(`Student ${studentId} assigned to homeroom ${sectionId} (teacher ${section.primaryTeacherId})`);

    return {
      studentId: enrollment.studentId,
      studentName: enrollment.studentName,
      studentNumber: enrollment.studentNumber,
      currentGradeLevel: enrollment.currentGradeLevel,
      sectionId: enrollment.sectionId,
      enrolledAt: enrollment.enrolledAt,
      enrolledBy: enrollment.enrolledBy,
    };
  }

  /**
   * Bulk-assign many students to a single homeroom.
   *
   * Loops the per-student `assignToHomeroom` transaction rather than batching:
   * DynamoDB transactWrite caps at 100 items AND forbids two ops on the same
   * item, so a single transaction can't atomically touch N students' roster
   * rows + the one shared section counter (the counter would be written N
   * times in one transaction). Each student therefore keeps its own atomic
   * 3-item transaction; this method only orchestrates the loop and aggregates.
   *
   * Per-student outcomes:
   * - success → counts toward `assigned`.
   * - already in THIS homeroom (idempotent re-assign) → the per-student Put
   *   conflict surfaces as ConflictException with the THIS-homeroom message;
   *   counted as `assigned` (no-op success, not a batch error).
   * - already in a DIFFERENT homeroom → recorded in `skipped`, loop CONTINUES.
   * - homeroom at capacity → recorded in `skipped`, loop STOPS (every
   *   remaining student would hit the same full homeroom).
   */
  async bulkAssignToHomeroom(
    sectionId: string,
    schoolId: string,
    studentIds: string[],
    context: RequestContext,
  ): Promise<BulkHomeroomAssignResult> {
    this.logger.debug(`bulkAssignToHomeroom: entry, sectionId=${sectionId}, schoolId=${schoolId}, count=${studentIds.length}`);
    const skipped: Array<{ studentId: string; reason: string }> = [];
    let assigned = 0;

    for (let i = 0; i < studentIds.length; i++) {
      const studentId = studentIds[i];
      try {
        await this.assignToHomeroom(sectionId, schoolId, studentId, context);
        assigned++;
      } catch (error) {
        if (error instanceof ConflictException) {
          const message = error.message;
          // Already in THIS homeroom is an idempotent no-op success, not a
          // batch error. Already in a DIFFERENT homeroom is a real skip.
          if (message.includes(`already in homeroom ${sectionId}`)) {
            assigned++;
            continue;
          }
          skipped.push({ studentId, reason: 'already in a homeroom' });
          continue;
        }
        if (error instanceof BadRequestException && error.message.includes('at capacity')) {
          // The homeroom is full — every remaining student would fail the same
          // way, so stop and report the unprocessed tail as skipped.
          skipped.push({ studentId, reason: 'homeroom full' });
          for (let j = i + 1; j < studentIds.length; j++) {
            skipped.push({ studentId: studentIds[j], reason: 'homeroom full' });
          }
          break;
        }
        throw error;
      }
    }

    this.logger.log(`bulkAssignToHomeroom: sectionId=${sectionId} assigned=${assigned} skipped=${skipped.length}`);
    return { assigned, skipped };
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
    this.logger.debug(`dropStudent: entry, sectionId=${sectionId}, schoolId=${schoolId}, studentId=${studentId}`);
    // Write authorization: Teacher can only drop students from their own sections
    const scope = await this.dataScopeService.resolveScope(context.userId, schoolId, context);
    if (!this.dataScopeService.isSectionInScope(scope, sectionId)) {
      throw new ForbiddenException('You do not have access to drop students from this section');
    }

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

    // Atomic transaction: soft-delete enrollment + decrement counter.
    const txItems: NonNullable<Parameters<DynamoDBClientService['transactWrite']>[1]> = [
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
    ];

    // Homeroom drop: also clear the annual Enrollment's homeroom pointer so the
    // documented move workflow (move = drop-then-assign) isn't blocked by
    // assignToHomeroom's one-homeroom guard. Gated on the roster row's sentinel
    // courseId (free) and applied ONLY when this section is the student's current
    // homeroom pointer — a subject-section drop must never touch it.
    if (enrollment.courseId === HOMEROOM_SECTION_COURSE_KEY && enrollment.academicYearId) {
      const annualEnrollmentKey = EntityKeyBuilder.enrollment(schoolId, enrollment.academicYearId, studentId);
      const annualEnrollment = await this.dynamoDBClient.getItem<{ sectionId?: string }>(
        client, context.tenantId, annualEnrollmentKey,
      );
      if (annualEnrollment?.sectionId === sectionId) {
        txItems.push({
          Update: {
            TableName: tableName,
            Key: { tenantId: context.tenantId, entityKey: annualEnrollmentKey },
            UpdateExpression: 'REMOVE sectionId, homeroomTeacherId SET updatedAt = :updatedAt, updatedBy = :updatedBy',
            ConditionExpression: 'sectionId = :droppedSectionId',
            ExpressionAttributeValues: {
              ':updatedAt': now,
              ':updatedBy': context.userId,
              ':droppedSectionId': sectionId,
            },
          },
        });
      }
    }

    try {
      await this.dynamoDBClient.transactWrite(client, txItems);
    } catch (error: any) {
      if (error.name === 'TransactionCanceledException') {
        const reasons = error.CancellationReasons || [];
        // Leg 0 = enrollment soft-delete (isActive guard); leg 2 = homeroom
        // pointer clear (sectionId guard). Either failing means the enrollment
        // changed concurrently between the read and the write — surface a
        // retryable Conflict instead of an unhandled 500.
        if (reasons[0]?.Code === 'ConditionalCheckFailed' || reasons[2]?.Code === 'ConditionalCheckFailed') {
          throw new ConflictException(
            `Student ${studentId}'s enrollment in section ${sectionId} changed concurrently; retry`,
          );
        }
      }
      throw error;
    }

    this.logger.debug(`dropStudent: transaction committed, sectionId=${sectionId}, studentId=${studentId}`);
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
    this.logger.debug(`getSectionRoster: entry, sectionId=${sectionId}, schoolId=${schoolId}`);
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
      studentNumber: e.studentNumber,
      currentGradeLevel: e.currentGradeLevel,
      sectionId: e.sectionId,
      enrolledAt: e.enrolledAt,
      enrolledBy: e.enrolledBy,
    }));

    this.logger.debug(`getSectionRoster: resultCount=${students.length}, sectionId=${sectionId}`);

    return {
      sectionId,
      courseName: section.courseName,
      sectionNumber: section.sectionNumber,
      students,
      totalCount: students.length,
    };
  }

  /**
   * Get all sections a student is enrolled in (for a given academic year).
   * Enriches each enrollment with section details (course name, teacher, room).
   */
  async getStudentSections(
    studentId: string,
    academicYearId: string,
    context: RequestContext,
  ): Promise<StudentSectionResponseDto[]> {
    this.logger.debug(`getStudentSections: entry, studentId=${studentId}, academicYearId=${academicYearId}`);
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

    this.logger.debug(`getStudentSections: enrollmentsFound=${result.items.length}, studentId=${studentId}, academicYearId=${academicYearId}`);

    // Resolve section details in parallel for each enrollment.
    // Primary source: CourseSection entity (live data).
    // Fallback: denormalized fields on SectionEnrollment (snapshot at enrollment time).
    const enriched = await Promise.all(
      result.items.map(async (e) => {
        let courseName: string | undefined = e.courseName;
        let sectionName: string | undefined = e.sectionNumber ? `Section ${e.sectionNumber}` : undefined;
        let teacherName: string | undefined;
        let roomNumber: string | undefined;

        try {
          const entityKey = EntityKeyBuilder.section(e.schoolId, e.sectionId);
          const section = await this.dynamoDBClient.getItem<CourseSection>(
            client,
            context.tenantId,
            entityKey,
          );
          if (section) {
            courseName = section.courseName || courseName;
            sectionName = section.sectionName || `Section ${section.sectionNumber}` || sectionName;
            teacherName = section.primaryTeacherName;
            roomNumber = section.roomNumber || section.locationRoomNumber;
          } else {
            this.logger.debug(
              `Section entity not found for key ${entityKey} (schoolId=${e.schoolId}, sectionId=${e.sectionId}). Using enrollment fallback.`,
            );
          }
        } catch (err: any) {
          this.logger.warn(
            `Failed to resolve section ${e.sectionId} (schoolId=${e.schoolId}): ${err.message}`,
          );
        }

        return {
          studentId: e.studentId,
          studentName: e.studentName,
          studentNumber: e.studentNumber,
          currentGradeLevel: e.currentGradeLevel,
          sectionId: e.sectionId,
          enrolledAt: e.enrolledAt,
          enrolledBy: e.enrolledBy,
          courseId: e.courseId,
          courseCode: e.courseCode,
          courseName,
          sectionName,
          teacherName,
          roomNumber,
        };
      }),
    );

    this.logger.debug(`getStudentSections: enriched, resultCount=${enriched.length}, studentId=${studentId}`);
    return enriched;
  }
}
