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
  StudentProfileDto,
} from '../common/dto/student.dto';
import { EnrollmentService } from '../enrollment/enrollment.service';
import { AttendanceService } from '../attendance/attendance.service';

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
   */
  async createStudent(
    createStudentDto: CreateStudentDto,
    context: RequestContext
  ): Promise<StudentResponseDto> {
    // CRITICAL: Validate school exists before creating student
    // This prevents orphaned students and ensures data integrity
    await this.validateSchoolExists(createStudentDto.schoolId, context);
    
    const client = this.dynamoDBClient.getSystemClient();
    const now = new Date().toISOString();
    const studentId = uuid();
    const studentNumber = await this.generateStudentNumber(context.tenantId, createStudentDto.schoolId);

    // Prepare guardians with IDs
    const guardians: Guardian[] = (createStudentDto.guardians || []).map((g, index) => ({
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
        studentNumber,
        firstName: createStudentDto.firstName,
        lastName: createStudentDto.lastName,
        middleName: createStudentDto.middleName,
        preferredName: createStudentDto.preferredName,
        dateOfBirth: createStudentDto.dateOfBirth,
        gender: createStudentDto.gender,
        email: createStudentDto.email,
        phone: createStudentDto.phone,
        address: createStudentDto.address,
        guardians,
        emergencyContact: createStudentDto.emergencyContact,
        medicalInfo: createStudentDto.medicalInfo,
        primarySchoolId: createStudentDto.schoolId,
        currentGradeLevel: createStudentDto.currentGradeLevel,
        status: 'active',
        enrollmentDate: now.split('T')[0],
        specialPrograms: createStudentDto.specialPrograms,
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
    const client = this.dynamoDBClient.getSystemClient();

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
    const client = this.dynamoDBClient.getSystemClient();

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
    const client = this.dynamoDBClient.getSystemClient();

    const student = await this.dynamoDBClient.getItem<Student>(
      client,
      context.tenantId,
      EntityKeyBuilder.student(studentId)
    );

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};
    const names: Record<string, string> = {};

    // Simple field updates
    const simpleFields = [
      'firstName', 'lastName', 'middleName', 'preferredName', 
      'dateOfBirth', 'gender', 'email', 'phone', 'currentGradeLevel',
      'photoUrl'
    ];

    for (const field of simpleFields) {
      if (updateStudentDto[field as keyof UpdateStudentDto] !== undefined) {
        updates.push(`${field} = :${field}`);
        values[`:${field}`] = updateStudentDto[field as keyof UpdateStudentDto];
      }
    }

    // Status update
    if (updateStudentDto.status) {
      updates.push('#status = :status');
      values[':status'] = updateStudentDto.status;
      names['#status'] = 'status';

      if (updateStudentDto.status === 'withdrawn' || updateStudentDto.status === 'transferred') {
        updates.push('withdrawalDate = :withdrawalDate');
        values[':withdrawalDate'] = new Date().toISOString().split('T')[0];
      }
    }

    // Complex field updates
    if (updateStudentDto.address) {
      updates.push('address = :address');
      values[':address'] = updateStudentDto.address;
    }

    if (updateStudentDto.guardians) {
      updates.push('guardians = :guardians');
      values[':guardians'] = updateStudentDto.guardians.map((g, i) => ({
        ...g,
        guardianId: g.guardianId || uuid(),
        isPrimary: g.isPrimary ?? i === 0,
        hasPortalAccess: g.hasPortalAccess ?? false,
      }));
    }

    if (updateStudentDto.emergencyContact) {
      updates.push('emergencyContact = :emergencyContact');
      values[':emergencyContact'] = updateStudentDto.emergencyContact;
    }

    if (updateStudentDto.medicalInfo) {
      updates.push('medicalInfo = :medicalInfo');
      values[':medicalInfo'] = updateStudentDto.medicalInfo;
    }

    if (updateStudentDto.specialPrograms) {
      updates.push('specialPrograms = :specialPrograms');
      values[':specialPrograms'] = updateStudentDto.specialPrograms;
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
    if (updateStudentDto.firstName || updateStudentDto.lastName) {
      const newFirstName = updateStudentDto.firstName || student.firstName;
      const newLastName = updateStudentDto.lastName || student.lastName;
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
    const updatedFields = Object.keys(updateStudentDto).filter(k => updateStudentDto[k as keyof UpdateStudentDto] !== undefined);
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
    const client = this.dynamoDBClient.getSystemClient();

    const student = await this.dynamoDBClient.getItem<Student>(
      client,
      context.tenantId,
      EntityKeyBuilder.student(studentId)
    );

    if (!student) {
      throw new NotFoundException('Student not found');
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
    // Get basic student info
    const student = await this.getStudent(studentId, context);
    
    // Get enrollment history
    const enrollments = await this.enrollmentService.getStudentEnrollmentHistory(studentId, context);
    
    // Find current/most recent enrollment (enrolled is the active status)
    const currentEnrollment = enrollments.find(e => e.status === 'enrolled') || enrollments[0];
    
    // Get attendance summary for current enrollment
    let attendanceSummary: StudentProfileDto['attendanceSummary'] | undefined;
    if (currentEnrollment) {
      try {
        // Calculate date range for current year (use enrollment date to now)
        const startDate = currentEnrollment.enrollmentDate;
        const endDate = new Date().toISOString().split('T')[0];
        
        const attSummary = await this.attendanceService.getStudentAttendanceSummary(
          studentId,
          currentEnrollment.schoolId,
          currentEnrollment.academicYearId,
          startDate,
          endDate,
          context
        );
        attendanceSummary = {
          totalDays: attSummary.totalDays,
          presentDays: attSummary.present,
          absentDays: attSummary.absent,
          lateDays: attSummary.late,
          excusedAbsences: attSummary.excused,
          attendanceRate: attSummary.attendanceRate,
        };
      } catch (error) {
        // Attendance may not be available, continue without it
        this.logger.debug(`No attendance data for student ${studentId}`);
      }
    }

    // Calculate stats
    const enrollmentCount = enrollments.length;
    const uniqueYears = new Set(enrollments.map(e => e.academicYearId));

    // Check for special programs
    const hasActiveIEP = student.specialPrograms?.includes('IEP') || false;
    const has504Plan = student.specialPrograms?.includes('504') || false;

    return {
      student,
      currentEnrollment: currentEnrollment ? {
        enrollmentId: currentEnrollment.enrollmentId,
        schoolId: currentEnrollment.schoolId,
        academicYearId: currentEnrollment.academicYearId,
        gradeLevel: currentEnrollment.gradeLevel,
        status: currentEnrollment.status,
        enrollmentDate: currentEnrollment.enrollmentDate,
      } : undefined,
      attendanceSummary,
      academicSummary: undefined, // TODO: Implement when grades service is ready
      stats: {
        enrollmentCount,
        yearsAttended: uniqueYears.size,
        hasActiveIEP,
        has504Plan,
      },
    };
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
   * Convert Student entity to response DTO
   */
  private toStudentResponse(student: Student): StudentResponseDto {
    return {
      studentId: student.studentId,
      studentNumber: student.studentNumber,
      firstName: student.firstName,
      lastName: student.lastName,
      middleName: student.middleName,
      preferredName: student.preferredName,
      dateOfBirth: student.dateOfBirth,
      gender: student.gender,
      email: student.email,
      phone: student.phone,
      address: student.address,
      guardians: student.guardians,
      emergencyContact: student.emergencyContact,
      primarySchoolId: student.primarySchoolId,
      currentGradeLevel: student.currentGradeLevel,
      status: student.status,
      enrollmentDate: student.enrollmentDate,
      specialPrograms: student.specialPrograms,
      photoUrl: student.photoUrl,
      createdAt: student.createdAt,
      updatedAt: student.updatedAt,
    };
  }
}

