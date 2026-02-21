/**
 * Enrollment Service - Student enrollment management
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
import { IdentityClientService } from '../common/services/identity-client.service';
import {
  Enrollment,
  createEnrollmentEntity,
} from '../common/entities/enrollment.entity';
import { Student } from '../common/entities/student.entity';
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

@Injectable()
export class EnrollmentService {
  private readonly logger = new Logger(EnrollmentService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly identityClient: IdentityClientService,
  ) {}

  /**
   * Create a new enrollment
   */
  async createEnrollment(
    createEnrollmentDto: CreateEnrollmentDto,
    context: RequestContext
  ): Promise<EnrollmentResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const now = new Date().toISOString();

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

    if (existingEnrollment && existingEnrollment.status === 'enrolled') {
      throw new ConflictException('Student already enrolled in this school for this academic year');
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

    // Update student's primary school if needed
    if (student.primarySchoolId !== createEnrollmentDto.schoolId) {
      await this.dynamoDBClient.updateItem(
        client,
        context.tenantId,
        EntityKeyBuilder.student(createEnrollmentDto.studentId),
        'SET primarySchoolId = :schoolId, currentGradeLevel = :gradeLevel, updatedAt = :updatedAt',
        {
          ':schoolId': createEnrollmentDto.schoolId,
          ':gradeLevel': createEnrollmentDto.gradeLevel,
          ':updatedAt': now,
        }
      );
    }

    this.logger.log(`Enrollment created: ${enrollmentId} for student ${createEnrollmentDto.studentId}`);

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

    const result = await this.dynamoDBClient.queryGSI<Enrollment>(
      client,
      'GSI1',
      gsi1pk,
      `ENROLLMENT#${academicYearId}`,
      'begins_with',
      filterExpression,
      expressionValues,
      Object.keys(expressionNames).length > 0 ? expressionNames : undefined,
      limit,
      true,
      exclusiveStartKey
    );

    return {
      items: result.items.map(e => this.toEnrollmentResponse(e)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Get enrollment history for a student
   */
  async getStudentEnrollmentHistory(
    studentId: string,
    context: RequestContext
  ): Promise<EnrollmentResponseDto[]> {
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

    if (enrollment.status !== 'enrolled') {
      throw new BadRequestException('Can only withdraw from active enrollment');
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
    let withdrawUpdateExpr = 'SET #status = :status, exitWithdrawDate = :exitWithdrawDate, withdrawalDate = :withdrawalDate, endDate = :endDate, notes = :notes, updatedAt = :updatedAt, updatedBy = :updatedBy';
    const withdrawValues: Record<string, any> = {
      ':status': 'withdrawn',
      ':exitWithdrawDate': withdrawDto.withdrawalDate,
      ':withdrawalDate': withdrawDto.withdrawalDate,
      ':endDate': withdrawDto.withdrawalDate,
      ':notes': withdrawalNotes,
      ':updatedAt': now,
      ':updatedBy': context.userId,
    };

    if (withdrawDto.exitWithdrawTypeDescriptor) {
      withdrawUpdateExpr += ', exitWithdrawTypeDescriptor = :exitWithdrawTypeDescriptor';
      withdrawValues[':exitWithdrawTypeDescriptor'] = withdrawDto.exitWithdrawTypeDescriptor;
    }

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

    this.logger.log(`Student withdrawn: ${studentId} from ${schoolId}`);

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

    // End current enrollment
    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      EntityKeyBuilder.enrollment(schoolId, academicYearId, studentId),
      'SET #status = :status, endDate = :endDate, notes = :notes, updatedAt = :updatedAt',
      {
        ':status': 'transferred',
        ':endDate': transferData.effectiveDate,
        ':notes': `Transferred to school ${transferData.toSchoolId}. Reason: ${transferData.reason || 'N/A'}`,
        ':updatedAt': now,
      },
      undefined,
      { '#status': 'status' }
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
   * Convert Enrollment entity to response DTO using mapper
   */
  private toEnrollmentResponse(enrollment: Enrollment): EnrollmentResponseDto {
    return enrollmentEntityToDto(enrollment);
  }
}

