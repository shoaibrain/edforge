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
    const studentNumber = createStudentDto.studentNumber || await this.studentIdService.generateStudentUniqueId(
      context.tenantId,
      createStudentDto.schoolId,
      undefined, // schoolCode - will fallback to schoolId prefix
      context.jwtToken,
    );

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
    const duplicates = await this.checkDuplicateDetailed(firstName, lastName, dateOfBirth, schoolId, context);
    const allMatches = duplicates.filter(d => d.confidence !== 'low');
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
    if (!rows || rows.length === 0) {
      throw new BadRequestException('No student data provided');
    }
    if (rows.length > 500) {
      throw new BadRequestException('Maximum 500 students per import');
    }

    await this.validateSchoolExists(schoolId, context);

    const errors: Array<{ row: number; field: string; message: string }> = [];
    const duplicates: Array<{ row: number; matches: Array<{ studentId: string; name: string; confidence: string }> }> = [];
    let imported = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1; // 1-based for user display

      // Validate required fields
      const firstName = String(row.firstName || '').trim();
      const lastName = String(row.lastName || '').trim();
      const dateOfBirth = String(row.birthDate || row.dateOfBirth || '').trim();
      const gender = String(row.gender || '').trim().toLowerCase();
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
      if (!gender || !['male', 'female', 'other', 'prefer_not_to_say'].includes(gender)) {
        errors.push({ row: rowNum, field: 'gender', message: 'Gender is required (male, female, other, prefer_not_to_say)' });
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

      const createDto: CreateStudentDto = {
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
      };

      // Create the student
      try {
        await this.createStudent(createDto, context);
        imported++;
      } catch (err: any) {
        errors.push({
          row: rowNum,
          field: 'general',
          message: err.message || 'Failed to create student',
        });
      }
    }

    this.logger.log(`CSV Import: ${imported} imported, ${skipped} skipped, ${errors.length} errors, ${duplicates.length} duplicate flags`);

    return { imported, skipped, errors, duplicates };
  }

  /**
   * Convert Student entity to response DTO using mapper
   */
  private toStudentResponse(student: Student): StudentResponseDto {
    return studentEntityToDto(student);
  }
}

