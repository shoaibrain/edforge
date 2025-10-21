import { Injectable, BadRequestException, HttpStatus } from '@nestjs/common';
import { CreateClassroomDto, UpdateClassroomDto } from '../dto/classroom.dto';
import { Classroom } from '../entities/classroom.entity';
import { AcademicException, AcademicErrors } from '../../common/errors/academic-exception';
import { AcademicErrorCode } from '../../common/errors/error-codes.enum';

@Injectable()
export class ValidationService {
  
  /**
   * Validate classroom creation
   */
  async validateClassroomCreation(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    data: CreateClassroomDto
  ): Promise<void> {
    const errors: string[] = [];

    // Validate classroom code format (uppercase alphanumeric with hyphens)
    if (!/^[A-Z0-9-]+$/.test(data.code)) {
      errors.push('Classroom code must be uppercase alphanumeric with hyphens only');
    }

    // Validate schedule times
    for (const schedule of data.schedule) {
      if (!this.isValidTimeFormat(schedule.startTime)) {
        errors.push(`Invalid start time format: ${schedule.startTime}. Use HH:MM format`);
      }
      if (!this.isValidTimeFormat(schedule.endTime)) {
        errors.push(`Invalid end time format: ${schedule.endTime}. Use HH:MM format`);
      }
      
      if (this.isValidTimeFormat(schedule.startTime) && this.isValidTimeFormat(schedule.endTime)) {
        if (schedule.startTime >= schedule.endTime) {
          errors.push(`Start time (${schedule.startTime}) must be before end time (${schedule.endTime}) on ${schedule.dayOfWeek}`);
        }
      }
    }

    // Check for duplicate days in schedule
    const days = data.schedule.map(s => s.dayOfWeek);
    const duplicateDays = days.filter((day, index) => days.indexOf(day) !== index);
    if (duplicateDays.length > 0) {
      errors.push(`Duplicate days in schedule: ${duplicateDays.join(', ')}`);
    }

    // Validate capacity if provided
    if (data.capacity !== undefined && data.capacity <= 0) {
      errors.push('Capacity must be greater than 0');
    }

    // Validate teacher ID
    if (!data.teacherId || data.teacherId.trim().length === 0) {
      errors.push('Teacher ID is required');
    }

    if (errors.length > 0) {
      throw AcademicErrors.validationFailed(errors);
    }
  }

  /**
   * Validate classroom update
   */
  async validateClassroomUpdate(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    data: UpdateClassroomDto
  ): Promise<void> {
    const errors: string[] = [];

    // Validate classroom code format if provided
    if (data.code && !/^[A-Z0-9-]+$/.test(data.code)) {
      errors.push('Classroom code must be uppercase alphanumeric with hyphens only');
    }

    // Validate schedule times if provided
    if (data.schedule) {
      for (const schedule of data.schedule) {
        if (!this.isValidTimeFormat(schedule.startTime)) {
          errors.push(`Invalid start time format: ${schedule.startTime}. Use HH:MM format`);
        }
        if (!this.isValidTimeFormat(schedule.endTime)) {
          errors.push(`Invalid end time format: ${schedule.endTime}. Use HH:MM format`);
        }
        
        if (this.isValidTimeFormat(schedule.startTime) && this.isValidTimeFormat(schedule.endTime)) {
          if (schedule.startTime >= schedule.endTime) {
            errors.push(`Start time must be before end time on ${schedule.dayOfWeek}`);
          }
        }
      }

      // Check for duplicate days
      const days = data.schedule.map(s => s.dayOfWeek);
      const duplicateDays = days.filter((day, index) => days.indexOf(day) !== index);
      if (duplicateDays.length > 0) {
        errors.push(`Duplicate days in schedule: ${duplicateDays.join(', ')}`);
      }
    }

    // Validate capacity if provided
    if (data.capacity !== undefined && data.capacity <= 0) {
      errors.push('Capacity must be greater than 0');
    }

    if (errors.length > 0) {
      throw AcademicErrors.validationFailed(errors);
    }
  }

  /**
   * Validate capacity constraints
   * Used for enrollment and capacity updates
   */
  async validateCapacity(
    currentCount: number,
    capacity: number | null | undefined,
    operation: 'enroll' | 'update'
  ): Promise<void> {
    if (!capacity) return; // No capacity limit set
    
    const errors: string[] = [];
    
    if (operation === 'enroll' && currentCount >= capacity) {
      errors.push(`Classroom is at full capacity (${currentCount}/${capacity})`);
    }
    
    if (operation === 'update' && currentCount > capacity) {
      errors.push(`Cannot reduce capacity to ${capacity} - current enrollment is ${currentCount}`);
    }
    
    if (errors.length > 0) {
      throw new AcademicException(
        AcademicErrorCode.CLASSROOM_AT_CAPACITY,
        'Capacity validation failed',
        HttpStatus.BAD_REQUEST,
        { errors, currentCount, capacity }
      );
    }
  }

  /**
   * Validate teacher assignment
   * TODO: Integrate with Teacher service when available
   */
  async validateTeacherAssignment(
    teacherId: string,
    academicYearId: string
  ): Promise<void> {
    const errors: string[] = [];
    
    if (!teacherId || teacherId.trim().length === 0) {
      errors.push('Primary teacher ID is required');
    }
    
    // TODO: Check if teacher exists in system
    // TODO: Check if teacher has credentials/qualifications for subject
    // TODO: Check teacher workload limits (e.g., max 5 classes per term)
    
    if (errors.length > 0) {
      throw new AcademicException(
        AcademicErrorCode.VALIDATION_FAILED,
        'Teacher assignment validation failed',
        HttpStatus.BAD_REQUEST,
        { errors }
      );
    }
  }

  /**
   * Validate business rules for classroom
   * Ensures classroom state is consistent and follows business logic
   */
  async validateBusinessRules(
    classroom: Partial<Classroom>
  ): Promise<void> {
    const errors: string[] = [];
    
    // Rule: Cannot have more enrolled students than capacity
    if (classroom.capacity && classroom.enrollmentCount && 
        classroom.enrollmentCount > classroom.capacity) {
      errors.push(`Enrollment count (${classroom.enrollmentCount}) exceeds capacity (${classroom.capacity})`);
    }
    
    // Rule: Active classroom must have schedule
    if (classroom.status === 'active' && (!classroom.schedule || classroom.schedule.length === 0)) {
      errors.push('Active classroom must have at least one schedule entry');
    }
    
    // Rule: Active classroom must have teacher
    if (classroom.status === 'active' && !classroom.teacherId) {
      errors.push('Active classroom must have a teacher assigned');
    }
    
    // Rule: Inactive/archived classroom should not accept new enrollments
    if ((classroom.status === 'inactive' || classroom.status === 'archived')) {
      // This is checked in enrollment logic, not here
    }
    
    if (errors.length > 0) {
      throw new AcademicException(
        AcademicErrorCode.VALIDATION_FAILED,
        'Business rules validation failed',
        HttpStatus.BAD_REQUEST,
        { errors }
      );
    }
  }

  /**
   * Validate student enrollment eligibility
   * TODO: Add prerequisite checking, grade level matching
   */
  async validateEnrollmentEligibility(
    studentId: string,
    classroom: Classroom
  ): Promise<void> {
    const errors: string[] = [];
    
    // Check classroom status
    if (classroom.status === 'archived') {
      errors.push('Cannot enroll in archived classroom');
    }
    
    if (classroom.status === 'inactive') {
      errors.push('Cannot enroll in inactive classroom');
    }
    
    // Check if already enrolled
    if (classroom.enrolledStudentIds.includes(studentId)) {
      throw AcademicErrors.studentAlreadyEnrolled(studentId, classroom.classroomId);
    }
    
    // Check capacity
    if (classroom.capacity && classroom.enrollmentCount >= classroom.capacity) {
      throw AcademicErrors.classroomAtCapacity(classroom.classroomId, classroom.capacity);
    }
    
    // TODO: Check prerequisites
    // TODO: Check grade level compatibility
    // TODO: Check schedule conflicts
    
    if (errors.length > 0) {
      throw AcademicErrors.validationFailed(errors);
    }
  }

  /**
   * Validate time format (HH:MM)
   */
  private isValidTimeFormat(time: string): boolean {
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    return timeRegex.test(time);
  }
}

