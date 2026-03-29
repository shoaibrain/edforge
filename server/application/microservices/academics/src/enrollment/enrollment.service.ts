/**
 * Enrollment Service - Student enrollment management
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { DataScopeService } from '../common/services/data-scope.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { HttpClientService } from '@app/http-client';
import {
  Enrollment,
  createEnrollmentEntity,
} from '../common/entities/enrollment.entity';
import { Student } from '../common/entities/student.entity';
import { SectionEnrollment } from '../common/entities/section-enrollment.entity';
import { 
  EntityKeyBuilder, 
  GSIKeyBuilder,
  RequestContext,
  PaginatedResult,
} from '../common/entities/base.entity';
import {
  CreateEnrollmentDto,
  UpdateEnrollmentDto,
  WithdrawStudentDto,
  TransferStudentDto,
  EnrollmentResponseDto,
  EnrollmentSummaryDto,
} from '@aibrains/shared-types';
import {
  enrollmentEntityToDto,
  transferDtoToTransferData,
} from '../common/mappers';
import { validateTransition } from '../common/utils/enrollment-state-machine';

@Injectable()
export class EnrollmentService {
  private readonly logger = new Logger(EnrollmentService.name);
  private readonly financeServiceUrl: string;
  private readonly internalApiKey: string;

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly identityClient: IdentityClientService,
    private readonly dataScopeService: DataScopeService,
    private readonly eventsService: AcademicsEventsService,
    private readonly httpClient: HttpClientService,
  ) {
    this.financeServiceUrl = process.env.FINANCE_SERVICE_URL || 'http://finance-api.default.sc:3010';
    this.internalApiKey = process.env.INTERNAL_API_KEY || '';
  }

  /**
   * Create a new enrollment
   */
  async createEnrollment(
    createEnrollmentDto: CreateEnrollmentDto,
    context: RequestContext
  ): Promise<EnrollmentResponseDto> {
    this.logger.debug(`createEnrollment: entry, studentId=${createEnrollmentDto.studentId}, schoolId=${createEnrollmentDto.schoolId}, yearId=${createEnrollmentDto.academicYearId}, gradeLevel=${createEnrollmentDto.gradeLevel}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const now = new Date().toISOString();

    // Write authorization: verify student is in user's data scope (defense-in-depth)
    const scope = await this.dataScopeService.resolveScope(context.userId, createEnrollmentDto.schoolId, context);
    if (!this.dataScopeService.isStudentInScope(scope, createEnrollmentDto.studentId)) {
      throw new ForbiddenException('You do not have access to enroll this student');
    }

    // Verify student exists
    const student = await this.dynamoDBClient.getItem<Student>(
      client,
      context.tenantId,
      EntityKeyBuilder.student(createEnrollmentDto.studentId)
    );

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    // Check for existing active enrollment in the same year
    const existingEnrollment = await this.dynamoDBClient.getItem<Enrollment>(
      client,
      context.tenantId,
      EntityKeyBuilder.enrollment(
        createEnrollmentDto.schoolId,
        createEnrollmentDto.academicYearId,
        createEnrollmentDto.studentId
      )
    );

    if (existingEnrollment) {
      this.logger.debug(`createEnrollment: existing enrollment found with status=${existingEnrollment.status}`);
      if (existingEnrollment.status === 'enrolled') {
        throw new ConflictException('Student already enrolled in this school for this academic year');
      }
      // Guard: withdrawn/transferred/graduated enrollment exists at the same SK.
      // Re-enrollment same year requires a different entry date (Ed-Fi composite key).
      // Since our SK is schoolId+yearId+studentId (not entryDate), we can't create a second enrollment.
      throw new ConflictException(
        `A ${existingEnrollment.status} enrollment already exists for this student/school/year. ` +
        `Re-enrollment in the same academic year is not supported in the current data model.`
      );
    }

    // Validate academic year exists and is active
    const identityCtx = {
      tenantId: context.tenantId,
      jwtToken: context.jwtToken,
    };
    const years = await this.identityClient.getAcademicYears(createEnrollmentDto.schoolId, identityCtx as any);
    const year = years.find(y => y.yearId === createEnrollmentDto.academicYearId);
    if (!year) {
      throw new BadRequestException(`Academic year ${createEnrollmentDto.academicYearId} not found`);
    }
    if (year.status !== 'active') {
      throw new BadRequestException(`Academic year must be in 'active' status for enrollment`);
    }

    // Ed-Fi: Use entryDate (canonical) with fallback to enrollmentDate (legacy)
    const entryDate = createEnrollmentDto.enrollmentDate || now.split('T')[0];

    // Validate entry date falls within academic year range
    if (entryDate < year.startDate || entryDate > year.endDate) {
      throw new BadRequestException(
        `Entry date ${entryDate} is outside the academic year range (${year.startDate} to ${year.endDate})`
      );
    }

    // Prevent overlapping primary enrollment at another school
    if (createEnrollmentDto.primarySchool !== false) {
      await this.checkOverlappingPrimaryEnrollment(
        client, context.tenantId, createEnrollmentDto.studentId,
        createEnrollmentDto.schoolId, createEnrollmentDto.academicYearId,
      );
    }

    const enrollmentId = uuid();

    const enrollment = createEnrollmentEntity(
      context.tenantId,
      enrollmentId,
      createEnrollmentDto.studentId,
      createEnrollmentDto.schoolId,
      createEnrollmentDto.academicYearId,
      {
        gradeLevel: createEnrollmentDto.gradeLevel,
        studentName: `${student.firstName} ${student.lastName}`,
        status: 'enrolled',
        // Ed-Fi canonical fields
        entryDate,
        exitWithdrawDate: undefined,
        // Legacy fields (kept for backward compat)
        enrollmentDate: entryDate,
        startDate: entryDate,
        sectionId: createEnrollmentDto.sectionId,
        homeroomTeacherId: createEnrollmentDto.homeroomId,
        enrollmentType: createEnrollmentDto.enrollmentType || 'new',
        previousSchoolName: createEnrollmentDto.previousSchoolName,
        transferReason: createEnrollmentDto.transferReason,
        notes: createEnrollmentDto.notes,
        // Ed-Fi StudentSchoolAssociation fields
        entryGradeLevelDescriptor: createEnrollmentDto.entryGradeLevelDescriptor,
        entryTypeDescriptor: createEnrollmentDto.entryTypeDescriptor,
        enrollmentTypeDescriptor: createEnrollmentDto.enrollmentTypeDescriptor,
        residencyStatusDescriptor: createEnrollmentDto.residencyStatusDescriptor,
        primarySchool: createEnrollmentDto.primarySchool ?? true,
        fullTimeEquivalency: createEnrollmentDto.fullTimeEquivalency ?? 1.0,
        repeatGradeIndicator: createEnrollmentDto.repeatGradeIndicator ?? false,
        calendarCode: createEnrollmentDto.calendarCode,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );

    await this.dynamoDBClient.putItem(client, enrollment);

    // Transition student to active status and set enrollment date
    // Build update expression dynamically based on what needs to change
    const updateParts: string[] = [
      'currentGradeLevel = :gradeLevel',
      'updatedAt = :updatedAt',
      'updatedBy = :updatedBy',
    ];
    const updateValues: Record<string, any> = {
      ':gradeLevel': createEnrollmentDto.gradeLevel,
      ':updatedAt': now,
      ':updatedBy': context.userId,
    };

    // Always set enrollment date from the entry date
    updateParts.push('enrollmentDate = :enrollmentDate');
    updateValues[':enrollmentDate'] = entryDate;

    // Transition status to active if student is pending (or not already active)
    if (student.status !== 'active') {
      updateParts.push('#status = :status');
      updateValues[':status'] = 'active';
    }

    // Update primary school if needed
    if (student.primarySchoolId !== createEnrollmentDto.schoolId) {
      updateParts.push('primarySchoolId = :schoolId');
      updateValues[':schoolId'] = createEnrollmentDto.schoolId;
    }

    const expressionAttributeNames: Record<string, string> = {};
    if (student.status !== 'active') {
      expressionAttributeNames['#status'] = 'status';
    }

    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      EntityKeyBuilder.student(createEnrollmentDto.studentId),
      `SET ${updateParts.join(', ')}`,
      updateValues,
      undefined, // conditionExpression
      Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
    );

    this.logger.log(`Enrollment created: ${enrollmentId} for student ${createEnrollmentDto.studentId}, status=${student.status !== 'active' ? 'pending→active' : 'active(unchanged)'}`);

    // Fire-and-forget event
    this.eventsService.publishEnrollmentCompleted(
      context.tenantId,
      enrollmentId,
      createEnrollmentDto.studentId,
      createEnrollmentDto.schoolId,
      createEnrollmentDto.academicYearId,
      createEnrollmentDto.gradeLevel,
    ).catch(err => this.logger.error(`Failed to publish EnrollmentCompleted event: ${err.message}`, err.stack));

    // Fire-and-forget: notify finance service for billing setup
    if (this.internalApiKey) {
      this.httpClient.post(
        `${this.financeServiceUrl}/internal/webhooks/enrollment-completed`,
        {
          tenantId: context.tenantId,
          studentId: createEnrollmentDto.studentId,
          schoolId: createEnrollmentDto.schoolId,
          academicYearId: createEnrollmentDto.academicYearId,
          gradeLevel: createEnrollmentDto.gradeLevel,
        },
        { headers: { 'x-internal-api-key': this.internalApiKey } },
        { tenantId: context.tenantId, userId: context.userId, jwtToken: context.jwtToken, userRole: context.role },
      ).catch(err => this.logger.error(`Finance enrollment webhook failed: ${err.message}`));
    }

    // Audit trail
    this.appendAuditEntry(
      client, context.tenantId, enrollment.entityKey, 'CREATED',
      { enrollmentType: createEnrollmentDto.enrollmentType, gradeLevel: createEnrollmentDto.gradeLevel },
      context,
    ).catch(() => {});

    return this.toEnrollmentResponse(enrollment);
  }

  /**
   * Get enrollment by student and year
   */
  async getEnrollment(
    schoolId: string,
    academicYearId: string,
    studentId: string,
    context: RequestContext
  ): Promise<EnrollmentResponseDto> {
    this.logger.debug(`getEnrollment: entry, schoolId=${schoolId}, yearId=${academicYearId}, studentId=${studentId}`);
    // Row-level security: verify student is in user's data scope
    const scope = await this.dataScopeService.resolveScope(context.userId, schoolId, context);
    if (!this.dataScopeService.isStudentInScope(scope, studentId)) {
      throw new NotFoundException('Enrollment not found');
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const enrollment = await this.dynamoDBClient.getItem<Enrollment>(
      client,
      context.tenantId,
      EntityKeyBuilder.enrollment(schoolId, academicYearId, studentId)
    );

    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }

    return this.toEnrollmentResponse(enrollment);
  }

  /**
   * List enrollments for a school/year
   */
  async listEnrollments(
    schoolId: string,
    academicYearId: string,
    context: RequestContext,
    limit: number = 50,
    lastEvaluatedKey?: string,
    filters?: {
      gradeLevel?: string;
      status?: string;
    }
  ): Promise<PaginatedResult<EnrollmentResponseDto>> {
    this.logger.debug(`listEnrollments: entry, schoolId=${schoolId}, yearId=${academicYearId}, limit=${limit}, filters=${JSON.stringify({ gradeLevel: filters?.gradeLevel, status: filters?.status })}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    let exclusiveStartKey: Record<string, any> | undefined;
    if (lastEvaluatedKey) {
      try {
        exclusiveStartKey = JSON.parse(Buffer.from(lastEvaluatedKey, 'base64').toString());
      } catch {
        // Invalid key, ignore
      }
    }

    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    let filterExpression = 'entityType = :entityType';
    const expressionValues: Record<string, any> = {
      ':entityType': 'ENROLLMENT',
    };
    const expressionNames: Record<string, string> = {};

    if (filters?.status) {
      filterExpression += ' AND #status = :status';
      expressionValues[':status'] = filters.status;
      expressionNames['#status'] = 'status';
    }

    if (filters?.gradeLevel) {
      filterExpression += ' AND gradeLevel = :gradeLevel';
      expressionValues[':gradeLevel'] = filters.gradeLevel;
    }

    // Resolve data scope for row-level security (Teacher → section-scoped)
    const scope = await this.dataScopeService.resolveScope(context.userId, schoolId, context);

    // Over-fetch for section-scoped users to compensate for post-filter reduction
    const fetchLimit = scope.type === 'section' ? limit * 3 : limit;

    const result = await this.dynamoDBClient.queryGSI<Enrollment>(
      client,
      'GSI1',
      gsi1pk,
      `ENROLLMENT#${academicYearId}`,
      'begins_with',
      filterExpression,
      expressionValues,
      Object.keys(expressionNames).length > 0 ? expressionNames : undefined,
      fetchLimit,
      true,
      exclusiveStartKey
    );

    // Apply data scope filter (Teacher → only their students' enrollments)
    const scopedItems = this.dataScopeService.filterByStudentScope(scope, result.items);
    const pagedItems = scopedItems.slice(0, limit);

    // Hydrate student names for enrollments missing denormalized studentName
    const needsName = pagedItems.filter(e => !e.studentName);
    if (needsName.length > 0) {
      const studentKeys = [...new Set(needsName.map(e => e.studentId))].map(sid => ({
        tenantId: context.tenantId,
        entityKey: EntityKeyBuilder.student(sid),
      }));
      try {
        const students = await this.dynamoDBClient.batchGetItems<Student>(client, studentKeys);
        const nameMap = new Map(students.map(s => [s.studentId, `${s.firstName} ${s.lastName}`]));
        for (const enrollment of needsName) {
          enrollment.studentName = nameMap.get(enrollment.studentId);
        }
      } catch (err) {
        this.logger.warn(`Failed to resolve student names for enrollment list: ${err}`);
      }
    }

    this.logger.debug(`listEnrollments: returning ${pagedItems.length} enrollments (${result.items.length} raw, ${scopedItems.length} after scope filter)`);
    return {
      items: pagedItems.map(e => this.toEnrollmentResponse(e)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: scopedItems.length > limit || result.hasMore,
    };
  }

  /**
   * Get enrollment history for a student
   */
  async getStudentEnrollmentHistory(
    studentId: string,
    context: RequestContext,
    schoolId?: string,
  ): Promise<EnrollmentResponseDto[]> {
    this.logger.debug(`getStudentEnrollmentHistory: entry, studentId=${studentId}, schoolId=${schoolId || 'all'}`);
    // Row-level security: if schoolId is available, check scope
    if (schoolId) {
      const scope = await this.dataScopeService.resolveScope(context.userId, schoolId, context);
      if (!this.dataScopeService.isStudentInScope(scope, studentId)) {
        return []; // Out of scope — return empty instead of 403 for graceful degradation
      }
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const result = await this.dynamoDBClient.queryGSI<Enrollment>(
      client,
      'GSI2',
      studentId,
      'ENROLLMENT#',
      'begins_with',
      undefined,
      undefined,
      undefined,
      100,
      false  // Sort descending
    );

    this.logger.debug(`getStudentEnrollmentHistory: returning ${result.items.length} enrollment records`);
    return result.items.map(e => this.toEnrollmentResponse(e));
  }

  /**
   * Update enrollment
   */
  async updateEnrollment(
    schoolId: string,
    academicYearId: string,
    studentId: string,
    updateEnrollmentDto: UpdateEnrollmentDto,
    context: RequestContext
  ): Promise<EnrollmentResponseDto> {
    this.logger.debug(`updateEnrollment: entry, schoolId=${schoolId}, yearId=${academicYearId}, studentId=${studentId}`);
    // Write authorization: verify student is in user's data scope
    const scope = await this.dataScopeService.resolveScope(context.userId, schoolId, context);
    if (!this.dataScopeService.isStudentInScope(scope, studentId)) {
      throw new ForbiddenException('You do not have access to update this enrollment');
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const enrollment = await this.dynamoDBClient.getItem<Enrollment>(
      client,
      context.tenantId,
      EntityKeyBuilder.enrollment(schoolId, academicYearId, studentId)
    );

    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};
    const names: Record<string, string> = {};

    // Update fields
    const fields = [
      'gradeLevel', 'endDate', 'withdrawalDate', 'sectionId', 
      'homeroomTeacherId', 'specialEducation', 'eslStatus',
      'lunchStatus', 'transportation', 'documentsReceived', 'notes'
    ];

    for (const field of fields) {
      const value = (updateEnrollmentDto as any)[field];
      if (value !== undefined) {
        updates.push(`${field} = :${field}`);
        values[`:${field}`] = value;
      }
    }

    // Note: Status changes should go through dedicated methods (withdrawStudent, updateEnrollmentStatus)
    // UpdateEnrollmentDto is for non-status field updates only

    if (updates.length === 0) {
      return this.toEnrollmentResponse(enrollment);
    }

    updates.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy', '#version = #version + :inc');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;
    values[':inc'] = 1;
    names['#version'] = 'version';

    const updatedEnrollment = await this.dynamoDBClient.updateItem<Enrollment>(
      client,
      context.tenantId,
      EntityKeyBuilder.enrollment(schoolId, academicYearId, studentId),
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      names
    );

    this.logger.log(`Enrollment updated: ${enrollment.enrollmentId}`);

    return this.toEnrollmentResponse(updatedEnrollment);
  }

  /**
   * Withdraw student from enrollment
   */
  async withdrawStudent(
    schoolId: string,
    academicYearId: string,
    studentId: string,
    withdrawDto: WithdrawStudentDto,
    context: RequestContext
  ): Promise<EnrollmentResponseDto> {
    this.logger.debug(`withdrawStudent: entry, schoolId=${schoolId}, yearId=${academicYearId}, studentId=${studentId}`);
    // Write authorization: verify student is in user's data scope
    const scope = await this.dataScopeService.resolveScope(context.userId, schoolId, context);
    if (!this.dataScopeService.isStudentInScope(scope, studentId)) {
      throw new ForbiddenException('You do not have access to withdraw this student');
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const now = new Date().toISOString();

    const enrollment = await this.dynamoDBClient.getItem<Enrollment>(
      client,
      context.tenantId,
      EntityKeyBuilder.enrollment(schoolId, academicYearId, studentId)
    );

    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }

    // Validate status transition via state machine
    try {
      validateTransition(enrollment.status, 'withdrawn');
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }

    // Combine reason and notes for the entity notes field
    const withdrawalNotes = withdrawDto.notes 
      ? `${withdrawDto.reason}. ${withdrawDto.notes}`
      : withdrawDto.reason;

    // Validate exitWithdrawDate >= entryDate
    const entryDate = enrollment.entryDate || enrollment.enrollmentDate;
    if (withdrawDto.withdrawalDate < entryDate) {
      throw new BadRequestException(
        `Withdrawal date ${withdrawDto.withdrawalDate} cannot be before entry date ${entryDate}`
      );
    }

    // Build update expression with Ed-Fi fields
    const withdrawUpdateExpr = 'SET #status = :status, exitWithdrawDate = :exitWithdrawDate, withdrawalDate = :withdrawalDate, endDate = :endDate, exitWithdrawTypeDescriptor = :exitWithdrawTypeDescriptor, notes = :notes, updatedAt = :updatedAt, updatedBy = :updatedBy';
    const withdrawValues: Record<string, any> = {
      ':status': 'withdrawn',
      ':exitWithdrawDate': withdrawDto.withdrawalDate,
      ':withdrawalDate': withdrawDto.withdrawalDate,
      ':endDate': withdrawDto.withdrawalDate,
      ':exitWithdrawTypeDescriptor': withdrawDto.exitWithdrawTypeDescriptor,
      ':notes': withdrawalNotes,
      ':updatedAt': now,
      ':updatedBy': context.userId,
    };

    // Update enrollment
    const updatedEnrollment = await this.dynamoDBClient.updateItem<Enrollment>(
      client,
      context.tenantId,
      EntityKeyBuilder.enrollment(schoolId, academicYearId, studentId),
      withdrawUpdateExpr,
      withdrawValues,
      undefined,
      { '#status': 'status' }
    );

    // Update student status
    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      EntityKeyBuilder.student(studentId),
      'SET #status = :status, withdrawalDate = :withdrawalDate, updatedAt = :updatedAt',
      {
        ':status': 'withdrawn',
        ':withdrawalDate': withdrawDto.withdrawalDate,
        ':updatedAt': now,
      },
      undefined,
      { '#status': 'status' }
    );

    // Cascade deactivation to section enrollments (best-effort)
    await this.cascadeDeactivateSectionEnrollments(
      client, context.tenantId, studentId, academicYearId,
      `Student withdrawn: ${withdrawDto.reason}`, context.userId,
    );

    this.logger.log(`Student withdrawn: ${studentId} from ${schoolId}`);

    // Fire-and-forget event
    this.eventsService.publishStudentWithdrawn(
      context.tenantId,
      enrollment.enrollmentId,
      studentId,
      schoolId,
      withdrawDto.withdrawalDate,
      withdrawDto.reason,
    ).catch(err => this.logger.error(`Failed to publish StudentWithdrawn event: ${err.message}`, err.stack));

    // Fire-and-forget: notify finance to cancel draft invoices
    if (this.internalApiKey) {
      this.httpClient.post(
        `${this.financeServiceUrl}/internal/webhooks/student-withdrawn`,
        { tenantId: context.tenantId, studentId, schoolId },
        { headers: { 'x-internal-api-key': this.internalApiKey } },
        { tenantId: context.tenantId, userId: context.userId, jwtToken: context.jwtToken, userRole: context.role },
      ).catch(err => this.logger.error(`Finance withdrawal webhook failed: ${err.message}`));
    }

    // Audit trail
    this.appendAuditEntry(
      client, context.tenantId, EntityKeyBuilder.enrollment(schoolId, academicYearId, studentId),
      'WITHDRAWN',
      { reason: withdrawDto.reason, exitWithdrawDate: withdrawDto.withdrawalDate, exitWithdrawTypeDescriptor: withdrawDto.exitWithdrawTypeDescriptor },
      context,
    ).catch(() => {});

    return this.toEnrollmentResponse(updatedEnrollment);
  }

  /**
   * Transfer student to another school
   */
  async transferStudent(
    schoolId: string,
    academicYearId: string,
    studentId: string,
    transferDto: TransferStudentDto,
    context: RequestContext
  ): Promise<EnrollmentResponseDto> {
    this.logger.debug(`transferStudent: entry, fromSchoolId=${schoolId}, yearId=${academicYearId}, studentId=${studentId}, toSchoolId=${transferDto.newSchoolId}`);
    // Write authorization: verify student is in user's data scope at source school
    const scope = await this.dataScopeService.resolveScope(context.userId, schoolId, context);
    if (!this.dataScopeService.isStudentInScope(scope, studentId)) {
      throw new ForbiddenException('You do not have access to transfer this student');
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const now = new Date().toISOString();

    // Map DTO fields to internal format
    const transferData = transferDtoToTransferData(transferDto);

    // Get current enrollment
    const currentEnrollment = await this.dynamoDBClient.getItem<Enrollment>(
      client,
      context.tenantId,
      EntityKeyBuilder.enrollment(schoolId, academicYearId, studentId)
    );

    if (!currentEnrollment) {
      throw new NotFoundException('Current enrollment not found');
    }

    // Validate status transition via state machine
    try {
      validateTransition(currentEnrollment.status, 'transferred');
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }

    // Close source enrollment with Ed-Fi required exit fields
    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      EntityKeyBuilder.enrollment(schoolId, academicYearId, studentId),
      'SET #status = :status, endDate = :endDate, exitWithdrawDate = :exitWithdrawDate, exitWithdrawTypeDescriptor = :exitWithdrawTypeDescriptor, withdrawalDate = :withdrawalDate, notes = :notes, updatedAt = :updatedAt, updatedBy = :updatedBy',
      {
        ':status': 'transferred',
        ':endDate': transferData.effectiveDate,
        ':exitWithdrawDate': transferData.effectiveDate,
        ':exitWithdrawTypeDescriptor': 'Transferred',
        ':withdrawalDate': transferData.effectiveDate,
        ':notes': `Transferred to school ${transferData.toSchoolId}. Reason: ${transferData.reason || 'N/A'}`,
        ':updatedAt': now,
        ':updatedBy': context.userId,
      },
      undefined,
      { '#status': 'status' }
    );

    // Cascade deactivation to section enrollments at source school (best-effort)
    await this.cascadeDeactivateSectionEnrollments(
      client, context.tenantId, studentId, academicYearId,
      `Student transferred to another school`, context.userId,
    );

    // Create new enrollment at destination school (same academic year)
    const newEnrollmentId = uuid();
    const newEnrollment = createEnrollmentEntity(
      context.tenantId,
      newEnrollmentId,
      studentId,
      transferData.toSchoolId,
      academicYearId,  // Stay in same academic year
      {
        gradeLevel: transferData.newGradeLevel || currentEnrollment.gradeLevel,
        studentName: currentEnrollment.studentName,
        status: 'enrolled',
        entryDate: transferData.effectiveDate,
        enrollmentDate: now.split('T')[0],
        startDate: transferData.effectiveDate,
        enrollmentType: 'transfer',
        previousSchoolId: schoolId,
        transferReason: transferData.reason,
        specialEducation: currentEnrollment.specialEducation,
        eslStatus: currentEnrollment.eslStatus,
        lunchStatus: currentEnrollment.lunchStatus,
        transportation: currentEnrollment.transportation,
        notes: transferData.notes,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );

    await this.dynamoDBClient.putItem(client, newEnrollment);

    // Update student's primary school
    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      EntityKeyBuilder.student(studentId),
      'SET primarySchoolId = :schoolId, #status = :status, updatedAt = :updatedAt',
      {
        ':schoolId': transferData.toSchoolId,
        ':status': 'active',
        ':updatedAt': now,
      },
      undefined,
      { '#status': 'status' }
    );

    this.logger.log(`Student transferred: ${studentId} from ${schoolId} to ${transferData.toSchoolId}`);

    // Fire-and-forget event
    this.eventsService.publishStudentTransferred(
      context.tenantId,
      studentId,
      schoolId,
      transferData.toSchoolId,
      transferData.effectiveDate,
    ).catch(err => this.logger.error(`Failed to publish StudentTransferred event: ${err.message}`, err.stack));

    // Audit trail: source enrollment closed
    this.appendAuditEntry(
      client, context.tenantId, EntityKeyBuilder.enrollment(schoolId, academicYearId, studentId),
      'TRANSFERRED_OUT',
      { toSchoolId: transferData.toSchoolId, effectiveDate: transferData.effectiveDate, reason: transferData.reason },
      context,
    ).catch(() => {});

    // Audit trail: new enrollment at destination
    this.appendAuditEntry(
      client, context.tenantId, EntityKeyBuilder.enrollment(transferData.toSchoolId, academicYearId, studentId),
      'TRANSFERRED_IN',
      { fromSchoolId: schoolId, effectiveDate: transferData.effectiveDate },
      context,
    ).catch(() => {});

    return this.toEnrollmentResponse(newEnrollment);
  }

  /**
   * Get enrollment summary for a school
   */
  async getEnrollmentSummary(
    schoolId: string,
    academicYearId: string,
    context: RequestContext
  ): Promise<EnrollmentSummaryDto> {
    this.logger.debug(`getEnrollmentSummary: entry, schoolId=${schoolId}, yearId=${academicYearId}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const result = await this.dynamoDBClient.queryGSI<Enrollment>(
      client,
      'GSI1',
      GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
      `ENROLLMENT#${academicYearId}`,
      'begins_with',
      'entityType = :entityType',
      { ':entityType': 'ENROLLMENT' },
      undefined,
      1000  // Get all enrollments
    );

    const byGradeLevel: Record<string, number> = {};
    const byStatus: Record<string, number> = {
      enrolled: 0,
      pending: 0,
      withdrawn: 0,
      graduated: 0,
      transferred: 0,
    };

    // Calculate recent enrollments/withdrawals (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];
    let recentEnrollments = 0;
    let recentWithdrawals = 0;

    for (const enrollment of result.items) {
      // Count by grade level (only enrolled)
      if (enrollment.status === 'enrolled') {
        byGradeLevel[enrollment.gradeLevel] = (byGradeLevel[enrollment.gradeLevel] || 0) + 1;
        // Check for recent enrollment
        if (enrollment.enrollmentDate >= thirtyDaysAgoStr) {
          recentEnrollments++;
        }
      }
      // Count by status
      byStatus[enrollment.status] = (byStatus[enrollment.status] || 0) + 1;
      
      // Check for recent withdrawal
      if (enrollment.status === 'withdrawn' && enrollment.withdrawalDate && enrollment.withdrawalDate >= thirtyDaysAgoStr) {
        recentWithdrawals++;
      }
    }

    this.logger.debug(`getEnrollmentSummary: totalEnrolled=${byStatus.enrolled}, totalRecords=${result.items.length}, recentEnrollments=${recentEnrollments}, recentWithdrawals=${recentWithdrawals}`);
    return {
      schoolId,
      academicYearId,
      totalEnrolled: byStatus.enrolled,
      byGradeLevel,
      byStatus,
      recentEnrollments,
      recentWithdrawals,
    };
  }

  /**
   * Check for overlapping primary enrollment at another school for the same academic year.
   * A student can only have one primary school enrollment per year.
   */
  private async checkOverlappingPrimaryEnrollment(
    client: any,
    tenantId: string,
    studentId: string,
    schoolId: string,
    academicYearId: string,
  ): Promise<void> {
    // Query student's enrollments via GSI2
    const result = await this.dynamoDBClient.queryGSI<Enrollment>(
      client,
      'GSI2',
      studentId,
      `ENROLLMENT#${academicYearId}`,
      'begins_with',
      undefined,
      undefined,
      undefined,
      100,
    );

    const overlapping = result.items.find(
      e =>
        e.schoolId !== schoolId &&
        (e.status === 'enrolled' || e.status === 'active') &&
        e.primarySchool === true,
    );

    if (overlapping) {
      throw new ConflictException(
        `Student already has an active primary enrollment at another school for this academic year`,
      );
    }
  }

  /**
   * Cascade deactivation to section enrollments when a student is withdrawn/transferred.
   * Best-effort: failures are logged but don't block the primary operation.
   */
  private async cascadeDeactivateSectionEnrollments(
    client: any,
    tenantId: string,
    studentId: string,
    academicYearId: string,
    reason: string,
    userId: string,
  ): Promise<void> {
    try {
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

      const now = new Date().toISOString();
      for (const se of result.items) {
        await this.dynamoDBClient.updateItem(
          client,
          tenantId,
          se.entityKey,
          'SET isActive = :isActive, droppedAt = :droppedAt, droppedBy = :droppedBy, dropReason = :dropReason, updatedAt = :updatedAt, updatedBy = :updatedBy',
          {
            ':isActive': false,
            ':droppedAt': now,
            ':droppedBy': userId,
            ':dropReason': reason,
            ':updatedAt': now,
            ':updatedBy': userId,
          },
        );
      }

      if (result.items.length > 0) {
        this.logger.log(`Cascaded deactivation to ${result.items.length} section enrollment(s) for student ${studentId}`);
      }
    } catch (err) {
      this.logger.error(`Failed to cascade deactivation for student ${studentId}: ${err}`);
    }
  }

  // ============================================================
  // Sprint 5: Operational Readiness
  // ============================================================

  /**
   * 5.1 Mark an enrolled student as no-show.
   * Sets withdrawal fields with no-show exit type per Ed-Fi guidelines.
   */
  async markNoShow(
    schoolId: string,
    academicYearId: string,
    studentId: string,
    context: RequestContext,
  ): Promise<EnrollmentResponseDto> {
    this.logger.debug(`markNoShow: entry, schoolId=${schoolId}, yearId=${academicYearId}, studentId=${studentId}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const sk = EntityKeyBuilder.enrollment(schoolId, academicYearId, studentId);

    const enrollment = await this.dynamoDBClient.getItem<Enrollment>(
      client, context.tenantId, sk,
    );
    if (!enrollment) throw new NotFoundException('Enrollment not found');

    try {
      validateTransition(enrollment.status, 'withdrawn');
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }

    const now = new Date().toISOString();
    const today = now.split('T')[0];

    const updated = await this.dynamoDBClient.updateItem<Enrollment>(
      client, context.tenantId, sk,
      'SET #status = :status, exitWithdrawDate = :exitDate, exitWithdrawTypeDescriptor = :exitType, ' +
      'withdrawalDate = :withdrawalDate, notes = :notes, endDate = :endDate, ' +
      'updatedAt = :updatedAt, updatedBy = :updatedBy, #version = #version + :inc',
      {
        ':status': 'withdrawn',
        ':exitDate': today,
        ':exitType': 'No show',
        ':withdrawalDate': today,
        ':notes': 'Marked as no-show — student never attended',
        ':endDate': today,
        ':updatedAt': now,
        ':updatedBy': context.userId,
        ':inc': 1,
        ':currentVersion': enrollment.version,
      },
      '#version = :currentVersion',
      { '#status': 'status', '#version': 'version' },
    );

    await this.cascadeDeactivateSectionEnrollments(
      client, context.tenantId, studentId, academicYearId, 'No-show withdrawal', context.userId,
    );

    this.logger.log(`Enrollment marked no-show: student=${studentId}, school=${schoolId}, year=${academicYearId}`);

    // Audit trail
    this.appendAuditEntry(
      client, context.tenantId, sk, 'NO_SHOW',
      { exitWithdrawDate: today, exitWithdrawTypeDescriptor: 'No show' },
      context,
    ).catch(() => {});

    return this.toEnrollmentResponse(updated);
  }

  /**
   * 5.2 Close all open enrollments for a completed academic year.
   * Sets exitWithdrawDate to the provided lastDayOfSchool and
   * exitWithdrawTypeDescriptor to 'End of school year'.
   */
  async closeAcademicYearEnrollments(
    schoolId: string,
    academicYearId: string,
    lastDayOfSchool: string,
    context: RequestContext,
  ): Promise<{ closed: number; alreadyClosed: number; errors: number }> {
    this.logger.debug(`closeAcademicYearEnrollments: entry, schoolId=${schoolId}, yearId=${academicYearId}, lastDayOfSchool=${lastDayOfSchool}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Validate academic year exists and is in a closeable status
    const identityCtx = { tenantId: context.tenantId, jwtToken: context.jwtToken };
    const years = await this.identityClient.getAcademicYears(schoolId, identityCtx as any);
    const year = years.find(y => y.yearId === academicYearId);
    if (!year) {
      throw new NotFoundException(`Academic year ${academicYearId} not found`);
    }
    if (year.status !== 'active' && year.status !== 'completed') {
      throw new BadRequestException(
        `Academic year must be in 'active' or 'completed' status to close. Current: ${year.status}`,
      );
    }

    const result = await this.dynamoDBClient.queryGSI<Enrollment>(
      client, 'GSI1',
      GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
      `ENROLLMENT#${academicYearId}`,
      'begins_with',
      'entityType = :entityType',
      { ':entityType': 'ENROLLMENT' },
      undefined, 1000,
    );

    const now = new Date().toISOString();
    let closed = 0;
    let alreadyClosed = 0;
    let errors = 0;

    for (const enrollment of result.items) {
      if (enrollment.status !== 'enrolled') {
        alreadyClosed++;
        continue;
      }

      try {
        const sk = EntityKeyBuilder.enrollment(schoolId, academicYearId, enrollment.studentId);
        await this.dynamoDBClient.updateItem(
          client, context.tenantId, sk,
          'SET #status = :status, exitWithdrawDate = :exitDate, exitWithdrawTypeDescriptor = :exitType, ' +
          'endDate = :endDate, updatedAt = :updatedAt, updatedBy = :updatedBy, #version = #version + :inc',
          {
            ':status': 'graduated',
            ':exitDate': lastDayOfSchool,
            ':exitType': 'End of school year',
            ':endDate': lastDayOfSchool,
            ':updatedAt': now,
            ':updatedBy': context.userId,
            ':inc': 1,
          },
          undefined,
          { '#status': 'status', '#version': 'version' },
        );
        closed++;

        // Audit trail (fire-and-forget per record)
        this.appendAuditEntry(
          client, context.tenantId, sk, 'YEAR_END_CLOSURE',
          { exitWithdrawDate: lastDayOfSchool, exitWithdrawTypeDescriptor: 'End of school year' },
          context,
        ).catch(() => {});
      } catch (err) {
        this.logger.error(`Failed to close enrollment for student ${enrollment.studentId}: ${err}`);
        errors++;
      }
    }

    this.logger.log(
      `Year-end closure: school=${schoolId}, year=${academicYearId}, closed=${closed}, already=${alreadyClosed}, errors=${errors}`,
    );
    return { closed, alreadyClosed, errors };
  }

  /**
   * 5.3 Append an audit entry to an enrollment record.
   */
  private async appendAuditEntry(
    client: any,
    tenantId: string,
    sk: string,
    action: string,
    details: Record<string, unknown>,
    context: RequestContext,
  ): Promise<void> {
    const entry = {
      action,
      timestamp: new Date().toISOString(),
      userId: context.userId,
      ...details,
    };

    try {
      await this.dynamoDBClient.updateItem(
        client, tenantId, sk,
        'SET auditTrail = list_append(if_not_exists(auditTrail, :emptyList), :entry)',
        {
          ':entry': [entry],
          ':emptyList': [],
        },
      );
    } catch (err) {
      this.logger.error(`Failed to append audit entry: ${err}`);
    }
  }

  /**
   * 5.4 Export enrollments for a school/year as CSV-ready data.
   */
  async exportEnrollments(
    schoolId: string,
    academicYearId: string,
    context: RequestContext,
  ): Promise<string> {
    this.logger.debug(`exportEnrollments: entry, schoolId=${schoolId}, yearId=${academicYearId}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const result = await this.dynamoDBClient.queryGSI<Enrollment>(
      client, 'GSI1',
      GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
      `ENROLLMENT#${academicYearId}`,
      'begins_with',
      'entityType = :entityType',
      { ':entityType': 'ENROLLMENT' },
      undefined, 5000,
    );

    const headers = [
      'studentId', 'studentName', 'gradeLevel', 'enrollmentDate', 'enrollmentType',
      'status', 'entryTypeDescriptor', 'residencyStatusDescriptor',
      'exitWithdrawDate', 'exitWithdrawTypeDescriptor',
      'primarySchool', 'fullTimeEquivalency', 'repeatGradeIndicator', 'notes',
    ];

    const escapeCSV = (val: unknown): string => {
      if (val == null) return '';
      const str = String(val);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    };

    const rows = result.items.map((e) =>
      headers.map((h) => escapeCSV((e as any)[h])).join(',')
    );

    return [headers.join(','), ...rows].join('\n');
  }

  /**
   * Convert Enrollment entity to response DTO using mapper
   */
  private toEnrollmentResponse(enrollment: Enrollment): EnrollmentResponseDto {
    return enrollmentEntityToDto(enrollment);
  }
}

