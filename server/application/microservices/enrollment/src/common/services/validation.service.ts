/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Validation Service - Input validation and business rule enforcement
 * 
 * ARCHITECTURE RATIONALE:
 * - Centralized validation logic for consistency
 * - Fail-fast approach: validate before any DB operations
 * - Clear error messages for API consumers
 * - Supports global deployments (timezone, phone formats, etc.)
 * 
 * VALIDATION STRATEGY:
 * 1. Schema validation (data types, formats, ranges)
 * 2. Business rule validation (uniqueness, relationships)
 * 3. Referential integrity checks
 * 4. Domain-specific validations (dates, capacities)
 */

import { Injectable, BadRequestException } from '@nestjs/common';
import { DynamoDBClientService } from '../dynamodb-client.service';
import { EntityKeyBuilder } from '../entities/base.entity';
import { CreateStudentDto, UpdateStudentDto } from '../../student/dto/student.dto';
import { CreateEnrollmentDto, TransferEnrollmentDto } from '../../enrollment/dto/enrollment.dto';

@Injectable()
export class ValidationService {
  constructor(private readonly dynamoDBClient: DynamoDBClientService) {}

  // ============================================================================
  // STUDENT VALIDATIONS
  // ============================================================================

  async validateStudentCreation(tenantId: string, data: CreateStudentDto): Promise<void> {
    const errors: string[] = [];

    // Name validations
    if (!data.firstName || data.firstName.trim().length < 1) {
      errors.push('First name is required and must be at least 1 character');
    }

    if (!data.lastName || data.lastName.trim().length < 1) {
      errors.push('Last name is required and must be at least 1 character');
    }

    // Date of birth validation
    if (!data.dateOfBirth) {
      errors.push('Date of birth is required');
    } else {
      this.validateDateOfBirth(data.dateOfBirth, errors);
    }

    // Contact info validation
    if (data.contactInfo) {
      if (data.contactInfo.email && !this.isValidEmail(data.contactInfo.email)) {
        errors.push('Invalid email format');
      }

      if (data.contactInfo.phone && !this.isValidPhone(data.contactInfo.phone)) {
        errors.push('Invalid phone format (use E.164 format: +1-555-0123)');
      }

      if (data.contactInfo.address) {
        this.validateAddress(data.contactInfo.address, errors);
      }
    }

    // Guardian relationships validation
    if (data.guardians && data.guardians.length > 0) {
      const primaryGuardians = data.guardians.filter(g => g.isPrimary);
      if (primaryGuardians.length === 0) {
        errors.push('At least one primary guardian is required');
      }
      if (primaryGuardians.length > 1) {
        errors.push('Only one primary guardian is allowed');
      }

      // Validate guardian IDs exist (would need to query Parent entities)
      // For MVP, we'll validate format only
      for (const guardian of data.guardians) {
        if (!guardian.guardianId || !this.isValidUUID(guardian.guardianId)) {
          errors.push(`Invalid guardian ID format: ${guardian.guardianId}`);
        }
      }
    }

    // Medical info structure validation
    if (data.medicalInfo) {
      if (!data.medicalInfo.emergencyContact) {
        errors.push('Emergency contact is required when medical info is provided');
      } else {
        if (!data.medicalInfo.emergencyContact.name) {
          errors.push('Emergency contact name is required');
        }
        if (!data.medicalInfo.emergencyContact.phone) {
          errors.push('Emergency contact phone is required');
        }
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Student validation failed',
        errors
      });
    }
  }

  async validateStudentUpdate(tenantId: string, studentId: string, data: UpdateStudentDto): Promise<void> {
    const errors: string[] = [];

    // Verify student exists
    const studentExists = await this.checkStudentExists(tenantId, studentId);
    if (!studentExists) {
      errors.push(`Student with ID ${studentId} does not exist`);
    }

    // Name validations (if provided)
    if (data.firstName !== undefined && data.firstName.trim().length < 1) {
      errors.push('First name must be at least 1 character');
    }

    if (data.lastName !== undefined && data.lastName.trim().length < 1) {
      errors.push('Last name must be at least 1 character');
    }

    // Contact info validation (if provided)
    if (data.contactInfo) {
      if (data.contactInfo.email && !this.isValidEmail(data.contactInfo.email)) {
        errors.push('Invalid email format');
      }

      if (data.contactInfo.phone && !this.isValidPhone(data.contactInfo.phone)) {
        errors.push('Invalid phone format (use E.164 format: +1-555-0123)');
      }

      if (data.contactInfo.address) {
        this.validateAddress(data.contactInfo.address, errors);
      }
    }

    // Guardian relationships validation (if provided)
    if (data.guardians && data.guardians.length > 0) {
      const primaryGuardians = data.guardians.filter(g => g.isPrimary);
      if (primaryGuardians.length === 0) {
        errors.push('At least one primary guardian is required');
      }
      if (primaryGuardians.length > 1) {
        errors.push('Only one primary guardian is allowed');
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Student update validation failed',
        errors
      });
    }
  }

  // ============================================================================
  // ENROLLMENT VALIDATIONS
  // ============================================================================

  async validateEnrollmentCreation(
    tenantId: string,
    studentId: string,
    data: CreateEnrollmentDto
  ): Promise<void> {
    const errors: string[] = [];

    // Verify student exists
    const studentExists = await this.checkStudentExists(tenantId, studentId);
    if (!studentExists) {
      errors.push(`Student with ID ${studentId} does not exist`);
    }

    // Grade level validation
    this.validateGradeLevel(data.gradeLevel, errors);

    // Enrollment date validation
    if (!data.enrollmentDate) {
      errors.push('Enrollment date is required');
    } else {
      const enrollmentDate = new Date(data.enrollmentDate);
      const today = new Date();
      today.setHours(23, 59, 59, 999); // End of today

      if (isNaN(enrollmentDate.getTime())) {
        errors.push('Invalid enrollment date format (use ISO 8601: YYYY-MM-DD)');
      } else if (enrollmentDate > today) {
        errors.push('Enrollment date cannot be in the future');
      }
    }

    // Academic year validation
    const academicYearExists = await this.checkAcademicYearExists(tenantId, data.academicYearId);
    if (!academicYearExists) {
      errors.push(`Academic year with ID ${data.academicYearId} does not exist or is not active`);
    }

    // School validation
    const schoolExists = await this.checkSchoolExists(tenantId, data.schoolId);
    if (!schoolExists) {
      errors.push(`School with ID ${data.schoolId} does not exist or is not active`);
    }

    // Duplicate enrollment check
    const duplicateExists = await this.checkDuplicateEnrollment(tenantId, studentId, data.academicYearId);
    if (duplicateExists) {
      errors.push(`Student is already enrolled in academic year ${data.academicYearId}`);
    }

    // Section validation (if provided)
    if (data.section && !/^[A-Z]$/.test(data.section)) {
      errors.push('Section must be a single uppercase letter (A-Z)');
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Enrollment validation failed',
        errors
      });
    }
  }

  async validateEnrollmentStatusTransition(currentStatus: string, newStatus: string): Promise<void> {
    const errors: string[] = [];

    const validTransitions: Record<string, string[]> = {
      'pending': ['active', 'cancelled'],
      'active': ['suspended', 'graduated', 'transferred', 'withdrawn'],
      'suspended': ['active', 'withdrawn'],
      'graduated': [],
      'transferred': [],
      'withdrawn': []
    };

    const allowedStatuses = validTransitions[currentStatus] || [];
    if (!allowedStatuses.includes(newStatus)) {
      errors.push(
        `Invalid status transition from '${currentStatus}' to '${newStatus}'. ` +
        `Allowed transitions: ${allowedStatuses.length > 0 ? allowedStatuses.join(', ') : 'none'}`
      );
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Enrollment status transition validation failed',
        errors
      });
    }
  }

  async validateTransfer(
    tenantId: string,
    enrollmentId: string,
    data: TransferEnrollmentDto
  ): Promise<void> {
    const errors: string[] = [];

    // Target school validation
    const targetSchoolExists = await this.checkSchoolExists(tenantId, data.targetSchoolId);
    if (!targetSchoolExists) {
      errors.push(`Target school with ID ${data.targetSchoolId} does not exist or is not active`);
    }

    // Target academic year validation
    const targetYearExists = await this.checkAcademicYearExists(tenantId, data.targetAcademicYearId);
    if (!targetYearExists) {
      errors.push(`Target academic year with ID ${data.targetAcademicYearId} does not exist or is not active`);
    }

    // Target grade level validation
    this.validateGradeLevel(data.targetGradeLevel, errors);

    // Transfer date validation
    if (!data.transferDate) {
      errors.push('Transfer date is required');
    } else {
      const transferDate = new Date(data.transferDate);
      if (isNaN(transferDate.getTime())) {
        errors.push('Invalid transfer date format (use ISO 8601: YYYY-MM-DD)');
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Transfer validation failed',
        errors
      });
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private validateDateOfBirth(dateOfBirth: string, errors: string[]): void {
    const dob = new Date(dateOfBirth);
    if (isNaN(dob.getTime())) {
      errors.push('Invalid date of birth format (use ISO 8601: YYYY-MM-DD)');
      return;
    }

    const today = new Date();
    const age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    const actualAge = monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate()) ? age - 1 : age;

    if (actualAge < 4 || actualAge > 18) {
      errors.push('Date of birth must correspond to age between 4 and 18 years (K-12 education)');
    }
  }

  private validateGradeLevel(gradeLevel: string, errors: string[]): void {
    if (!gradeLevel) {
      errors.push('Grade level is required');
      return;
    }

    const validGrades = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
    if (!validGrades.includes(gradeLevel)) {
      errors.push(`Grade level must be one of: ${validGrades.join(', ')}`);
    }
  }

  private validateAddress(address: any, errors: string[]): void {
    if (!address.street || address.street.trim().length < 1) {
      errors.push('Street address is required');
    }

    if (!address.city || address.city.trim().length < 1) {
      errors.push('City is required');
    }

    if (!address.state || address.state.trim().length < 1) {
      errors.push('State is required');
    }

    if (!address.country || address.country.length !== 2) {
      errors.push('Country code must be 2-letter ISO code (US, CA, GB, etc.)');
    }

    if (!address.postalCode || address.postalCode.trim().length < 1) {
      errors.push('Postal code is required');
    }
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private isValidPhone(phone: string): boolean {
    // E.164 format: +[country code][number]
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    return phoneRegex.test(phone);
  }

  private isValidCurrency(currency: string): boolean {
    // ISO 4217 currency codes (3 letters)
    const currencyRegex = /^[A-Z]{3}$/;
    return currencyRegex.test(currency);
  }

  private isValidUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  // ============================================================================
  // DATABASE CHECKS
  // ============================================================================

  private async checkStudentExists(tenantId: string, studentId: string): Promise<boolean> {
    try {
      const entityKey = EntityKeyBuilder.student(studentId);
      const student = await this.dynamoDBClient.getItem(tenantId, entityKey);
      return student !== null && student.entityType === 'STUDENT';
    } catch (error) {
      return false;
    }
  }

  private async checkSchoolExists(tenantId: string, schoolId: string): Promise<boolean> {
    try {
      // Query for School entity - using GSI1 or direct query
      // For MVP, we'll use a simple query pattern
      const entityKey = `SCHOOL#${schoolId}`;
      const school = await this.dynamoDBClient.getItem(tenantId, entityKey);
      return school !== null && school.entityType === 'SCHOOL' && school.status === 'active';
    } catch (error) {
      return false;
    }
  }

  private async checkAcademicYearExists(tenantId: string, academicYearId: string): Promise<boolean> {
    try {
      // Query for AcademicYear entity
      // This would need to query by schoolId and yearId
      // For MVP, we'll use a simplified check
      const items = await this.dynamoDBClient.query(
        tenantId,
        'SCHOOL#',
        'entityType = :type AND academicYearId = :yearId',
        {
          ':type': 'ACADEMIC_YEAR',
          ':yearId': academicYearId
        }
      );
      return items.length > 0 && items[0].status === 'active';
    } catch (error) {
      return false;
    }
  }

  private async checkDuplicateEnrollment(
    tenantId: string,
    studentId: string,
    academicYearId: string
  ): Promise<boolean> {
    try {
      // Query GSI7 for existing enrollments
      const result = await this.dynamoDBClient.queryGSI(
        'GSI7',
        studentId,
        `ENROLLMENT#${academicYearId}#`,
        'begins_with',
        undefined,
        undefined,
        undefined,
        10
      );

      const activeEnrollments = result.items.filter(
        item =>
          item.tenantId === tenantId &&
          item.entityType === 'ENROLLMENT' &&
          item.academicYearId === academicYearId &&
          !['withdrawn', 'transferred', 'graduated'].includes(item.status)
      );

      return activeEnrollments.length > 0;
    } catch (error) {
      return false;
    }
  }
}

