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

import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/dynamodb-client.service';
import { StudentWithGSI } from '../common/entities/enrollment.entities';
import { EntityKeyBuilder, RequestContext } from '../common/entities/base.entity';
import type { Student } from '@edforge/shared-types';
import { CreateStudentDto, UpdateStudentDto } from './dto/student.dto';
import { StudentNotFoundException } from '../common/errors/enrollment-exception';

@Injectable()
export class StudentService {
  private readonly logger = new Logger(StudentService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService
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
  ): Promise<StudentWithGSI> {
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
    return student;
  }

  /**
   * Get Student by ID
   */
  async getStudent(tenantId: string, studentId: string): Promise<Student> {
    const entityKey = EntityKeyBuilder.student(studentId);
    const student = await this.dynamoDBClient.getItem(tenantId, entityKey);

    if (!student || student.entityType !== 'STUDENT') {
      throw new StudentNotFoundException(studentId);
    }

    // Return without GSI keys (API response)
    const { gsi1pk, gsi1sk, gsi7pk, gsi7sk, ...studentResponse } = student as StudentWithGSI;
    return studentResponse as Student;
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
    return studentResponse as Student;
  }

  /**
   * List Students by School/Year (using GSI2)
   */
  async listStudentsBySchoolYear(
    tenantId: string,
    schoolId: string,
    academicYearId: string
  ): Promise<Student[]> {
    // Query enrollments first, then get students
    const enrollments = await this.dynamoDBClient.queryGSI(
      'GSI2',
      `${schoolId}#${academicYearId}`,
      'ENROLLMENT#',
      'begins_with',
      undefined,
      undefined,
      undefined,
      100
    );

    // Filter by tenant and get unique student IDs
    const studentIds = [...new Set(
      enrollments
        .filter(e => e.tenantId === tenantId && e.entityType === 'ENROLLMENT')
        .map(e => e.studentId)
    )];

    // Batch get students
    const studentKeys = studentIds.map(id => ({
      tenantId,
      entityKey: EntityKeyBuilder.student(id)
    }));

    const students = await this.dynamoDBClient.batchGetItems(studentKeys);
    // Remove GSI keys from response
    return students
      .filter(s => s.entityType === 'STUDENT')
      .map(s => {
        const { gsi1pk, gsi1sk, gsi7pk, gsi7sk, ...student } = s as StudentWithGSI;
        return student as Student;
      });
  }

  /**
   * List Students by School (using GSI1)
   */
  async listStudentsBySchool(
    tenantId: string,
    schoolId: string
  ): Promise<Student[]> {
    const items = await this.dynamoDBClient.queryGSI(
      'GSI1',
      schoolId,
      'STUDENT#',
      'begins_with',
      undefined,
      undefined,
      undefined,
      100
    );

    // Filter by tenant and remove GSI keys
    return items
      .filter(item => item.tenantId === tenantId && item.entityType === 'STUDENT')
      .map(item => {
        const { gsi1pk, gsi1sk, gsi7pk, gsi7sk, ...student } = item as StudentWithGSI;
        return student as Student;
      });
  }

  /**
   * Get Student Enrollment History (using GSI7)
   */
  async getStudentEnrollmentHistory(
    tenantId: string,
    studentId: string
  ): Promise<any[]> {
    const items = await this.dynamoDBClient.queryGSI(
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
    return items.filter(item => item.tenantId === tenantId && item.entityType === 'ENROLLMENT');
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

    this.logger.log(`Student deleted: ${studentId}`);
  }
}

