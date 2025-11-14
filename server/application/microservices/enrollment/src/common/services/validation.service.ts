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
import { CreateStaffDto, UpdateStaffDto } from '../../staff/dto/staff.dto';
import { CreateParentDto, UpdateParentDto } from '../../parent/dto/parent.dto';
import { CreateTuitionConfigurationDto, CreatePaymentDto } from '../../finance/dto/finance.dto';

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
  // STAFF VALIDATIONS
  // ============================================================================

  async validateStaffCreation(tenantId: string, data: CreateStaffDto): Promise<void> {
    const errors: string[] = [];

    // Name validations
    if (!data.firstName || data.firstName.trim().length < 1) {
      errors.push('First name is required and must be at least 1 character');
    }

    if (!data.lastName || data.lastName.trim().length < 1) {
      errors.push('Last name is required and must be at least 1 character');
    }

    // Date of birth validation (if provided)
    if (data.dateOfBirth) {
      this.validateDateOfBirth(data.dateOfBirth, errors);
    }

    // Contact info validation
    if (!data.contactInfo) {
      errors.push('Contact information is required');
    } else {
      if (!data.contactInfo.email || !this.isValidEmail(data.contactInfo.email)) {
        errors.push('Valid email is required');
      }

      if (!data.contactInfo.phone || !this.isValidPhone(data.contactInfo.phone)) {
        errors.push('Valid phone is required (use E.164 format: +1-555-0123)');
      }

      if (data.contactInfo.address) {
        this.validateAddress(data.contactInfo.address, errors);
      }
    }

    // Hire date validation
    if (!data.hireDate) {
      errors.push('Hire date is required');
    } else {
      const hireDate = new Date(data.hireDate);
      const today = new Date();
      today.setHours(23, 59, 59, 999);

      if (isNaN(hireDate.getTime())) {
        errors.push('Invalid hire date format (use ISO 8601: YYYY-MM-DD)');
      } else if (hireDate > today) {
        errors.push('Hire date cannot be in the future');
      }
    }

    // Employment type validation
    const validEmploymentTypes = ['full_time', 'part_time', 'contract', 'substitute'];
    if (!validEmploymentTypes.includes(data.employmentType)) {
      errors.push(`Employment type must be one of: ${validEmploymentTypes.join(', ')}`);
    }

    // Roles validation
    if (!data.roles || data.roles.length === 0) {
      errors.push('At least one role is required');
    } else {
      const primaryRoles = data.roles.filter(r => r.isPrimary);
      if (primaryRoles.length === 0) {
        errors.push('At least one primary role is required');
      }
      if (primaryRoles.length > 1) {
        errors.push('Only one primary role is allowed');
      }

      // Validate each role
      for (const role of data.roles) {
        // Teacher role must have department
        if (role.roleType === 'teacher' && !role.departmentId) {
          errors.push('Teacher role must have a department assigned');
        }

        // Validate role dates
        if (role.startDate) {
          const startDate = new Date(role.startDate);
          if (isNaN(startDate.getTime())) {
            errors.push(`Invalid start date format for role ${role.roleType}`);
          }

          if (role.endDate) {
            const endDate = new Date(role.endDate);
            if (isNaN(endDate.getTime())) {
              errors.push(`Invalid end date format for role ${role.roleType}`);
            } else if (endDate < startDate) {
              errors.push(`End date must be after start date for role ${role.roleType}`);
            }
          }
        }

        // Verify school exists
        const schoolExists = await this.checkSchoolExists(tenantId, role.schoolId);
        if (!schoolExists) {
          errors.push(`School with ID ${role.schoolId} does not exist or is not active`);
        }
      }
    }

    // Qualifications validation
    if (data.qualifications) {
      if (!data.qualifications.education || data.qualifications.education.length === 0) {
        errors.push('At least one education entry is required');
      } else {
        for (const edu of data.qualifications.education) {
          if (!edu.degree || !edu.institution || !edu.year) {
            errors.push('Education entries must have degree, institution, and year');
          }
        }
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Staff validation failed',
        errors
      });
    }
  }

  async validateStaffUpdate(tenantId: string, staffId: string, data: UpdateStaffDto): Promise<void> {
    const errors: string[] = [];

    // Verify staff exists (would need to query)
    // For MVP, we'll skip this check

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
    }

    // Roles validation (if provided)
    if (data.roles && data.roles.length > 0) {
      const primaryRoles = data.roles.filter(r => r.isPrimary);
      if (primaryRoles.length > 1) {
        errors.push('Only one primary role is allowed');
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Staff update validation failed',
        errors
      });
    }
  }

  // ============================================================================
  // PARENT VALIDATIONS
  // ============================================================================

  async validateParentCreation(tenantId: string, data: CreateParentDto): Promise<void> {
    const errors: string[] = [];

    // Name validations
    if (!data.firstName || data.firstName.trim().length < 1) {
      errors.push('First name is required and must be at least 1 character');
    }

    if (!data.lastName || data.lastName.trim().length < 1) {
      errors.push('Last name is required and must be at least 1 character');
    }

    // Contact info validation
    if (!data.contactInfo) {
      errors.push('Contact information is required');
    } else {
      if (!data.contactInfo.email || !this.isValidEmail(data.contactInfo.email)) {
        errors.push('Valid email is required');
      }

      if (!data.contactInfo.phone || !this.isValidPhone(data.contactInfo.phone)) {
        errors.push('Valid phone is required (use E.164 format: +1-555-0123)');
      }

      if (data.contactInfo.address) {
        this.validateAddress(data.contactInfo.address, errors);
      }
    }

    // Children validation
    if (data.children && data.children.length > 0) {
      for (const child of data.children) {
        const studentExists = await this.checkStudentExists(tenantId, child.studentId);
        if (!studentExists) {
          errors.push(`Student with ID ${child.studentId} does not exist`);
        }
      }
    }

    // Portal access validation
    if (data.portalEnabled && (!data.contactInfo || !data.contactInfo.email)) {
      errors.push('Email is required for portal access');
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Parent validation failed',
        errors
      });
    }
  }

  async validateParentUpdate(tenantId: string, parentId: string, data: UpdateParentDto): Promise<void> {
    const errors: string[] = [];

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
    }

    // Children validation (if provided)
    if (data.children && data.children.length > 0) {
      for (const child of data.children) {
        const studentExists = await this.checkStudentExists(tenantId, child.studentId);
        if (!studentExists) {
          errors.push(`Student with ID ${child.studentId} does not exist`);
        }
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Parent update validation failed',
        errors
      });
    }
  }

  // ============================================================================
  // FINANCE VALIDATIONS
  // ============================================================================

  async validateTuitionConfiguration(
    tenantId: string,
    data: CreateTuitionConfigurationDto
  ): Promise<void> {
    const errors: string[] = [];

    // School validation
    const schoolExists = await this.checkSchoolExists(tenantId, data.schoolId);
    if (!schoolExists) {
      errors.push(`School with ID ${data.schoolId} does not exist or is not active`);
    }

    // Academic year validation
    const academicYearExists = await this.checkAcademicYearExists(tenantId, data.academicYearId);
    if (!academicYearExists) {
      errors.push(`Academic year with ID ${data.academicYearId} does not exist or is not active`);
    }

    // Tuition rates validation
    if (!data.tuitionRates || Object.keys(data.tuitionRates).length === 0) {
      errors.push('At least one tuition rate is required');
    } else {
      for (const [gradeLevel, rate] of Object.entries(data.tuitionRates)) {
        this.validateGradeLevel(gradeLevel, errors);

        if (rate.amount <= 0) {
          errors.push(`Tuition rate amount for grade ${gradeLevel} must be positive`);
        }

        if (!this.isValidCurrency(rate.currency)) {
          errors.push(`Invalid currency code for grade ${gradeLevel}: ${rate.currency}`);
        }

        const validFrequencies = ['annual', 'semester', 'monthly', 'quarterly'];
        if (!validFrequencies.includes(rate.frequency)) {
          errors.push(`Invalid frequency for grade ${gradeLevel}: ${rate.frequency}`);
        }

        if (rate.dueDates) {
          for (const dueDate of rate.dueDates) {
            const date = new Date(dueDate);
            if (isNaN(date.getTime())) {
              errors.push(`Invalid due date format for grade ${gradeLevel}: ${dueDate}`);
            }
          }
        }
      }
    }

    // Fees validation
    if (data.fees) {
      for (const fee of data.fees) {
        if (!fee.feeName || fee.feeName.trim().length < 1) {
          errors.push('Fee name is required');
        }

        if (fee.amount <= 0) {
          errors.push(`Fee amount for ${fee.feeName} must be positive`);
        }

        const validFeeTypes = ['registration', 'technology', 'activity', 'lab', 'sports', 'field_trip', 'uniform', 'other'];
        if (!validFeeTypes.includes(fee.feeType)) {
          errors.push(`Invalid fee type: ${fee.feeType}`);
        }

        const validFrequencies = ['one_time', 'annual', 'semester', 'monthly', 'per_course'];
        if (!validFrequencies.includes(fee.frequency)) {
          errors.push(`Invalid fee frequency: ${fee.frequency}`);
        }

        if (fee.applicableGrades) {
          for (const grade of fee.applicableGrades) {
            this.validateGradeLevel(grade, errors);
          }
        }
      }
    }

    // Discount policies validation
    if (data.discountPolicies) {
      for (const policy of data.discountPolicies) {
        if (!policy.name || policy.name.trim().length < 1) {
          errors.push('Discount policy name is required');
        }

        const validTypes = ['sibling', 'early_payment', 'scholarship', 'financial_aid', 'staff_discount', 'custom'];
        if (!validTypes.includes(policy.type)) {
          errors.push(`Invalid discount policy type: ${policy.type}`);
        }

        const hasPercentage = policy.discountPercentage !== undefined;
        const hasAmount = policy.discountAmount !== undefined;

        if (!hasPercentage && !hasAmount) {
          errors.push(`Discount policy ${policy.name} must have either discountPercentage or discountAmount`);
        }

        if (hasPercentage && (policy.discountPercentage! < 0 || policy.discountPercentage! > 100)) {
          errors.push(`Discount percentage for ${policy.name} must be between 0 and 100`);
        }

        if (hasAmount && policy.discountAmount! <= 0) {
          errors.push(`Discount amount for ${policy.name} must be positive`);
        }

        const validApplicableTo = ['tuition', 'fees', 'both'];
        if (!validApplicableTo.includes(policy.applicableTo)) {
          errors.push(`Invalid applicableTo for ${policy.name}: ${policy.applicableTo}`);
        }
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Tuition configuration validation failed',
        errors
      });
    }
  }

  async validatePayment(tenantId: string, invoiceId: string, data: CreatePaymentDto): Promise<void> {
    const errors: string[] = [];

    // Amount validation
    if (data.amount <= 0) {
      errors.push('Payment amount must be positive');
    }

    // Currency validation
    if (!this.isValidCurrency(data.currency)) {
      errors.push(`Invalid currency code: ${data.currency}`);
    }

    // Payment date validation
    if (!data.paymentDate) {
      errors.push('Payment date is required');
    } else {
      const paymentDate = new Date(data.paymentDate);
      const today = new Date();
      today.setHours(23, 59, 59, 999);

      if (isNaN(paymentDate.getTime())) {
        errors.push('Invalid payment date format (use ISO 8601: YYYY-MM-DD)');
      } else if (paymentDate > today) {
        errors.push('Payment date cannot be in the future');
      }
    }

    // Payment method validation
    const validMethods = ['cash', 'check', 'bank_transfer', 'credit_card', 'debit_card', 'other'];
    if (!validMethods.includes(data.paymentMethod)) {
      errors.push(`Payment method must be one of: ${validMethods.join(', ')}`);
    }

    // Note: Invoice validation (amount <= due) is done in finance service
    // as it requires fetching the invoice

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Payment validation failed',
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
      const items = await this.dynamoDBClient.queryGSI(
        'GSI7',
        studentId,
        `ENROLLMENT#${academicYearId}#`,
        'begins_with',
        undefined,
        undefined,
        undefined,
        10
      );

      const activeEnrollments = items.filter(
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

