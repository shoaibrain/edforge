/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Student Service - CRUD operations for Student entities
 * 
 * ARCHITECTURE:
 * - Single DynamoDB table with hierarchical keys
 * - Tenant isolation at partition key level (tenantId)
 * - GSIs for efficient student-centric queries
 */

import { Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/dynamodb-client.service';
import { StudentWithGSI } from '../common/entities/enrollment.entities';
import { EntityKeyBuilder, RequestContext } from '../common/entities/base.entity';
import type { Student } from '@edforge/shared-types';
import { CreateStudentDto, UpdateStudentDto } from './dto/student.dto';
import { StudentNotFoundException } from '../common/errors/enrollment-exception';
import { CsvParserService } from '@app/csv-parser';
import { ICacheService } from '@app/cache';
import { Inject } from '@nestjs/common';

@Injectable()
export class StudentService {
  private readonly logger = new Logger(StudentService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly csvParser: CsvParserService,
    @Inject('ICacheService') private readonly cache: ICacheService
  ) {}

  /**
   * Create Student
   * 
   * WORKFLOW:
   * 1. Generate student ID and number
   * 2. Create Student entity with proper DynamoDB keys
   * 3. Write to DynamoDB
   * 
   * KEYS STRUCTURE:
   * - PK: tenantId
   * - SK: STUDENT#studentId
   * - GSI1-PK: schoolId or "UNENROLLED"
   * - GSI7-PK: studentId (student-centric queries)
   */
  async createStudent(
    tenantId: string,
    createStudentDto: CreateStudentDto,
    context: RequestContext
  ): Promise<Student> {
    const studentId = uuid();
    const timestamp = new Date().toISOString();
    
    // Generate student number (format: STU-YYYY-XXX)
    const year = new Date().getFullYear();
    const studentNumber = `STU-${year}-${uuid().substring(0, 8).toUpperCase()}`;

    const student: StudentWithGSI = {
      // DynamoDB Keys
      tenantId,
      entityKey: EntityKeyBuilder.student(studentId),
      
      // Identity
      studentId,
      studentNumber,
      firstName: createStudentDto.firstName,
      lastName: createStudentDto.lastName,
      middleName: createStudentDto.middleName,
      dateOfBirth: createStudentDto.dateOfBirth,
      gender: createStudentDto.gender,
      
      // Contact Information
      contactInfo: createStudentDto.contactInfo,
      
      // Guardians
      guardians: createStudentDto.guardians || [],
      
      // Medical Info (should be encrypted at application level before storing)
      medicalInfo: createStudentDto.medicalInfo,
      
      // Current Enrollment (null initially)
      currentEnrollment: undefined,
      
      // Audit
      createdAt: timestamp,
      createdBy: context.userId,
      updatedAt: timestamp,
      updatedBy: context.userId,
      version: 1,
      
      // Entity Type
      entityType: 'STUDENT',
      
      // GSI Keys
      gsi1pk: 'UNENROLLED',        // No school assignment yet
      gsi1sk: `STUDENT#${studentId}`,
      gsi7pk: studentId,            // GSI7 - student-centric
      gsi7sk: 'STUDENT#current'
    };

    // Save to DynamoDB
    await this.dynamoDBClient.putItem(student);

    this.logger.log(`Student created: ${student.firstName} ${student.lastName} (${studentId})`);
    
    // Cache the newly created student (without GSI keys)
    const cacheKey = `${tenantId}:student:${studentId}`;
    const { gsi1pk, gsi1sk, gsi7pk, gsi7sk, ...studentResponse } = student;
    const studentData = studentResponse as Student;
    await this.cache.set(cacheKey, studentData, 600);
    
    return studentData;
  }

  /**
   * Get Student by ID
   */
  /**
   * Get Student by ID
   * Phase 5: Advanced Features - Caching Layer
   * 
   * Cache key: {tenantId}:student:{studentId}, TTL: 10 minutes
   */
  async getStudent(tenantId: string, studentId: string): Promise<Student> {
    const cacheKey = `${tenantId}:student:${studentId}`;
    
    // Check cache first
    const cached = await this.cache.get<Student>(cacheKey);
    if (cached) {
      return cached;
    }

    // Cache miss - fetch from DynamoDB
    const entityKey = EntityKeyBuilder.student(studentId);
    const student = await this.dynamoDBClient.getItem(tenantId, entityKey);

    if (!student || student.entityType !== 'STUDENT') {
      throw new StudentNotFoundException(studentId);
    }

    // Return without GSI keys (API response)
    const { gsi1pk, gsi1sk, gsi7pk, gsi7sk, ...studentResponse } = student as StudentWithGSI;
    const studentData = studentResponse as Student;
    
    // Store in cache (TTL: 10 minutes = 600 seconds)
    await this.cache.set(cacheKey, studentData, 600);
    
    return studentData;
  }

  /**
   * Update Student
   */
  async updateStudent(
    tenantId: string,
    studentId: string,
    updateStudentDto: UpdateStudentDto,
    context: RequestContext
  ): Promise<Student> {
    // Get current student
    const currentStudent = await this.getStudent(tenantId, studentId);
    
    const timestamp = new Date().toISOString();
    const entityKey = EntityKeyBuilder.student(studentId);

    // Build update expression
    const updateExpressions: string[] = [];
    const expressionAttributeValues: any = {
      ':updatedAt': timestamp,
      ':updatedBy': context.userId,
      ':version': currentStudent.version + 1
    };
    const expressionAttributeNames: any = {};

    if (updateStudentDto.firstName !== undefined) {
      updateExpressions.push('#firstName = :firstName');
      expressionAttributeNames['#firstName'] = 'firstName';
      expressionAttributeValues[':firstName'] = updateStudentDto.firstName;
    }

    if (updateStudentDto.lastName !== undefined) {
      updateExpressions.push('#lastName = :lastName');
      expressionAttributeNames['#lastName'] = 'lastName';
      expressionAttributeValues[':lastName'] = updateStudentDto.lastName;
    }

    if (updateStudentDto.middleName !== undefined) {
      updateExpressions.push('middleName = :middleName');
      expressionAttributeValues[':middleName'] = updateStudentDto.middleName;
    }

    if (updateStudentDto.contactInfo !== undefined) {
      updateExpressions.push('contactInfo = :contactInfo');
      expressionAttributeValues[':contactInfo'] = updateStudentDto.contactInfo;
    }

    if (updateStudentDto.guardians !== undefined) {
      updateExpressions.push('guardians = :guardians');
      expressionAttributeValues[':guardians'] = updateStudentDto.guardians;
    }

    if (updateStudentDto.medicalInfo !== undefined) {
      updateExpressions.push('medicalInfo = :medicalInfo');
      expressionAttributeValues[':medicalInfo'] = updateStudentDto.medicalInfo;
    }

    // Always update audit fields
    updateExpressions.push('updatedAt = :updatedAt');
    updateExpressions.push('updatedBy = :updatedBy');
    updateExpressions.push('#version = :version');
    expressionAttributeNames['#version'] = 'version';

    const updateExpression = `SET ${updateExpressions.join(', ')}`;
    const conditionExpression = '#version = :currentVersion';
    expressionAttributeValues[':currentVersion'] = currentStudent.version;

    const updated = await this.dynamoDBClient.updateItem(
      tenantId,
      entityKey,
      updateExpression,
      expressionAttributeValues,
      conditionExpression,
      expressionAttributeNames
    );

    this.logger.log(`Student updated: ${studentId}`);
    // Return without GSI keys (API response)
    const { gsi1pk, gsi1sk, gsi7pk, gsi7sk, ...studentResponse } = updated as StudentWithGSI;
    const studentData = studentResponse as Student;
    
    // Invalidate and update cache
    const cacheKey = `${tenantId}:student:${studentId}`;
    await this.cache.set(cacheKey, studentData, 600);
    
    return studentData;
  }

  /**
   * List Students by School/Year (using GSI2)
   */
  async listStudentsBySchoolYear(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    limit: number = 50,
    lastEvaluatedKey?: string
  ): Promise<{ items: Student[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    // Decode pagination token if provided
    let exclusiveStartKey: any = undefined;
    if (lastEvaluatedKey) {
      try {
        exclusiveStartKey = JSON.parse(Buffer.from(lastEvaluatedKey, 'base64').toString());
      } catch (error) {
        this.logger.warn(`Invalid pagination token: ${lastEvaluatedKey}`);
      }
    }

    // Query enrollments first, then get students
    // Use limit + 1 to determine if there are more items
    const enrollmentResult = await this.dynamoDBClient.queryGSI(
      'GSI2',
      `${schoolId}#${academicYearId}`,
      'ENROLLMENT#',
      'begins_with',
      undefined,
      undefined,
      undefined,
      limit + 1, // Fetch one extra to determine if there are more
      exclusiveStartKey
    );

    // Filter by tenant and get unique student IDs
    const enrollments = enrollmentResult.items.filter(e => e.tenantId === tenantId && e.entityType === 'ENROLLMENT');
    const studentIds = [...new Set(enrollments.map(e => e.studentId))];

    // Check if there are more items
    const hasMore = enrollments.length > limit;
    const studentIdsToFetch = hasMore ? studentIds.slice(0, limit) : studentIds;

    // Batch get students
    const studentKeys = studentIdsToFetch.map(id => ({
      tenantId,
      entityKey: EntityKeyBuilder.student(id)
    }));

    const students = await this.dynamoDBClient.batchGetItems(studentKeys);
    
    // Remove GSI keys from response
    const studentItems = students
      .filter(s => s.entityType === 'STUDENT')
      .map(s => {
        const { gsi1pk, gsi1sk, gsi7pk, gsi7sk, ...student } = s as StudentWithGSI;
        return student as Student;
      });

    // Encode pagination token if there are more items
    let encodedLastEvaluatedKey: string | undefined = undefined;
    if (enrollmentResult.lastEvaluatedKey && hasMore) {
      encodedLastEvaluatedKey = Buffer.from(JSON.stringify(enrollmentResult.lastEvaluatedKey)).toString('base64');
    }

    return {
      items: studentItems,
      lastEvaluatedKey: encodedLastEvaluatedKey,
      hasMore
    };
  }

  /**
   * List Students by School (using GSI1)
   * Phase 5: Performance Optimizations - Pagination
   */
  async listStudentsBySchool(
    tenantId: string,
    schoolId: string,
    limit: number = 50,
    lastEvaluatedKey?: string
  ): Promise<{ items: Student[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    // Decode pagination token if provided
    let exclusiveStartKey: any = undefined;
    if (lastEvaluatedKey) {
      try {
        exclusiveStartKey = JSON.parse(Buffer.from(lastEvaluatedKey, 'base64').toString());
      } catch (error) {
        this.logger.warn(`Invalid pagination token: ${lastEvaluatedKey}`);
      }
    }

    const result = await this.dynamoDBClient.queryGSI(
      'GSI1',
      schoolId,
      'STUDENT#',
      'begins_with',
      undefined,
      undefined,
      undefined,
      limit + 1, // Fetch one extra to determine if there are more
      exclusiveStartKey
    );

    // Filter by tenant and remove GSI keys
    const filteredItems = result.items.filter(item => item.tenantId === tenantId && item.entityType === 'STUDENT');
    
    // Check if there are more items
    const hasMore = filteredItems.length > limit;
    const items = hasMore ? filteredItems.slice(0, limit) : filteredItems;
    
    const studentItems = items.map(item => {
      const { gsi1pk, gsi1sk, gsi7pk, gsi7sk, ...student } = item as StudentWithGSI;
      return student as Student;
    });

    // Encode pagination token if there are more items
    let encodedLastEvaluatedKey: string | undefined = undefined;
    if (result.lastEvaluatedKey && hasMore) {
      encodedLastEvaluatedKey = Buffer.from(JSON.stringify(result.lastEvaluatedKey)).toString('base64');
    }

    return {
      items: studentItems,
      lastEvaluatedKey: encodedLastEvaluatedKey,
      hasMore
    };
  }

  /**
   * Get Student Enrollment History (using GSI7)
   */
  async getStudentEnrollmentHistory(
    tenantId: string,
    studentId: string
  ): Promise<any[]> {
    const result = await this.dynamoDBClient.queryGSI(
      'GSI7',
      studentId,
      'ENROLLMENT#',
      'begins_with',
      undefined,
      undefined,
      undefined,
      100
    );

    // Filter by tenant
    return result.items.filter(item => item.tenantId === tenantId && item.entityType === 'ENROLLMENT');
  }

  /**
   * Delete Student (soft delete - update status)
   */
  async deleteStudent(
    tenantId: string,
    studentId: string,
    context: RequestContext
  ): Promise<void> {
    // Check if student has active enrollments
    const history = await this.getStudentEnrollmentHistory(tenantId, studentId);
    const activeEnrollments = history.filter(e => e.status === 'active');

    if (activeEnrollments.length > 0) {
      throw new Error('Cannot delete student with active enrollments');
    }

    // Soft delete - mark as deleted
    const timestamp = new Date().toISOString();
    const entityKey = EntityKeyBuilder.student(studentId);

    await this.dynamoDBClient.updateItem(
      tenantId,
      entityKey,
      'SET #status = :status, updatedAt = :updatedAt, updatedBy = :updatedBy',
      {
        ':status': 'deleted',
        ':updatedAt': timestamp,
        ':updatedBy': context.userId
      },
      undefined,
      { '#status': 'status' }
    );

    // Invalidate cache after delete
    const cacheKey = `${tenantId}:student:${studentId}`;
    await this.cache.delete(cacheKey);

    this.logger.log(`Student deleted: ${studentId}`);
  }

  /**
   * Export Students to CSV
   * Phase 5: Advanced Features - Import/Export
   */
  async exportStudentsToCsv(
    tenantId: string,
    schoolId?: string,
    academicYearId?: string
  ): Promise<string> {
    try {
      // Get all students (paginate through all pages for export)
      let allStudents: Student[] = [];
      let lastKey: string | undefined = undefined;
      let hasMore = true;
      
      while (hasMore) {
        let result: { items: Student[]; lastEvaluatedKey?: string; hasMore: boolean };
        
        if (schoolId && academicYearId) {
          result = await this.listStudentsBySchoolYear(tenantId, schoolId, academicYearId, 1000, lastKey);
        } else if (schoolId) {
          result = await this.listStudentsBySchool(tenantId, schoolId, 1000, lastKey);
        } else {
          throw new BadRequestException('schoolId is required for export');
        }
        
        allStudents = allStudents.concat(result.items);
        hasMore = result.hasMore;
        lastKey = result.lastEvaluatedKey;
      }

      // Convert to CSV - flatten nested fields
      const flattenedStudents = allStudents.map(s => ({
        studentId: s.studentId,
        studentNumber: s.studentNumber,
        firstName: s.firstName,
        lastName: s.lastName,
        dateOfBirth: s.dateOfBirth,
        gender: s.gender,
        email: s.contactInfo?.email || '',
        phone: s.contactInfo?.phone || '',
        address: s.contactInfo?.address ? `${s.contactInfo.address.street}, ${s.contactInfo.address.city}` : '',
        gradeLevel: s.currentEnrollment?.gradeLevel || '',
        status: s.currentEnrollment?.status || ''
      }));

      const csv = this.csvParser.toCsv(flattenedStudents, [
        'studentId',
        'studentNumber',
        'firstName',
        'lastName',
        'dateOfBirth',
        'gender',
        'email',
        'phone',
        'address',
        'gradeLevel',
        'status'
      ]);

      this.logger.log(`Exported ${flattenedStudents.length} students to CSV`);
      return csv;
    } catch (error: any) {
      this.logger.error(`Failed to export students: ${error.message}`);
      throw new InternalServerErrorException('Failed to export students');
    }
  }

  /**
   * Import Students from CSV
   * Phase 5: Advanced Features - Import/Export
   */
  async importStudentsFromCsv(
    tenantId: string,
    file: any,
    context: RequestContext
  ): Promise<{
    success: Array<{ studentId: string; studentNumber: string }>;
    failed: Array<{ row: number; error: string }>;
    summary: { total: number; succeeded: number; failed: number };
  }> {
    try {
      // Parse CSV
      const parseResult = this.csvParser.parse(file.buffer);
      const validationErrors = this.csvParser.validateRequiredFields(parseResult.records, [
        'firstName',
        'lastName',
        'dateOfBirth'
      ]);

      if (validationErrors.length > 0) {
        return {
          success: [],
          failed: validationErrors,
          summary: {
            total: parseResult.records.length,
            succeeded: 0,
            failed: validationErrors.length
          }
        };
      }

      // Create students using BatchWriteItem
      const students: StudentWithGSI[] = [];
      const failures: Array<{ row: number; error: string }> = [];
      const timestamp = new Date().toISOString();

      parseResult.records.forEach((record, index) => {
        try {
          const studentId = uuid();
          const student: StudentWithGSI = {
            tenantId,
            entityKey: EntityKeyBuilder.student(studentId),
            entityType: 'STUDENT',
            studentId,
            studentNumber: record.studentNumber || `STU-${Date.now()}-${index}`,
            firstName: record.firstName,
            lastName: record.lastName,
            dateOfBirth: record.dateOfBirth,
            gender: record.gender as any,
            contactInfo: {
              email: record.email,
              phone: record.phone,
              address: record.address || {
                street: '',
                city: '',
                state: '',
                zipCode: '',
                country: 'US'
              }
            },
            guardians: [],
            createdAt: timestamp,
            createdBy: context.userId,
            updatedAt: timestamp,
            updatedBy: context.userId,
            version: 1,
            gsi1pk: record.schoolId || 'UNENROLLED',
            gsi1sk: `STUDENT#${studentId}`,
            gsi7pk: studentId,
            gsi7sk: `STUDENT#${timestamp}`
          };
          students.push(student);
        } catch (error: any) {
          failures.push({
            row: index + 2,
            error: error.message || 'Unknown error'
          });
        }
      });

      // Write in batches
      const batchSize = 25;
      const batches: StudentWithGSI[][] = [];
      for (let i = 0; i < students.length; i += batchSize) {
        batches.push(students.slice(i, i + batchSize));
      }

      const success: Array<{ studentId: string; studentNumber: string }> = [];

      for (const batch of batches) {
        try {
          await this.dynamoDBClient.batchWriteItems(batch);
          batch.forEach(s => {
            success.push({ studentId: s.studentId, studentNumber: s.studentNumber });
          });
        } catch (error: any) {
          batch.forEach(s => {
            failures.push({
              row: 0,
              error: `Batch write failed: ${error.message}`
            });
          });
        }
      }

      return {
        success,
        failed: failures,
        summary: {
          total: parseResult.records.length,
          succeeded: success.length,
          failed: failures.length
        }
      };
    } catch (error: any) {
      this.logger.error(`Failed to import students: ${error.message}`);
      throw new InternalServerErrorException('Failed to import students from CSV');
    }
  }
}

