import { Injectable, BadRequestException } from '@nestjs/common';
import { CreateClassroomDto, UpdateClassroomDto } from '../dto/classroom.dto';

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

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Classroom validation failed',
        errors
      });
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

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Classroom validation failed',
        errors
      });
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

