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
} from '@edforge/shared-types';
import {
  studentEntityToDto,
  studentEntityToProfileDto,
  createStudentDtoToEntity,
  updateStudentDtoToEntity,
} from '../common/mappers';
import { EnrollmentService } from '../enrollment/enrollment.service';
import { AttendanceService } from '../attendance/attendance.service';

// Type alias for backward compatibility with controller
export type StudentProfileDto = StudentProfileResponseDto;

@Injectable()
export class StudentsService {
  private readonly logger = new Logger(StudentsService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: AcademicsEventsService,
    private readonly identityClient: IdentityClientService,
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
    // BASIC CRITICAL: Validate school exists before creating student
    // This prevents orphaned students and ensures data integrity
    await this.validateSchoolExists(createStudentDto.schoolId, context);
    
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const now = new Date().toISOString();
    const studentId = uuid();
    const studentNumber = createStudentDto.studentNumber || await this.generateStudentNumber(context.tenantId, createStudentDto.schoolId);

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
        guardians,
        primarySchoolId: createStudentDto.schoolId,
        status: 'active',
        enrollmentDate: createStudentDto.enrollmentDate || now.split('T')[0],
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );

    await this.dynamoDBClient.putItem(client, student);

    this.logger.log(`Student created: ${student.firstName} ${student.lastName} (${studentId})`);

    // Publish student created event (non-blocking)
    this.eventsService.publishStudentCreated(
      context.tenantId,
      studentId,
      createStudentDto.schoolId,
      createStudentDto.firstName,
      createStudentDto.lastName,
      createStudentDto.currentGradeLevel
    ).catch(err => this.logger.error('Failed to publish StudentCreated event', err));

    return this.toStudentResponse(student);
  }

  /**
   * Get student by ID
   */
  async getStudent(
    studentId: string,
    context: RequestContext
  ): Promise<StudentResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const student = await this.dynamoDBClient.getItem<Student>(
      client,
      context.tenantId,
      EntityKeyBuilder.student(studentId)
    );

    if (!student) {
      throw new NotFoundException('Student not found');
    }

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
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

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

    const result = await this.dynamoDBClient.queryGSI<Student>(
      client,
      'GSI1',
      gsi1pk,
      'STUDENT#',
      'begins_with',
      filterExpression,
      expressionValues,
      filters?.status ? { '#status': 'status' } : undefined,
      limit,
      true
    );

    // Filter by search term in memory (for now)
    let students = result.items;
    if (filters?.search) {
      const searchLower = filters.search.toLowerCase();
      students = students.filter(s =>
        s.firstName.toLowerCase().includes(searchLower) ||
        s.lastName.toLowerCase().includes(searchLower) ||
        s.studentNumber.toLowerCase().includes(searchLower)
      );
    }

    return {
      items: students.map(s => this.toStudentResponse(s)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
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
    context: RequestContext
  ): Promise<StudentProfileDto> {
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

    // Use mapper to create profile response
    return studentEntityToProfileDto(
      studentEntity,
      currentEnrollment,
      enrollmentHistory,
      attendanceSummary
    );
  }

  /**
   * Validate that school exists in Identity service
   * 
   * ARCHITECTURE: Cross-service validation via HTTP client with circuit breaker
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
   * Check for duplicate students by firstName, lastName, dateOfBirth
   */
  async checkDuplicate(
    firstName: string,
    lastName: string,
    dateOfBirth: string,
    schoolId: string,
    context: RequestContext
  ): Promise<{ exists: boolean; matches: StudentResponseDto[] }> {
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

    const firstNameLower = firstName.toLowerCase();
    const lastNameLower = lastName.toLowerCase();

    const matches = result.items.filter(
      s =>
        s.firstName.toLowerCase() === firstNameLower &&
        s.lastName.toLowerCase() === lastNameLower &&
        s.dateOfBirth === dateOfBirth,
    );

    return {
      exists: matches.length > 0,
      matches: matches.map(s => this.toStudentResponse(s)),
    };
  }

  /**
   * Generate unique student number
   */
  private async generateStudentNumber(tenantId: string, schoolId: string): Promise<string> {
    // Format: YYYY-SCHOOL-XXXX (e.g., 2024-001-0001)
    const year = new Date().getFullYear();
    const schoolPrefix = schoolId.substring(0, 3).toUpperCase();
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `${year}-${schoolPrefix}-${random}`;
  }

  /**
   * Convert Student entity to response DTO using mapper
   */
  private toStudentResponse(student: Student): StudentResponseDto {
    return studentEntityToDto(student);
  }
}

