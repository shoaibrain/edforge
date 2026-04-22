/**
 * Students Service - Student management
 * 
 * ARCHITECTURE: Uses application-level tenant isolation.
 * All queries use tenantId from JWT context as partition key.
 * School validation requires Identity service call.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import {
  Student,
  createStudentEntity,
  Guardian,
} from '../common/entities/student.entity';
import { SectionEnrollment } from '../common/entities/section-enrollment.entity';
import { CourseSection } from '../common/entities/course.entity';
import { 
  EntityKeyBuilder, 
  GSIKeyBuilder,
  RequestContext,
  PaginatedResult,
} from '../common/entities/base.entity';
import {
  CreateStudentDto,
  UpdateStudentDto,
  StudentResponseDto,
  StudentProfileResponseDto,
} from '@aibrains/shared-types';
import {
  studentEntityToDto,
  studentEntityToProfileDto,
  createStudentDtoToEntity,
  updateStudentDtoToEntity,
} from '../common/mappers';
import { EnrollmentService } from '../enrollment/enrollment.service';
import { AttendanceService } from '../attendance/attendance.service';
import { StudentIdService } from './student-id.service';
import { DataScopeService } from '../common/services/data-scope.service';
import { normalizeGender } from '../common/utils/import-normalize';
import {
  transformIemisRow,
  IemisRow,
  IemisFinding,
  IemisTransformResult,
} from './iemis-transform';

// Type alias for backward compatibility with controller
export type StudentProfileDto = StudentProfileResponseDto;

@Injectable()
export class StudentsService {
  private readonly logger = new Logger(StudentsService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: AcademicsEventsService,
    private readonly identityClient: IdentityClientService,
    private readonly studentIdService: StudentIdService,
    private readonly dataScopeService: DataScopeService,
    @Inject(forwardRef(() => EnrollmentService))
    private readonly enrollmentService: EnrollmentService,
    @Inject(forwardRef(() => AttendanceService))
    private readonly attendanceService: AttendanceService,
  ) {}

  /**
   * Create a new student
   * 
   * VALIDATION: Validates school exists in Identity service before creation
   * What would be the other checkeks and validations that we need to do before creating a student?
   * what happens if the student already exists?
   * What happens if School does not exist?
   */
  async createStudent(
    createStudentDto: CreateStudentDto,
    context: RequestContext
  ): Promise<StudentResponseDto> {
    this.logger.debug(`createStudent: entry, schoolId=${createStudentDto.schoolId}`);

    // BASIC CRITICAL: fetch the school from identity service. Two jobs in one call:
    //   1. Existence check (getSchool throws NotFoundException on 404 — fail-closed
    //      by default, unlike the older validateSchoolExists helper which was
    //      fail-open on transient errors).
    //   2. Pull `schoolCode` so `studentNumber` prefixes use the real code
    //      (e.g. `SEBS-2026-00001`) instead of the UUID-slice fallback that
    //      produced `6D0-2026-00001`-style IDs in prod.
    const school = await this.identityClient.getSchool(createStudentDto.schoolId, {
      tenantId: context.tenantId,
      userId: context.userId,
      jwtToken: context.jwtToken,
      userRole: context.role,
      userName: context.username,
    });

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const now = new Date().toISOString();
    const studentId = uuid();
    const studentNumber = createStudentDto.studentNumber || await this.studentIdService.generateStudentUniqueId(
      context.tenantId,
      createStudentDto.schoolId,
      school.schoolCode,
      context.jwtToken,
    );

    this.logger.debug(`createStudent: generated studentNumber=${studentNumber}, studentId=${studentId}`);

    // Validate student number uniqueness within the school
    if (createStudentDto.studentNumber) {
      await this.validateStudentNumberUnique(client, context.tenantId, createStudentDto.schoolId, studentNumber);
    }

    // Validate emisStudentId uniqueness within tenant (when provided).
    // GSI7 is the lookup index — see ecs-dynamodb.ts. If the GSI has not yet
    // reached ACTIVE status during a fresh deploy, this query will fail; the
    // IEMIS import pipeline (P0.6) is the only caller that provides this field
    // at scale and runs after GSI7 is ACTIVE.
    if (createStudentDto.emisStudentId) {
      const existing = await this.findByEmisStudentId(
        context.tenantId,
        createStudentDto.emisStudentId,
        context.jwtToken,
      );
      if (existing) {
        throw new ConflictException(
          `Student with emisStudentId=${createStudentDto.emisStudentId} already exists (studentId=${existing.studentId})`,
        );
      }
    }

    // Convert DTO to entity fields using mapper
    const entityData = createStudentDtoToEntity(createStudentDto);

    // Prepare guardians with IDs (from DTO guardians)
    const guardians: Guardian[] = (entityData.guardians || []).map((g, index) => ({
      ...g,
      guardianId: g.guardianId || uuid(),
      isPrimary: g.isPrimary ?? index === 0,
      hasPortalAccess: g.hasPortalAccess ?? false,
    }));

    const student = createStudentEntity(
      context.tenantId,
      studentId,
      createStudentDto.schoolId,
      {
        // Explicitly set required fields first
        firstName: createStudentDto.firstName,
        lastName: createStudentDto.lastName,
        dateOfBirth: createStudentDto.dateOfBirth,
        gender: createStudentDto.gender,
        currentGradeLevel: createStudentDto.currentGradeLevel,
        // Then spread optional entity data
        middleName: entityData.middleName,
        preferredName: entityData.preferredName,
        email: entityData.email,
        phone: entityData.phone,
        address: entityData.address,
        emergencyContact: entityData.emergencyContact,
        medicalInfo: entityData.medicalInfo,
        specialPrograms: entityData.specialPrograms,
        accommodations: entityData.accommodations,
        // Override with service-specific values
        studentNumber,
        emisStudentId: entityData.emisStudentId,
        guardians,
        primarySchoolId: createStudentDto.schoolId,
        status: 'pending',
        enrollmentDate: undefined,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );

    await this.dynamoDBClient.putItem(client, student);

    this.logger.debug(`createStudent: student persisted, studentId=${studentId}, schoolId=${createStudentDto.schoolId}`);
    this.logger.log(`Student created: ${student.firstName} ${student.lastName} (${studentId})`);

    // Publish student created event (non-blocking)
    this.eventsService.publishStudentCreated(
      context.tenantId,
      studentId,
      createStudentDto.schoolId,
      createStudentDto.firstName,
      createStudentDto.lastName,
      createStudentDto.currentGradeLevel,
      'pending',
    ).catch(err => this.logger.error('Failed to publish StudentCreated event', err));

    // Provision portal accounts for guardians with hasPortalAccess and student if email provided (non-blocking)
    this.provisionPortalAccounts(
      studentId,
      createStudentDto.schoolId,
      guardians,
      createStudentDto.firstName,
      createStudentDto.lastName,
      createStudentDto.contactInfo?.email,
      context,
    ).catch((err: any) => this.logger.error('Failed to provision portal accounts', err));

    return this.toStudentResponse(student);
  }

  /**
   * Get student by ID
   */
  async getStudent(
    studentId: string,
    context: RequestContext,
    schoolId?: string,
  ): Promise<StudentResponseDto> {
    this.logger.debug(`getStudent: entry, studentId=${studentId}, schoolId=${schoolId || 'not provided'}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const student = await this.dynamoDBClient.getItem<Student>(
      client,
      context.tenantId,
      EntityKeyBuilder.student(studentId)
    );

    if (!student) {
      this.logger.debug(`getStudent: not found, studentId=${studentId}`);
      throw new NotFoundException('Student not found');
    }

    // Row-level security: verify student is in user's data scope
    const resolvedSchoolId = schoolId || student.primarySchoolId;
    if (resolvedSchoolId) {
      const scope = await this.dataScopeService.resolveScope(context.userId, resolvedSchoolId, context);
      if (!this.dataScopeService.isStudentInScope(scope, studentId)) {
        this.logger.debug(`getStudent: studentId=${studentId} out of scope for userId=${context.userId}`);
        throw new NotFoundException('Student not found');
      }
    }

    this.logger.debug(`getStudent: found, studentId=${studentId}`);
    return this.toStudentResponse(student);
  }

  /**
   * List students for a school
   */
  async listStudents(
    schoolId: string,
    context: RequestContext,
    limit: number = 50,
    lastEvaluatedKey?: string,
    filters?: {
      gradeLevel?: string;
      status?: string;
      search?: string;
    }
  ): Promise<PaginatedResult<StudentResponseDto>> {
    this.logger.debug(
      `listStudents: entry, schoolId=${schoolId}, limit=${limit}, hasSearch=${!!filters?.search}, scopeFilters=${JSON.stringify({ gradeLevel: filters?.gradeLevel, status: filters?.status })}`,
    );

    // Resolve data scope for row-level security (Teacher → section-scoped)
    const scope = await this.dataScopeService.resolveScope(context.userId, schoolId, context);

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    this.logger.debug(`listStudents: scope type=${scope.type}`);

    // Student scope: directly fetch the specific student records by ID.
    // A school-wide GSI scan with limit=N would return the first N students
    // alphabetically, which are then post-filtered by scope — almost certainly
    // excluding the student's own record when N is small (e.g. limit=1).
    if (scope.type === 'student' && scope.studentIds?.length) {
      const items: Student[] = [];
      for (const sid of scope.studentIds) {
        const s = await this.dynamoDBClient.getItem<Student>(
          client, context.tenantId, EntityKeyBuilder.student(sid),
        );
        if (s) items.push(s);
      }
      return {
        items: items.slice(0, limit).map(s => this.toStudentResponse(s)),
        lastEvaluatedKey: undefined,
        hasMore: items.length > limit,
      };
    }

    let exclusiveStartKey: any;
    if (lastEvaluatedKey) {
      try {
        exclusiveStartKey = JSON.parse(Buffer.from(lastEvaluatedKey, 'base64').toString());
      } catch {
        // Invalid key, ignore
      }
    }

    // Query by school using GSI1
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);
    
    // Build filter expression
    let filterExpression = 'entityType = :entityType';
    const expressionValues: Record<string, any> = {
      ':entityType': 'STUDENT',
    };

    if (filters?.gradeLevel) {
      filterExpression += ' AND currentGradeLevel = :gradeLevel';
      expressionValues[':gradeLevel'] = filters.gradeLevel;
    }

    if (filters?.status) {
      filterExpression += ' AND #status = :status';
      expressionValues[':status'] = filters.status;
    }

    // When search filter is active, we need to paginate through DynamoDB internally
    // because DynamoDB's Limit applies before our in-memory search filter, which can
    // return fewer items than requested while more matching items exist in later pages.
    if (filters?.search) {
      const searchLower = filters.search.toLowerCase();
      const matched: Student[] = [];
      let currentStartKey = exclusiveStartKey;
      let lastKey: string | undefined;
      let hasMore = false;

      while (matched.length < limit) {
        const page = await this.dynamoDBClient.queryGSI<Student>(
          client,
          'GSI1',
          gsi1pk,
          'STUDENT#',
          'begins_with',
          filterExpression,
          expressionValues,
          filters?.status ? { '#status': 'status' } : undefined,
          limit,
          true,
          currentStartKey
        );

        const matches = page.items.filter(s =>
          s.firstName.toLowerCase().includes(searchLower) ||
          s.lastName.toLowerCase().includes(searchLower) ||
          s.studentNumber.toLowerCase().includes(searchLower)
        );
        matched.push(...matches);

        if (!page.hasMore) {
          // Exhausted the index
          lastKey = undefined;
          hasMore = false;
          break;
        }

        // Decode the key for the next iteration
        lastKey = page.lastEvaluatedKey;
        hasMore = true;
        currentStartKey = lastKey
          ? JSON.parse(Buffer.from(lastKey, 'base64').toString())
          : undefined;
      }

      // If we collected more than `limit`, trim and keep hasMore true
      const trimmed = matched.slice(0, limit);
      if (matched.length > limit) {
        hasMore = true;
      }

      // Apply data scope filter (Teacher → section-scoped students only)
      const scopedItems = this.dataScopeService.filterByStudentScope(scope, trimmed);

      this.logger.debug(
        `listStudents: search path, preFilter=${trimmed.length}, postFilter=${scopedItems.length}`,
      );

      return {
        items: scopedItems.map(s => this.toStudentResponse(s)),
        lastEvaluatedKey: lastKey,
        hasMore,
      };
    }

    // No search filter — single DynamoDB query is sufficient
    // For section-scoped queries, over-fetch to compensate for post-filter reduction
    const fetchLimit = scope.type === 'section' ? limit * 3 : limit;

    const result = await this.dynamoDBClient.queryGSI<Student>(
      client,
      'GSI1',
      gsi1pk,
      'STUDENT#',
      'begins_with',
      filterExpression,
      expressionValues,
      filters?.status ? { '#status': 'status' } : undefined,
      fetchLimit,
      true,
      exclusiveStartKey
    );

    // Apply data scope filter (Teacher → section-scoped students only)
    const scopedItems = this.dataScopeService.filterByStudentScope(scope, result.items);
    const pagedItems = scopedItems.slice(0, limit);

    return {
      items: pagedItems.map(s => this.toStudentResponse(s)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: scopedItems.length > limit || result.hasMore,
    };
  }

  /**
   * Update student
   */
  async updateStudent(
    studentId: string,
    updateStudentDto: UpdateStudentDto,
    context: RequestContext
  ): Promise<StudentResponseDto> {
    this.logger.debug(`updateStudent: entry, studentId=${studentId}, updatedFields=${Object.keys(updateStudentDto).filter(k => (updateStudentDto as any)[k] !== undefined).join(',')}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const student = await this.dynamoDBClient.getItem<Student>(
      client,
      context.tenantId,
      EntityKeyBuilder.student(studentId)
    );

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    // Convert DTO to entity fields using mapper
    const entityUpdates = updateStudentDtoToEntity(updateStudentDto);
    
    const updates: string[] = [];
    const values: Record<string, any> = {};
    const names: Record<string, string> = {};

    // Apply mapped entity updates
    for (const [key, value] of Object.entries(entityUpdates)) {
      if (value !== undefined) {
        if (key === 'status') {
          updates.push('#status = :status');
          values[':status'] = value;
          names['#status'] = 'status';
          
          if (value === 'withdrawn' || value === 'transferred') {
            updates.push('withdrawalDate = :withdrawalDate');
            values[':withdrawalDate'] = new Date().toISOString().split('T')[0];
          }
        } else if (key === 'guardians' && Array.isArray(value)) {
          updates.push('guardians = :guardians');
          values[':guardians'] = value.map((g: any, i: number) => ({
            ...g,
            guardianId: g.guardianId || uuid(),
            isPrimary: g.isPrimary ?? i === 0,
            hasPortalAccess: g.hasPortalAccess ?? false,
          }));
        } else {
          updates.push(`${key} = :${key}`);
          values[`:${key}`] = value;
        }
      }
    }

    if (updates.length === 0) {
      return this.toStudentResponse(student);
    }

    // Add audit fields
    updates.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy', '#version = #version + :inc');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;
    values[':inc'] = 1;
    names['#version'] = 'version';

    // Update GSI keys if name changed
    if (entityUpdates.firstName || entityUpdates.lastName) {
      const newFirstName = entityUpdates.firstName || student.firstName;
      const newLastName = entityUpdates.lastName || student.lastName;
      updates.push('gsi1sk = :gsi1sk');
      values[':gsi1sk'] = GSIKeyBuilder.entitySort('STUDENT', `${newLastName.toUpperCase()}#${newFirstName.toUpperCase()}`);
    }

    const updatedStudent = await this.dynamoDBClient.updateItem<Student>(
      client,
      context.tenantId,
      EntityKeyBuilder.student(studentId),
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      Object.keys(names).length > 0 ? names : undefined
    );

    this.logger.log(`Student updated: ${studentId}`);

    // Publish student updated event (non-blocking)
    const updatedFields = Object.keys(updateStudentDto).filter(k => (updateStudentDto as any)[k] !== undefined);
    this.eventsService.publishStudentUpdated(
      context.tenantId,
      studentId,
      student.primarySchoolId,
      updatedFields
    ).catch(err => this.logger.error('Failed to publish StudentUpdated event', err));

    return this.toStudentResponse(updatedStudent);
  }

  /**
   * Delete student (soft delete)
   */
  async deleteStudent(
    studentId: string,
    context: RequestContext
  ): Promise<void> {
    this.logger.debug(`deleteStudent: entry, studentId=${studentId}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const student = await this.dynamoDBClient.getItem<Student>(
      client,
      context.tenantId,
      EntityKeyBuilder.student(studentId)
    );

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    // Cascade check: block if active section enrollments exist
    const activeEnrollments = await this.dynamoDBClient.queryGSI<any>(
      client,
      'GSI2',
      studentId,
      'SEC_ENROLL#',
      'begins_with',
      'isActive = :isActive',
      { ':isActive': true },
      undefined,
      1,
    );

    if (activeEnrollments.items.length > 0) {
      throw new BadRequestException(
        'Cannot deactivate student with active section enrollments. Drop all enrollments first.',
      );
    }

    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      EntityKeyBuilder.student(studentId),
      'SET #status = :status, updatedAt = :updatedAt, updatedBy = :updatedBy',
      {
        ':status': 'inactive',
        ':updatedAt': new Date().toISOString(),
        ':updatedBy': context.userId,
      },
      undefined,
      { '#status': 'status' }
    );

    this.logger.log(`Student deleted (soft): ${studentId}`);
  }

  /**
   * Get student profile with aggregated data
   */
  async getStudentProfile(
    studentId: string,
    context: RequestContext,
    schoolId?: string,
  ): Promise<StudentProfileDto> {
    this.logger.debug(`getStudentProfile: entry, studentId=${studentId}, schoolId=${schoolId || 'not provided'}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Get student entity directly
    const studentEntity = await this.dynamoDBClient.getItem<Student>(
      client,
      context.tenantId,
      EntityKeyBuilder.student(studentId)
    );

    if (!studentEntity) {
      throw new NotFoundException('Student not found');
    }

    // Row-level security: verify student is in user's data scope
    const resolvedSchoolId = schoolId || studentEntity.primarySchoolId;
    if (resolvedSchoolId) {
      const scope = await this.dataScopeService.resolveScope(context.userId, resolvedSchoolId, context);
      if (!this.dataScopeService.isStudentInScope(scope, studentId)) {
        throw new NotFoundException('Student not found');
      }
    }
    
    // Get enrollment history
    const enrollments = await this.enrollmentService.getStudentEnrollmentHistory(studentId, context);
    
    // Find current/most recent enrollment (enrolled is the active status)
    const currentEnrollmentDto = enrollments.find(e => e.status === 'enrolled' || e.status === 'active') || enrollments[0];
    
    // Build current enrollment object for profile
    const currentEnrollment = currentEnrollmentDto ? {
      enrollmentId: currentEnrollmentDto.enrollmentId,
      academicYearId: currentEnrollmentDto.academicYearId,
      academicYearName: currentEnrollmentDto.academicYearName,
      gradeLevel: currentEnrollmentDto.gradeLevel,
      enrollmentDate: currentEnrollmentDto.enrollmentDate,
      status: currentEnrollmentDto.status,
      homeroomId: currentEnrollmentDto.homeroomId,
      homeroomName: currentEnrollmentDto.homeroomName,
    } : undefined;

    // Build enrollment history for profile
    const enrollmentHistory = enrollments.map(e => ({
      enrollmentId: e.enrollmentId,
      academicYearId: e.academicYearId,
      academicYearName: e.academicYearName,
      gradeLevel: e.gradeLevel,
      schoolId: e.schoolId,
      schoolName: e.schoolName,
      enrollmentDate: e.enrollmentDate,
      withdrawalDate: e.withdrawalDate,
      status: e.status,
    }));
    
    // Get attendance summary for current enrollment
    let attendanceSummary: { totalDays: number; present: number; absent: number; late: number; excused: number; attendanceRate: number } | undefined;
    if (currentEnrollmentDto) {
      try {
        // Calculate date range for current year (use enrollment date to now)
        const startDate = currentEnrollmentDto.enrollmentDate;
        const endDate = new Date().toISOString().split('T')[0];
        
        const attSummary = await this.attendanceService.getStudentAttendanceSummary(
          studentId,
          currentEnrollmentDto.schoolId,
          currentEnrollmentDto.academicYearId,
          startDate,
          endDate,
          context
        );
        attendanceSummary = {
          totalDays: attSummary.totalDays,
          present: attSummary.present,
          absent: attSummary.absent,
          late: attSummary.late,
          excused: attSummary.excused,
          attendanceRate: attSummary.attendanceRate,
        };
      } catch (error) {
        // Attendance may not be available, continue without it
        this.logger.debug(`No attendance data for student ${studentId}`);
      }
    }

    // Get student's current class sections (StudentSectionAssociations)
    let classrooms: Array<{ classroomId: string; name: string; subject?: string; teacherName?: string }> | undefined;
    if (currentEnrollmentDto) {
      try {
        const sectionEnrollments = await this.dynamoDBClient.queryGSI<SectionEnrollment>(
          client,
          'GSI2',
          studentId,
          `SEC_ENROLL#${currentEnrollmentDto.academicYearId}#`,
          'begins_with',
          'isActive = :isActive',
          { ':isActive': true },
          undefined,
          100,
        );

        if (sectionEnrollments.items.length > 0) {
          // Attempt to resolve teacher names from section entities (best-effort)
          let teacherMap = new Map<string, string | undefined>();
          try {
            const sectionKeys = sectionEnrollments.items.map(se => ({
              tenantId: context.tenantId,
              entityKey: EntityKeyBuilder.section(se.schoolId, se.sectionId),
            }));
            const sections = await this.dynamoDBClient.batchGetItems<CourseSection>(client, sectionKeys);
            teacherMap = new Map(
              sections.map(s => [s.entityKey.split('#').pop()!, s.primaryTeacherName]),
            );
          } catch (err) {
            this.logger.warn(`Failed to resolve teacher names for student ${studentId}: ${err}`);
          }

          classrooms = sectionEnrollments.items.map(se => ({
            classroomId: se.sectionId,
            name: se.sectionNumber || se.sectionId,
            subject: se.courseName,
            teacherName: teacherMap.get(se.sectionId) || undefined,
          }));
        }
      } catch (error) {
        this.logger.debug(`No section enrollment data for student ${studentId}`);
      }
    }

    // Use mapper to create profile response
    return studentEntityToProfileDto(
      studentEntity,
      currentEnrollment,
      enrollmentHistory,
      attendanceSummary,
      classrooms,
    );
  }

  /**
   * Find a student by external EMIS / government ID (GSI7 lookup).
   *
   * Returns the student entity if one exists with this emisStudentId within
   * the tenant, or null if none found. Used by:
   *   - `createStudent` for uniqueness validation before insert.
   *   - IEMIS import pipeline (P0.6) for dedup on re-import.
   *
   * Note: queries GSI7 which is a sparse index — only populated when
   * `emisStudentId` is set on the entity. Returns at most 1 row because
   * emisStudentId is unique-per-tenant (enforced at create time).
   */
  async findByEmisStudentId(
    tenantId: string,
    emisStudentId: string,
    jwtToken: string,
    /**
     * Optional pre-acquired client. When provided, skips the
     * TokenVendingMachine.assumeRole() call (~50ms per acquisition). Callers
     * that invoke this in a hot loop (e.g. `importStudentsIemis` dedup)
     * MUST pass a shared client — otherwise per-call STS auth dominates
     * wall-clock time and causes API-Gateway-adjacent proxy timeouts
     * (see Saraswati-pilot incident 2026-04-21: 779 calls × 55ms/call =
     * 40s, exceeding Vercel's 25s proxy timeout).
     */
    sharedClient?: Awaited<ReturnType<typeof this.dynamoDBClient.getClient>>,
  ): Promise<Student | null> {
    if (!emisStudentId) return null;
    const client = sharedClient ?? (await this.dynamoDBClient.getClient(tenantId, jwtToken));
    const gsi7pk = GSIKeyBuilder.emisStudent(tenantId, emisStudentId);
    const result = await this.dynamoDBClient.queryGSI<Student>(
      client,
      'GSI7',
      gsi7pk,
      undefined,
      'eq',
      undefined,
      undefined,
      undefined,
      1,
    );
    return result.items[0] ?? null;
  }

  /**
   * Validate that school exists in Identity service
   *
   * ARCHITECTURE: Cross-service validation via HTTP client with circuit breaker
   *
   * NOTE (P0.2/P0.4): `createStudent` no longer calls this helper — it calls
   * `identityClient.getSchool` directly to fetch `schoolCode` for the
   * studentNumber prefix, which gives us existence + schoolCode in one call.
   * This helper is retained for callers that only need existence (and for
   * tests that stub the HTTP client). See Step 7 / P0.7 for the fail-closed
   * refactor.
   */
  private async validateSchoolExists(schoolId: string, context: RequestContext): Promise<void> {
    try {
      const exists = await this.identityClient.validateSchoolExists(schoolId, {
        tenantId: context.tenantId,
        userId: context.userId,
        jwtToken: context.jwtToken,
        userRole: context.role,
        userName: context.username,
      });
      
      if (!exists) {
        this.logger.warn('Student creation attempted for non-existent school', {
          schoolId,
          tenantId: context.tenantId,
          userId: context.userId,
        });
        throw new BadRequestException(
          `School ${schoolId} does not exist. Please create the school first.`
        );
      }
    } catch (error: any) {
      // If it's already a BadRequestException, rethrow
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      // For other errors (service unavailable, etc.), log and allow (graceful degradation)
      // In production, you might want to fail closed instead
      this.logger.warn('Unable to validate school existence - proceeding with creation', {
        schoolId,
        tenantId: context.tenantId,
        error: error.message,
      });
    }
  }

  /**
   * Validate that a manually-provided student number is unique within the school.
   */
  private async validateStudentNumberUnique(
    client: any,
    tenantId: string,
    schoolId: string,
    studentNumber: string,
  ): Promise<void> {
    const gsi1pk = GSIKeyBuilder.schoolScope(tenantId, schoolId);

    // Do NOT add limit: N here. DynamoDB applies Limit BEFORE FilterExpression.
    // A limit of 1 reads 1 item from the index, filters it, and may return 0
    // even if matching items exist — producing a false "unique" result.
    const result = await this.dynamoDBClient.queryGSI<Student>(
      client,
      'GSI1',
      gsi1pk,
      'STUDENT#',
      'begins_with',
      'entityType = :entityType AND studentNumber = :studentNumber',
      { ':entityType': 'STUDENT', ':studentNumber': studentNumber },
    );

    if (result.items.length > 0) {
      throw new ConflictException(
        `Student number "${studentNumber}" is already in use at this school`,
      );
    }
  }

  /**
   * Check for duplicate students by firstName, lastName, dateOfBirth.
   * Supports exact and fuzzy matching with confidence levels.
   */
  async checkDuplicate(
    firstName: string,
    lastName: string,
    dateOfBirth: string,
    schoolId: string,
    context: RequestContext
  ): Promise<{ exists: boolean; matches: StudentResponseDto[] }> {
    this.logger.debug(`checkDuplicate: entry, schoolId=${schoolId}`);
    const duplicates = await this.checkDuplicateDetailed(firstName, lastName, dateOfBirth, schoolId, context);
    const allMatches = duplicates.filter(d => d.confidence !== 'low');
    this.logger.debug(`checkDuplicate: matchCount=${allMatches.length} (total candidates=${duplicates.length})`);
    return {
      exists: allMatches.length > 0,
      matches: allMatches.map(d => d.student),
    };
  }

  /**
   * Detailed duplicate check with confidence levels.
   * - high: exact match on firstName + lastName + dateOfBirth
   * - medium: fuzzy name match with same dateOfBirth
   * - low: partial match (same last name + dateOfBirth)
   */
  async checkDuplicateDetailed(
    firstName: string,
    lastName: string,
    dateOfBirth: string,
    schoolId: string,
    context: RequestContext
  ): Promise<Array<{ student: StudentResponseDto; confidence: 'high' | 'medium' | 'low'; reason: string }>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    const result = await this.dynamoDBClient.queryGSI<Student>(
      client,
      'GSI1',
      gsi1pk,
      'STUDENT#',
      'begins_with',
      'entityType = :entityType',
      { ':entityType': 'STUDENT' },
      undefined,
      1000,
    );

    const firstNameLower = firstName.toLowerCase().trim();
    const lastNameLower = lastName.toLowerCase().trim();
    const duplicates: Array<{ student: StudentResponseDto; confidence: 'high' | 'medium' | 'low'; reason: string }> = [];

    for (const s of result.items) {
      const sFirstLower = s.firstName.toLowerCase().trim();
      const sLastLower = s.lastName.toLowerCase().trim();

      if (sFirstLower === firstNameLower && sLastLower === lastNameLower && s.dateOfBirth === dateOfBirth) {
        // Exact match - high confidence
        duplicates.push({
          student: this.toStudentResponse(s),
          confidence: 'high',
          reason: 'Exact match on name and date of birth',
        });
      } else if (s.dateOfBirth === dateOfBirth && sLastLower === lastNameLower) {
        // Same DOB + last name, different first name - could be sibling or typo
        const nameSimilarity = this.calculateSimilarity(firstNameLower, sFirstLower);
        if (nameSimilarity >= 0.7) {
          duplicates.push({
            student: this.toStudentResponse(s),
            confidence: 'medium',
            reason: `Similar first name (${Math.round(nameSimilarity * 100)}% match) with same last name and date of birth`,
          });
        } else {
          duplicates.push({
            student: this.toStudentResponse(s),
            confidence: 'low',
            reason: 'Same last name and date of birth',
          });
        }
      } else if (s.dateOfBirth === dateOfBirth) {
        // Same DOB only - check both names fuzzy
        const firstSim = this.calculateSimilarity(firstNameLower, sFirstLower);
        const lastSim = this.calculateSimilarity(lastNameLower, sLastLower);
        if (firstSim >= 0.8 && lastSim >= 0.8) {
          duplicates.push({
            student: this.toStudentResponse(s),
            confidence: 'medium',
            reason: `Similar name (${Math.round(firstSim * 100)}%/${Math.round(lastSim * 100)}% match) with same date of birth`,
          });
        }
      }
    }

    // Sort by confidence: high first, then medium, then low
    const order = { high: 0, medium: 1, low: 2 };
    duplicates.sort((a, b) => order[a.confidence] - order[b.confidence]);

    return duplicates;
  }

  /**
   * Calculate Levenshtein-based similarity between two strings.
   * Returns value between 0 (completely different) and 1 (identical).
   */
  private calculateSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;

    const maxLen = Math.max(a.length, b.length);
    const distance = this.levenshteinDistance(a, b);
    return 1 - distance / maxLen;
  }

  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        const cost = b[i - 1] === a[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost,
        );
      }
    }
    return matrix[b.length][a.length];
  }

  // ============================================================================
  // CSV IMPORT (Sprint 4 - Task 4.9a)
  // ============================================================================

  /**
   * Bulk import students from parsed CSV rows.
   * Each row is validated against CreateStudentDto schema.
   * Runs de-duplication check per student, flags potential matches.
   *
   * Response: { imported, skipped, errors, duplicates }
   */
  async importStudents(
    rows: Array<Record<string, unknown>>,
    schoolId: string,
    context: RequestContext,
  ): Promise<{
    imported: number;
    skipped: number;
    errors: Array<{ row: number; field: string; message: string }>;
    duplicates: Array<{ row: number; matches: Array<{ studentId: string; name: string; confidence: string }> }>;
  }> {
    this.logger.debug(`importStudents: entry, schoolId=${schoolId}, rowCount=${rows?.length || 0}`);
    if (!rows || rows.length === 0) {
      throw new BadRequestException('No student data provided');
    }
    if (rows.length > 200) {
      throw new BadRequestException('Maximum 200 students per import');
    }

    await this.validateSchoolExists(schoolId, context);

    const errors: Array<{ row: number; field: string; message: string }> = [];
    const duplicates: Array<{ row: number; matches: Array<{ studentId: string; name: string; confidence: string }> }> = [];
    let imported = 0;
    let skipped = 0;

    // ── Phase 1: Validate all rows and build DTOs ──
    const validatedRows: Array<{ rowNum: number; dto: CreateStudentDto }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1; // 1-based for user display

      // Validate required fields
      const firstName = String(row.firstName || '').trim();
      const lastName = String(row.lastName || '').trim();
      const dateOfBirth = String(row.birthDate || row.dateOfBirth || '').trim();
      // Accept M/F/Male/Female/male/female/MALE/FEMALE etc. via the shared
      // normalizer — Saraswati's IEMIS export uses "Male"/"Female" title-case
      // and older legacy exports use "M"/"F", so strict lowercase was a
      // 100%-fail condition before P0.5.
      const gender = normalizeGender(row.gender);
      const gradeLevel = String(row.gradeLevel || row.currentGradeLevel || '').trim();

      if (!firstName) {
        errors.push({ row: rowNum, field: 'firstName', message: 'First name is required' });
        continue;
      }
      if (!lastName) {
        errors.push({ row: rowNum, field: 'lastName', message: 'Last name is required' });
        continue;
      }
      if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
        errors.push({ row: rowNum, field: 'birthDate', message: 'Birth date is required (YYYY-MM-DD format)' });
        continue;
      }
      if (!gender) {
        errors.push({
          row: rowNum,
          field: 'gender',
          message: `Unknown gender value: "${row.gender}". Accepted: M, F, Male, Female, Other, or prefer_not_to_say (case-insensitive).`,
        });
        continue;
      }
      if (!gradeLevel) {
        errors.push({ row: rowNum, field: 'gradeLevel', message: 'Grade level is required' });
        continue;
      }

      // De-duplication check
      try {
        const dupResults = await this.checkDuplicateDetailed(firstName, lastName, dateOfBirth, schoolId, context);
        const highConfidence = dupResults.filter(d => d.confidence === 'high');

        if (highConfidence.length > 0) {
          duplicates.push({
            row: rowNum,
            matches: highConfidence.map(d => ({
              studentId: d.student.studentId,
              name: d.student.fullName,
              confidence: d.confidence,
            })),
          });
          skipped++;
          continue;
        }

        // Flag medium-confidence duplicates but still import
        const mediumConfidence = dupResults.filter(d => d.confidence === 'medium');
        if (mediumConfidence.length > 0) {
          duplicates.push({
            row: rowNum,
            matches: mediumConfidence.map(d => ({
              studentId: d.student.studentId,
              name: d.student.fullName,
              confidence: d.confidence,
            })),
          });
        }
      } catch {
        // If dedup check fails, proceed with import
        this.logger.debug(`De-dup check failed for row ${rowNum}, proceeding`);
      }

      // Build student DTO
      const guardianName = String(row.guardianName || '').trim();
      const guardianPhone = String(row.guardianPhone || '').trim();
      const guardianEmail = String(row.guardianEmail || '').trim();

      validatedRows.push({
        rowNum,
        dto: {
          firstName,
          lastName,
          dateOfBirth,
          gender: gender as 'male' | 'female' | 'other' | 'prefer_not_to_say',
          schoolId,
          currentGradeLevel: gradeLevel,
          guardians: guardianName ? [{
            firstName: guardianName.split(' ')[0] || guardianName,
            lastName: guardianName.split(' ').slice(1).join(' ') || lastName,
            relationship: 'guardian' as const,
            phone: guardianPhone || undefined,
            email: guardianEmail || undefined,
            isPrimary: true,
            hasPortalAccess: false,
            canPickup: true,
          }] : undefined,
        },
      });
    }

    // ── Phase 2: Write validated students in batches of 10 ──
    const BATCH_SIZE = 10;
    for (let batchStart = 0; batchStart < validatedRows.length; batchStart += BATCH_SIZE) {
      const batch = validatedRows.slice(batchStart, batchStart + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(async ({ rowNum, dto }) => {
          await this.createStudent(dto, context);
          return rowNum;
        })
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status === 'fulfilled') {
          imported++;
        } else {
          const { rowNum } = batch[j];
          const message = result.reason?.message || 'Failed to create student';
          errors.push({ row: rowNum, field: 'general', message });
        }
      }
    }

    this.logger.log(`CSV Import: ${imported} imported, ${skipped} skipped, ${errors.length} errors, ${duplicates.length} duplicate flags`);

    return { imported, skipped, errors, duplicates };
  }

  /**
   * Bulk import students from IEMIS (Nepal government EMIS) CSV rows.
   *
   * Project Midnight Lockin P0.6 — PABSON pilot for Saraswati English
   * Boarding School (779 rows).
   *
   * Flow:
   *   1. Validate row-count cap (max 1000 per request for IEMIS)
   *   2. Fetch the destination school (via identity client) to get
   *      `emisSchoolCode` for row-level mismatch warnings.
   *   3. Phase 1: transform every row in memory (pure, no I/O).
   *   4. Phase 2: dedup transformed rows against existing EMIS student IDs
   *      via GSI7 (O(N) queries, not O(N²) scans — a dramatic improvement
   *      over the generic importer's FN+LN+DOB dedup).
   *   5. Phase 3 (unless dryRun): persist remaining rows via `createStudent`
   *      in batches of 10 with `Promise.allSettled`.
   *
   * Returns a structured result with row-level findings (errors + warnings).
   * `dryRun: true` short-circuits before Phase 3 so operators can preview a
   * large import without committing — recommended for the 779-row Saraswati
   * go-live rehearsal.
   *
   * Archetype gate: the transformer hardcodes `archetype: 'PABSON'`. This
   * endpoint is PABSON-specific by design — the UI/API only surfaces it for
   * PABSON tenants. Grade validation and BS date conversion rely on this.
   */
  async importStudentsIemis(
    rows: IemisRow[],
    schoolId: string,
    context: RequestContext,
    options: { dryRun?: boolean } = {},
  ): Promise<{
    succeeded: number;
    failed: number;
    skipped: number;
    findings: IemisFinding[];
    duplicates: Array<{ row: number; emisStudentId: string; existingStudentId: string }>;
  }> {
    const startMs = Date.now();
    this.logger.log(
      `importStudentsIemis: entry schoolId=${schoolId} rows=${rows?.length ?? 0} dryRun=${!!options.dryRun}`,
    );

    if (!rows || rows.length === 0) {
      throw new BadRequestException('No student data provided');
    }
    if (rows.length > 1000) {
      throw new BadRequestException('Maximum 1000 students per IEMIS import');
    }

    // Fetch school — gets us `schoolCode` for studentNumber (used inside
    // createStudent) AND `emisSchoolCode` for the row-level mismatch check.
    const school = await this.identityClient.getSchool(schoolId, {
      tenantId: context.tenantId,
      userId: context.userId,
      jwtToken: context.jwtToken,
      userRole: context.role,
      userName: context.username,
    });

    // ── Phase 1: transform every row (pure, no I/O) ──
    const transforms: IemisTransformResult[] = rows.map((row, idx) =>
      transformIemisRow(row, idx + 1, {
        archetype: 'PABSON',
        schoolId,
        expectedIemisSchoolCode: school.emisSchoolCode,
      }),
    );

    const findings: IemisFinding[] = transforms.flatMap((t) => t.findings);
    const failed = transforms.filter((t) => t.dto === null).length;

    // ── Phase 2: dedup against existing emisStudentIds via GSI7 ──
    //
    // Parallelized in batches + shared tenant-scoped DDB client.
    //
    // Saraswati-pilot incident 2026-04-21: the original implementation ran
    // N sequential `findByEmisStudentId()` calls. Each call internally did
    // `DynamoDBClientService.getClient()` → TokenVendingMachine.assumeRole()
    // → STS (~50ms per acquisition, no cache). For 779 rows that was
    //   779 × 55ms ≈ 40 seconds — past Vercel's 25s proxy timeout AND API
    // Gateway's 29s hard integration cap. Symptom: opaque 504 "upstream
    // request timeout" from Vercel while the backend silently completed.
    //
    // Fix: acquire ONE tenant-scoped client up front, pass it to every
    // dedup call via the new `sharedClient` parameter. That turns
    // "N STS + N DDB" into "1 STS + N DDB" — the 779-row case drops from
    // 40s to <3s. The batching below is kept (prevents DDB
    // on-demand-read bursts); without the shared client it was pointless.
    const sharedClient = await this.dynamoDBClient.getClient(
      context.tenantId,
      context.jwtToken,
    );
    const validTransforms = transforms.filter((t) => t.dto !== null);
    const duplicates: Array<{ row: number; emisStudentId: string; existingStudentId: string }> = [];
    const toImport: IemisTransformResult[] = [];
    const DEDUP_BATCH_SIZE = 20;

    for (let i = 0; i < validTransforms.length; i += DEDUP_BATCH_SIZE) {
      const batch = validTransforms.slice(i, i + DEDUP_BATCH_SIZE);
      const lookups = await Promise.all(
        batch.map(async (t) => {
          if (!t.emisStudentId) return { t, existing: null as Student | null };
          const existing = await this.findByEmisStudentId(
            context.tenantId,
            t.emisStudentId,
            context.jwtToken,
            sharedClient,
          );
          return { t, existing };
        }),
      );
      for (const { t, existing } of lookups) {
        if (existing && t.emisStudentId) {
          duplicates.push({
            row: t.row,
            emisStudentId: t.emisStudentId,
            existingStudentId: existing.studentId,
          });
        } else {
          toImport.push(t);
        }
      }
    }

    // Dry-run short-circuit — no DDB writes.
    if (options.dryRun) {
      const durationMs = Date.now() - startMs;
      this.logger.log(
        `importStudentsIemis(dryRun): transformed=${rows.length} valid=${validTransforms.length} ` +
          `would-import=${toImport.length} would-skip=${duplicates.length} failed=${failed} ` +
          `findings=${findings.length} durationMs=${durationMs}`,
      );
      return { succeeded: 0, failed, skipped: duplicates.length, findings, duplicates };
    }

    // ── Phase 3: persist in batches of 10 ──
    let succeeded = 0;
    let runtimeFailed = 0;
    const BATCH_SIZE = 10;
    for (let i = 0; i < toImport.length; i += BATCH_SIZE) {
      const batch = toImport.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((t) => this.createStudent(t.dto!, context)),
      );
      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status === 'fulfilled') {
          succeeded++;
        } else {
          runtimeFailed++;
          findings.push({
            row: batch[j].row,
            field: 'create',
            level: 'error',
            message: (result as PromiseRejectedResult).reason?.message || 'createStudent failed',
          });
        }
      }
    }

    const durationMs = Date.now() - startMs;
    this.logger.log(
      `importStudentsIemis: succeeded=${succeeded} failed=${failed + runtimeFailed} ` +
        `skipped=${duplicates.length} findings=${findings.length} durationMs=${durationMs}`,
    );

    return {
      succeeded,
      failed: failed + runtimeFailed,
      skipped: duplicates.length,
      findings,
      duplicates,
    };
  }

  /**
   * Link a guardian record to a user account (portal access).
   *
   * Finds the guardian by guardianId (or email fallback) and sets
   * guardian.userId and guardian.hasPortalAccess = true.
   */
  async linkGuardianToUser(
    studentId: string,
    userId: string,
    guardianId: string | undefined,
    guardianEmail: string,
    context: RequestContext,
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const student = await this.dynamoDBClient.getItem<Student>(
      client,
      context.tenantId,
      EntityKeyBuilder.student(studentId),
    );

    if (!student) {
      throw new NotFoundException(`Student ${studentId} not found`);
    }

    const guardians = student.guardians || [];
    let targetIdx = -1;

    if (guardianId) {
      targetIdx = guardians.findIndex(g => g.guardianId === guardianId);
    }
    if (targetIdx === -1) {
      targetIdx = guardians.findIndex(
        g => g.email?.toLowerCase() === guardianEmail.toLowerCase(),
      );
    }

    if (targetIdx === -1) {
      this.logger.warn(
        `No matching guardian found for student ${studentId} (guardianId=${guardianId}, email=${guardianEmail})`,
      );
      return;
    }

    guardians[targetIdx] = {
      ...guardians[targetIdx],
      userId,
      hasPortalAccess: true,
    };

    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      EntityKeyBuilder.student(studentId),
      'SET guardians = :guardians, updatedAt = :updatedAt, updatedBy = :updatedBy',
      {
        ':guardians': guardians,
        ':updatedAt': new Date().toISOString(),
        ':updatedBy': context.userId,
      },
    );

    this.logger.log(
      `Guardian linked to user: student=${studentId}, guardian=${guardians[targetIdx].guardianId}, userId=${userId}`,
    );
  }

  /**
   * Provision portal accounts for guardians and optionally the student.
   *
   * For each guardian with hasPortalAccess=true and a valid email, creates a
   * parent user account in the Identity service and links the userId back to
   * the guardian record.
   *
   * For the student, creates a student portal account if email is provided.
   *
   * Graceful degradation: errors are logged but never propagated — student
   * creation must succeed even if portal provisioning fails.
   */
  private async provisionPortalAccounts(
    studentId: string,
    schoolId: string,
    guardians: Guardian[],
    studentFirstName: string,
    studentLastName: string,
    studentEmail: string | undefined,
    context: RequestContext,
  ): Promise<void> {
    // Provision guardian portal accounts
    for (const guardian of guardians) {
      if (!guardian.hasPortalAccess || !guardian.email) {
        continue;
      }

      try {
        const parentAccount = await this.identityClient.createParentAccount(
          {
            email: guardian.email,
            firstName: guardian.firstName,
            lastName: guardian.lastName,
            phone: guardian.phone,
            schoolId,
            studentId,
            guardianId: guardian.guardianId,
          },
          {
            tenantId: context.tenantId,
            userId: context.userId,
            jwtToken: context.jwtToken,
          },
        );

        if (parentAccount) {
          // Link the created userId back to the guardian record
          await this.linkGuardianToUser(
            studentId,
            parentAccount.userId,
            guardian.guardianId,
            guardian.email,
            context,
          );
          this.logger.log(
            `Portal account provisioned for guardian ${guardian.firstName} ${guardian.lastName} (${guardian.email}) → userId=${parentAccount.userId}`,
          );
        }
      } catch (error: any) {
        this.logger.error(
          `Failed to provision portal account for guardian ${guardian.guardianId} (${guardian.email}): ${error.message}`,
        );
      }
    }

    // Provision student portal account if email is provided
    if (studentEmail) {
      try {
        const studentAccount = await this.identityClient.createStudentAccount(
          {
            email: studentEmail,
            firstName: studentFirstName,
            lastName: studentLastName,
            schoolId,
            studentId,
          },
          {
            tenantId: context.tenantId,
            userId: context.userId,
            jwtToken: context.jwtToken,
          },
        );

        if (studentAccount) {
          // Store the portal userId on the student entity
          const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
          await this.dynamoDBClient.updateItem(
            client,
            context.tenantId,
            EntityKeyBuilder.student(studentId),
            'SET portalUserId = :portalUserId, updatedAt = :updatedAt',
            {
              ':portalUserId': studentAccount.userId,
              ':updatedAt': new Date().toISOString(),
            },
          );
          this.logger.log(
            `Student portal account provisioned for ${studentFirstName} ${studentLastName} (${studentEmail}) → userId=${studentAccount.userId}`,
          );
        }
      } catch (error: any) {
        this.logger.error(
          `Failed to provision student portal account for ${studentId} (${studentEmail}): ${error.message}`,
        );
      }
    }
  }

  /**
   * Convert Student entity to response DTO using mapper
   */
  private toStudentResponse(student: Student): StudentResponseDto {
    return studentEntityToDto(student);
  }
}

