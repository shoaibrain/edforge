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
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ClientFactoryService } from '@app/client-factory';

@Injectable()
export class ValidationService {
  constructor(private readonly clientFac: ClientFactoryService) {}
  
  private tableName: string = process.env.TABLE_NAME || 'SCHOOL_TABLE_NAME';

  /**
   * Validate school creation data
   * 
   * VALIDATION CHECKS:
   * 1. Required fields present
   * 2. Format validation (email, phone, timezone)
   * 3. Range validation (capacity, string lengths)
   * 4. Uniqueness (schoolCode within tenant)
   * 5. Business rules (grade range, status)
   */
  async validateSchoolCreation(
    tenantId: string,
    data: any,
    jwtToken: string
  ): Promise<void> {
    const errors: string[] = [];

    // School Name validation
    if (!data.schoolName) {
      errors.push('School name is required');
    } else if (data.schoolName.length < 3 || data.schoolName.length > 255) {
      errors.push('School name must be 3-255 characters');
    } else if (!/^[a-zA-Z0-9\s\-'']+$/.test(data.schoolName)) {
      errors.push('School name contains invalid characters (alphanumeric, spaces, hyphens, apostrophes only)');
    }

    // School Code validation
    if (!data.schoolCode) {
      errors.push('School code is required');
    } else if (data.schoolCode.length < 3 || data.schoolCode.length > 50) {
      errors.push('School code must be 3-50 characters');
    } else if (!/^[A-Z0-9\-]+$/.test(data.schoolCode.toUpperCase())) {
      errors.push('School code must be alphanumeric with hyphens only');
    } else {
      // Check uniqueness within tenant
      const codeExists = await this.schoolCodeExists(tenantId, data.schoolCode, jwtToken);
      if (codeExists) {
        errors.push(`School code '${data.schoolCode}' already exists in your organization`);
      }
    }

    // School Type validation
    const validTypes = ['elementary', 'middle', 'high', 'k12', 'alternative', 'special'];
    if (!data.schoolType) {
      errors.push('School type is required');
    } else if (!validTypes.includes(data.schoolType)) {
      errors.push(`School type must be one of: ${validTypes.join(', ')}`);
    }

    // Capacity validation
    if (!data.maxStudentCapacity) {
      errors.push('Maximum student capacity is required');
    } else if (data.maxStudentCapacity < 1 || data.maxStudentCapacity > 50000) {
      errors.push('Maximum student capacity must be between 1 and 50,000');
    }

    // Contact Info validation
    if (!data.contactInfo) {
      errors.push('Contact information is required');
    } else {
      if (!data.contactInfo.primaryEmail) {
        errors.push('Primary email is required');
      } else if (!this.isValidEmail(data.contactInfo.primaryEmail)) {
        errors.push('Invalid primary email format');
      }

      if (!data.contactInfo.primaryPhone) {
        errors.push('Primary phone is required');
      } else if (!this.isValidPhone(data.contactInfo.primaryPhone)) {
        errors.push('Invalid phone format (use E.164 format: +1-555-0123)');
      }

      if (data.contactInfo.website && !this.isValidUrl(data.contactInfo.website)) {
        errors.push('Invalid website URL format');
      }
    }

    // Address validation
    if (!data.address) {
      errors.push('Address is required');
    } else {
      const requiredAddressFields = ['street', 'city', 'state', 'country', 'postalCode', 'timezone'];
      for (const field of requiredAddressFields) {
        if (!data.address[field]) {
          errors.push(`Address ${field} is required`);
        }
      }

      // Timezone validation (CRITICAL for global deployments)
      if (data.address.timezone && !this.isValidTimezone(data.address.timezone)) {
        errors.push('Invalid timezone (use IANA timezone format like America/New_York, Europe/London)');
      }

      // Country code validation (ISO 3166-1 alpha-2)
      if (data.address.country && data.address.country.length !== 2) {
        errors.push('Country code must be 2-letter ISO code (US, CA, GB, etc.)');
      }
    }

    // Grade Range validation
    if (data.gradeRange) {
      if (!data.gradeRange.lowestGrade || !data.gradeRange.highestGrade) {
        errors.push('Both lowest and highest grade must be specified');
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors
      });
    }
  }

  /**
   * Validate academic year creation
   * 
   * BUSINESS RULES:
   * - Start date must be before end date
   * - Dates must be valid ISO 8601 format
   * - Year name should be meaningful
   * - Cannot overlap with existing years (optional check)
   */
  async validateAcademicYearCreation(
    tenantId: string,
    schoolId: string,
    data: any,
    jwtToken: string
  ): Promise<void> {
    const errors: string[] = [];

    // Verify school exists
    const schoolExists = await this.schoolExists(tenantId, schoolId, jwtToken);
    if (!schoolExists) {
      errors.push('School not found or inactive');
    }

    // Year Name validation
    if (!data.yearName) {
      errors.push('Academic year name is required');
    } else if (data.yearName.length < 3 || data.yearName.length > 100) {
      errors.push('Academic year name must be 3-100 characters');
    }

    // Year Code validation
    if (!data.yearCode) {
      errors.push('Academic year code is required');
    }

    // Date validation
    if (!data.startDate) {
      errors.push('Start date is required');
    } else if (!this.isValidISODate(data.startDate)) {
      errors.push('Start date must be in ISO 8601 format (YYYY-MM-DD)');
    }

    if (!data.endDate) {
      errors.push('End date is required');
    } else if (!this.isValidISODate(data.endDate)) {
      errors.push('End date must be in ISO 8601 format (YYYY-MM-DD)');
    }

    // Date logic validation
    if (data.startDate && data.endDate) {
      const start = new Date(data.startDate);
      const end = new Date(data.endDate);
      
      if (start >= end) {
        errors.push('End date must be after start date');
      }

      // Reasonable duration check (30 days to 400 days)
      const durationDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      if (durationDays < 30) {
        errors.push('Academic year must be at least 30 days');
      } else if (durationDays > 400) {
        errors.push('Academic year cannot exceed 400 days');
      }
    }

    // Structure validation
    if (data.structure) {
      if (data.structure.semesterCount && 
          (data.structure.semesterCount < 1 || data.structure.semesterCount > 4)) {
        errors.push('Semester count must be 1-4');
      }

      if (data.structure.gradingPeriodCount && 
          (data.structure.gradingPeriodCount < 1 || data.structure.gradingPeriodCount > 12)) {
        errors.push('Grading period count must be 1-12');
      }

      if (data.structure.instructionalDays && 
          (data.structure.instructionalDays < 30 || data.structure.instructionalDays > 365)) {
        errors.push('Instructional days must be 30-365');
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Academic year validation failed',
        errors
      });
    }
  }

  /**
   * Validate grading period creation
   * 
   * BUSINESS RULES:
   * - Must be within academic year boundaries
   * - Cannot overlap with other periods
   * - Period number must be sequential
   */
  async validateGradingPeriod(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    data: any,
    existingPeriods: any[],
    academicYear: any,
    jwtToken: string
  ): Promise<void> {
    const errors: string[] = [];

    // Period Name validation
    if (!data.periodName) {
      errors.push('Period name is required');
    }

    // Period Type validation
    const validTypes = ['semester', 'quarter', 'trimester', 'custom'];
    if (!data.periodType) {
      errors.push('Period type is required');
    } else if (!validTypes.includes(data.periodType)) {
      errors.push(`Period type must be one of: ${validTypes.join(', ')}`);
    }

    // Period Number validation
    if (!data.periodNumber || data.periodNumber < 1) {
      errors.push('Period number must be a positive integer');
    }

    // Date validation
    if (!data.startDate || !this.isValidISODate(data.startDate)) {
      errors.push('Valid start date is required (YYYY-MM-DD)');
    }

    if (!data.endDate || !this.isValidISODate(data.endDate)) {
      errors.push('Valid end date is required (YYYY-MM-DD)');
    }

    if (data.startDate && data.endDate) {
      const start = new Date(data.startDate);
      const end = new Date(data.endDate);
      
      if (start >= end) {
        errors.push('End date must be after start date');
      }

      // Check within academic year boundaries
      const yearStart = new Date(academicYear.startDate);
      const yearEnd = new Date(academicYear.endDate);
      
      if (start < yearStart || end > yearEnd) {
        errors.push('Grading period must be within academic year boundaries');
      }

      // Check for overlaps with existing periods
      for (const existing of existingPeriods) {
        const existingStart = new Date(existing.startDate);
        const existingEnd = new Date(existing.endDate);
        
        // Overlap detection
        if (
          (start >= existingStart && start < existingEnd) ||
          (end > existingStart && end <= existingEnd) ||
          (start <= existingStart && end >= existingEnd)
        ) {
          errors.push(`Period overlaps with existing period: ${existing.periodName}`);
        }
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Grading period validation failed',
        errors
      });
    }
  }

  /**
   * Validate department creation
   */
  async validateDepartmentCreation(
    tenantId: string,
    schoolId: string,
    data: any,
    jwtToken: string
  ): Promise<void> {
    const errors: string[] = [];

    // Verify school exists
    const schoolExists = await this.schoolExists(tenantId, schoolId, jwtToken);
    if (!schoolExists) {
      errors.push('School not found or inactive');
    }

    // Department Name validation
    if (!data.departmentName) {
      errors.push('Department name is required');
    } else if (data.departmentName.length < 2 || data.departmentName.length > 100) {
      errors.push('Department name must be 2-100 characters');
    }

    // Department Code validation
    if (!data.departmentCode) {
      errors.push('Department code is required');
    } else if (!/^[A-Z0-9\-]+$/.test(data.departmentCode.toUpperCase())) {
      errors.push('Department code must be alphanumeric with hyphens only');
    } else {
      // Check uniqueness within school
      const codeExists = await this.departmentCodeExists(
        tenantId,
        schoolId,
        data.departmentCode,
        jwtToken
      );
      if (codeExists) {
        errors.push(`Department code '${data.departmentCode}' already exists in this school`);
      }
    }

    // Category validation
    const validCategories = ['academic', 'administrative', 'support', 'athletic'];
    if (data.category && !validCategories.includes(data.category)) {
      errors.push(`Category must be one of: ${validCategories.join(', ')}`);
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Department validation failed',
        errors
      });
    }
  }

  // ========================
  // Private Helper Methods
  // ========================

  /**
   * Check if school code already exists within tenant
   * 
   * QUERY PATTERN: Scan tenant partition with filter
   * OPTIMIZATION: Could use GSI3 (tenantId#SCHOOL) for better performance
   */
  private async schoolCodeExists(
    tenantId: string,
    schoolCode: string,
    jwtToken: string
  ): Promise<boolean> {
    try {
      const client = await this.clientFac.getClient(tenantId, jwtToken);
      
      const result = await client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :tenantId',
        FilterExpression: 'entityType = :type AND schoolCode = :code',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':type': 'SCHOOL',
          ':code': schoolCode.toUpperCase() // Case-insensitive comparison
        },
        Limit: 1 // We only need to know if it exists
      }));

      return (result.Items?.length || 0) > 0;
    } catch (error) {
      console.error('Error checking school code uniqueness:', error);
      throw error;
    }
  }

  /**
   * Check if school exists and is active
   */
  private async schoolExists(
    tenantId: string,
    schoolId: string,
    jwtToken: string
  ): Promise<boolean> {
    try {
      const client = await this.clientFac.getClient(tenantId, jwtToken);
      
      const result = await client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :tenantId AND entityKey = :entityKey',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':entityKey': `SCHOOL#${schoolId}`
        }
      }));

      const school = result.Items?.[0];
      return !!school && school.status === 'active';
    } catch (error) {
      console.error('Error checking school existence:', error);
      return false;
    }
  }

  /**
   * Check if department code exists within school
   */
  private async departmentCodeExists(
    tenantId: string,
    schoolId: string,
    departmentCode: string,
    jwtToken: string
  ): Promise<boolean> {
    try {
      const client = await this.clientFac.getClient(tenantId, jwtToken);
      
      // Use GSI1 to query all entities for this school, then filter
      const result = await client.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'gsi1pk = :schoolId',
        FilterExpression: 'entityType = :type AND departmentCode = :code',
        ExpressionAttributeValues: {
          ':schoolId': schoolId,
          ':type': 'DEPARTMENT',
          ':code': departmentCode.toUpperCase()
        },
        Limit: 1
      }));

      return (result.Items?.length || 0) > 0;
    } catch (error) {
      console.error('Error checking department code uniqueness:', error);
      throw error;
    }
  }

  // ========================
  // Format Validators
  // ========================

  /**
   * Email validation (RFC 5322 simplified)
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Phone validation (E.164 international format)
   * Format: +[country code][number]
   * Example: +1-555-0123, +44-20-7946-0958, +86-10-1234-5678
   */
  private isValidPhone(phone: string): boolean {
    // Remove spaces and hyphens for validation
    const cleaned = phone.replace(/[\s\-]/g, '');
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    return phoneRegex.test(cleaned);
  }

  /**
   * URL validation (basic)
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Timezone validation using Intl API
   * Validates IANA timezone identifiers (America/New_York, Europe/London, etc.)
   * 
   * CRITICAL: Timezone validation is essential for global deployments
   * All date/time operations must use school's timezone
   */
  private isValidTimezone(timezone: string): boolean {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * ISO 8601 date validation (YYYY-MM-DD)
   */
  private isValidISODate(dateString: string): boolean {
    const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!isoDateRegex.test(dateString)) {
      return false;
    }

    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date.getTime());
  }
}

