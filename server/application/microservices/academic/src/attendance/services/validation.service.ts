import { Injectable, BadRequestException } from '@nestjs/common';
import { CreateAttendanceDto, UpdateAttendanceDto, BulkAttendanceDto } from '../dto/attendance.dto';

@Injectable()
export class ValidationService {
  
  /**
   * Validate attendance record creation
   */
  async validateAttendanceCreation(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    data: CreateAttendanceDto
  ): Promise<void> {
    const errors: string[] = [];

    // Validate date format (YYYY-MM-DD)
    if (!this.isValidDateFormat(data.date)) {
      errors.push('Invalid date format. Use YYYY-MM-DD format');
    } else {
      // Validate date is not in the future
      const recordDate = new Date(data.date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (recordDate > today) {
        errors.push('Attendance date cannot be in the future');
      }
    }

    // Validate time formats
    if (data.checkInTime && !this.isValidTimeFormat(data.checkInTime)) {
      errors.push('Invalid check-in time format. Use HH:MM format');
    }
    
    if (data.checkOutTime && !this.isValidTimeFormat(data.checkOutTime)) {
      errors.push('Invalid check-out time format. Use HH:MM format');
    }

    // Validate check-out is after check-in
    if (data.checkInTime && data.checkOutTime) {
      if (data.checkOutTime <= data.checkInTime) {
        errors.push('Check-out time must be after check-in time');
      }
    }

    // Validate status-specific fields
    if (data.status === 'excused' && !data.excuseReason) {
      errors.push('Excuse reason is required for excused absences');
    }

    if ((data.status === 'tardy' || data.status === 'late') && data.minutesLate === undefined) {
      errors.push('Minutes late must be specified for tardy/late status');
    }

    if (data.status === 'present' && data.excuseReason) {
      errors.push('Excuse reason cannot be provided for present status');
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Attendance validation failed',
        errors
      });
    }
  }

  /**
   * Validate attendance record update
   */
  async validateAttendanceUpdate(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    attendanceId: string,
    data: UpdateAttendanceDto
  ): Promise<void> {
    const errors: string[] = [];

    // Validate time formats if provided
    if (data.checkInTime && !this.isValidTimeFormat(data.checkInTime)) {
      errors.push('Invalid check-in time format. Use HH:MM format');
    }
    
    if (data.checkOutTime && !this.isValidTimeFormat(data.checkOutTime)) {
      errors.push('Invalid check-out time format. Use HH:MM format');
    }

    // Validate check-out is after check-in
    if (data.checkInTime && data.checkOutTime) {
      if (data.checkOutTime <= data.checkInTime) {
        errors.push('Check-out time must be after check-in time');
      }
    }

    // Validate status-specific fields
    if (data.status === 'excused' && data.excuseReason === undefined) {
      // Note: We only warn if explicitly trying to change to excused without reason
      // The update might have existing excuseReason
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Attendance validation failed',
        errors
      });
    }
  }

  /**
   * Validate bulk attendance submission
   */
  async validateBulkAttendance(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    data: BulkAttendanceDto
  ): Promise<void> {
    const errors: string[] = [];

    // Validate date
    if (!this.isValidDateFormat(data.date)) {
      errors.push('Invalid date format. Use YYYY-MM-DD format');
    }

    // Validate records exist
    if (!data.records || data.records.length === 0) {
      errors.push('At least one attendance record must be provided');
    }

    // Check for duplicate student IDs
    const studentIds = data.records.map(r => r.studentId);
    const duplicates = studentIds.filter((id, index) => studentIds.indexOf(id) !== index);
    if (duplicates.length > 0) {
      errors.push(`Duplicate student IDs found: ${duplicates.join(', ')}`);
    }

    // Validate each record
    for (const record of data.records) {
      if (!record.studentId) {
        errors.push('All records must have a student ID');
      }
      
      const validStatuses = ['present', 'absent', 'tardy', 'excused', 'late'];
      if (!validStatuses.includes(record.status)) {
        errors.push(`Invalid status "${record.status}" for student ${record.studentId}`);
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Bulk attendance validation failed',
        errors
      });
    }
  }

  /**
   * Validate date format (YYYY-MM-DD)
   */
  private isValidDateFormat(date: string): boolean {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return false;
    }
    
    const parsedDate = new Date(date);
    return parsedDate instanceof Date && !isNaN(parsedDate.getTime());
  }

  /**
   * Validate time format (HH:MM)
   */
  private isValidTimeFormat(time: string): boolean {
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    return timeRegex.test(time);
  }
}

