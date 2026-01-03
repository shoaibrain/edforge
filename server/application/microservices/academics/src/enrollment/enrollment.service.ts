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
} from '../common/dto/enrollment.dto';

@Injectable()
export class EnrollmentService {
  private readonly logger = new Logger(EnrollmentService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
  ) {}

  /**
   * Create a new enrollment
   */
  async createEnrollment(
    createEnrollmentDto: CreateEnrollmentDto,
    context: RequestContext
  ): Promise<EnrollmentResponseDto> {
    const client = this.dynamoDBClient.getSystemClient();
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
        enrollmentDate: now.split('T')[0],
        startDate: createEnrollmentDto.startDate,
        endDate: createEnrollmentDto.endDate,
        sectionId: createEnrollmentDto.sectionId,
        homeroomTeacherId: createEnrollmentDto.homeroomTeacherId,
        enrollmentType: createEnrollmentDto.enrollmentType || 'new',
        previousSchoolId: createEnrollmentDto.previousSchoolId,
        previousSchoolName: createEnrollmentDto.previousSchoolName,
        transferReason: createEnrollmentDto.transferReason,
        specialEducation: createEnrollmentDto.specialEducation,
        eslStatus: createEnrollmentDto.eslStatus || 'none',
        lunchStatus: createEnrollmentDto.lunchStatus || 'regular',
        transportation: createEnrollmentDto.transportation || 'car',
        documentsReceived: createEnrollmentDto.documentsReceived,
        notes: createEnrollmentDto.notes,
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
    const client = this.dynamoDBClient.getSystemClient();

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
    const client = this.dynamoDBClient.getSystemClient();

    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);
    
    let filterExpression = 'entityType = :entityType';
    const expressionValues: Record<string, any> = {
      ':entityType': 'ENROLLMENT',
    };

    if (filters?.status) {
      filterExpression += ' AND #status = :status';
      expressionValues[':status'] = filters.status;
    }

    const result = await this.dynamoDBClient.queryGSI<Enrollment>(
      client,
      'GSI1',
      gsi1pk,
      `ENROLLMENT#${academicYearId}`,
      'begins_with',
      filterExpression,
      expressionValues,
      filters?.status ? { '#status': 'status' } : undefined,
      limit
    );

    // Filter by grade level in memory if needed
    let enrollments = result.items;
    if (filters?.gradeLevel) {
      enrollments = enrollments.filter(e => e.gradeLevel === filters.gradeLevel);
    }

    return {
      items: enrollments.map(e => this.toEnrollmentResponse(e)),
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
    const client = this.dynamoDBClient.getSystemClient();

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
    const client = this.dynamoDBClient.getSystemClient();

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
      if (updateEnrollmentDto[field as keyof UpdateEnrollmentDto] !== undefined) {
        updates.push(`${field} = :${field}`);
        values[`:${field}`] = updateEnrollmentDto[field as keyof UpdateEnrollmentDto];
      }
    }

    if (updateEnrollmentDto.status) {
      updates.push('#status = :status');
      values[':status'] = updateEnrollmentDto.status;
      names['#status'] = 'status';
    }

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
    const client = this.dynamoDBClient.getSystemClient();
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

    // Update enrollment
    const updatedEnrollment = await this.dynamoDBClient.updateItem<Enrollment>(
      client,
      context.tenantId,
      EntityKeyBuilder.enrollment(schoolId, academicYearId, studentId),
      'SET #status = :status, withdrawalDate = :withdrawalDate, endDate = :endDate, notes = :notes, updatedAt = :updatedAt, updatedBy = :updatedBy',
      {
        ':status': 'withdrawn',
        ':withdrawalDate': withdrawDto.withdrawalDate,
        ':endDate': withdrawDto.withdrawalDate,
        ':notes': withdrawDto.reason || '',
        ':updatedAt': now,
        ':updatedBy': context.userId,
      },
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
    const client = this.dynamoDBClient.getSystemClient();
    const now = new Date().toISOString();

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
        ':endDate': transferDto.effectiveDate,
        ':notes': `Transferred to school ${transferDto.toSchoolId}. Reason: ${transferDto.reason || 'N/A'}`,
        ':updatedAt': now,
      },
      undefined,
      { '#status': 'status' }
    );

    // Create new enrollment at destination school
    const newEnrollmentId = uuid();
    const newEnrollment = createEnrollmentEntity(
      context.tenantId,
      newEnrollmentId,
      studentId,
      transferDto.toSchoolId,
      transferDto.toAcademicYearId,
      {
        gradeLevel: currentEnrollment.gradeLevel,
        status: 'enrolled',
        enrollmentDate: now.split('T')[0],
        startDate: transferDto.effectiveDate,
        enrollmentType: 'transfer',
        previousSchoolId: schoolId,
        transferReason: transferDto.reason,
        specialEducation: currentEnrollment.specialEducation,
        eslStatus: currentEnrollment.eslStatus,
        lunchStatus: currentEnrollment.lunchStatus,
        transportation: currentEnrollment.transportation,
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
        ':schoolId': transferDto.toSchoolId,
        ':status': 'active',
        ':updatedAt': now,
      },
      undefined,
      { '#status': 'status' }
    );

    this.logger.log(`Student transferred: ${studentId} from ${schoolId} to ${transferDto.toSchoolId}`);

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
    const client = this.dynamoDBClient.getSystemClient();

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

    for (const enrollment of result.items) {
      // Count by grade level (only enrolled)
      if (enrollment.status === 'enrolled') {
        byGradeLevel[enrollment.gradeLevel] = (byGradeLevel[enrollment.gradeLevel] || 0) + 1;
      }
      // Count by status
      byStatus[enrollment.status] = (byStatus[enrollment.status] || 0) + 1;
    }

    return {
      schoolId,
      academicYearId,
      totalEnrolled: byStatus.enrolled,
      byGradeLevel,
      byStatus: byStatus as any,
    };
  }

  /**
   * Convert Enrollment entity to response DTO
   */
  private toEnrollmentResponse(enrollment: Enrollment): EnrollmentResponseDto {
    return {
      enrollmentId: enrollment.enrollmentId,
      studentId: enrollment.studentId,
      schoolId: enrollment.schoolId,
      academicYearId: enrollment.academicYearId,
      gradeLevel: enrollment.gradeLevel,
      status: enrollment.status,
      enrollmentDate: enrollment.enrollmentDate,
      startDate: enrollment.startDate,
      endDate: enrollment.endDate,
      withdrawalDate: enrollment.withdrawalDate,
      sectionId: enrollment.sectionId,
      homeroomTeacherId: enrollment.homeroomTeacherId,
      enrollmentType: enrollment.enrollmentType,
      previousSchoolId: enrollment.previousSchoolId,
      previousSchoolName: enrollment.previousSchoolName,
      specialEducation: enrollment.specialEducation,
      eslStatus: enrollment.eslStatus,
      lunchStatus: enrollment.lunchStatus,
      transportation: enrollment.transportation,
      notes: enrollment.notes,
      createdAt: enrollment.createdAt,
      updatedAt: enrollment.updatedAt,
    };
  }
}

