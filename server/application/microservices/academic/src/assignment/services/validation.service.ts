import { Injectable, BadRequestException } from '@nestjs/common';
import { CreateAssignmentDto, UpdateAssignmentDto } from '../dto/assignment.dto';

@Injectable()
export class ValidationService {
  
  /**
   * Validate assignment creation
   */
  async validateAssignmentCreation(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    data: CreateAssignmentDto
  ): Promise<void> {
    const errors: string[] = [];

    // Validate dates
    const assignedDate = new Date(data.assignedDate);
    const dueDate = new Date(data.dueDate);
    
    if (isNaN(assignedDate.getTime())) {
      errors.push('Invalid assigned date format. Use ISO 8601 format (YYYY-MM-DD)');
    }
    
    if (isNaN(dueDate.getTime())) {
      errors.push('Invalid due date format. Use ISO 8601 format (YYYY-MM-DD)');
    }

    // Validate due date is after assigned date
    if (assignedDate >= dueDate) {
      errors.push('Due date must be after assigned date');
    }

    // Validate availableFrom/availableUntil if provided
    if (data.availableFrom) {
      const availableFrom = new Date(data.availableFrom);
      if (isNaN(availableFrom.getTime())) {
        errors.push('Invalid availableFrom date format');
      } else if (availableFrom > dueDate) {
        errors.push('availableFrom date must be before or equal to due date');
      }
    }

    if (data.availableUntil) {
      const availableUntil = new Date(data.availableUntil);
      if (isNaN(availableUntil.getTime())) {
        errors.push('Invalid availableUntil date format');
      } else if (availableUntil < dueDate) {
        errors.push('availableUntil date must be after or equal to due date');
      }
    }

    // Validate passing score
    if (data.passingScore !== undefined && data.passingScore > data.maxPoints) {
      errors.push('Passing score cannot exceed max points');
    }

    // Validate weight
    if (data.weight !== undefined && (data.weight < 0 || data.weight > 100)) {
      errors.push('Weight must be between 0 and 100');
    }

    // Validate late submission settings
    if (!data.allowLateSubmission && data.lateSubmissionPenalty !== undefined) {
      errors.push('Late submission penalty cannot be set when late submissions are not allowed');
    }

    // Validate file attachments
    if (data.attachments && data.attachments.length > 0) {
      const maxFileSize = 50 * 1024 * 1024; // 50MB
      for (const attachment of data.attachments) {
        if (attachment.fileSize > maxFileSize) {
          errors.push(`File ${attachment.fileName} exceeds maximum size of 50MB`);
        }
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Assignment validation failed',
        errors
      });
    }
  }

  /**
   * Validate assignment update
   */
  async validateAssignmentUpdate(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    assignmentId: string,
    data: UpdateAssignmentDto
  ): Promise<void> {
    const errors: string[] = [];

    // Validate dates if provided
    if (data.assignedDate && data.dueDate) {
      const assignedDate = new Date(data.assignedDate);
      const dueDate = new Date(data.dueDate);
      
      if (assignedDate >= dueDate) {
        errors.push('Due date must be after assigned date');
      }
    }

    // Validate passing score
    if (data.passingScore !== undefined && data.maxPoints !== undefined) {
      if (data.passingScore > data.maxPoints) {
        errors.push('Passing score cannot exceed max points');
      }
    }

    // Validate weight
    if (data.weight !== undefined && (data.weight < 0 || data.weight > 100)) {
      errors.push('Weight must be between 0 and 100');
    }

    // Validate late submission settings
    if (data.allowLateSubmission === false && data.lateSubmissionPenalty !== undefined) {
      errors.push('Late submission penalty cannot be set when late submissions are not allowed');
    }

    // Validate file attachments
    if (data.attachments && data.attachments.length > 0) {
      const maxFileSize = 50 * 1024 * 1024; // 50MB
      for (const attachment of data.attachments) {
        if (attachment.fileSize > maxFileSize) {
          errors.push(`File ${attachment.fileName} exceeds maximum size of 50MB`);
        }
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Assignment validation failed',
        errors
      });
    }
  }
}

