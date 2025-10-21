import { Injectable, BadRequestException, HttpStatus } from '@nestjs/common';
import { CreateAssignmentDto, UpdateAssignmentDto } from '../dto/assignment.dto';
import { Assignment } from '../entities/assignment.entity';
import { AcademicException, AcademicErrors } from '../../common/errors/academic-exception';
import { AcademicErrorCode } from '../../common/errors/error-codes.enum';

// Rubric criterion interface
export interface AssignmentRubric {
  criteriaName: string;
  maxPoints: number;
  description?: string;
}

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

    // Validate required fields
    if (!data.title || data.title.trim().length === 0) {
      errors.push('Assignment title is required');
    }

    if (data.title && data.title.length > 200) {
      errors.push('Assignment title cannot exceed 200 characters');
    }

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

    // Validate max points
    if (data.maxPoints === undefined || data.maxPoints <= 0) {
      errors.push('Max points must be greater than 0');
    }

    if (data.maxPoints > 1000) {
      errors.push('Max points cannot exceed 1000');
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

    if (data.lateSubmissionPenalty !== undefined && (data.lateSubmissionPenalty < 0 || data.lateSubmissionPenalty > 100)) {
      errors.push('Late submission penalty must be between 0 and 100');
    }

    // Validate file attachments
    if (data.attachments && data.attachments.length > 0) {
      const maxFileSize = 50 * 1024 * 1024; // 50MB
      const maxAttachments = 10;
      
      if (data.attachments.length > maxAttachments) {
        errors.push(`Maximum ${maxAttachments} attachments allowed`);
      }
      
      for (const attachment of data.attachments) {
        if (attachment.fileSize > maxFileSize) {
          errors.push(`File ${attachment.fileName} exceeds maximum size of 50MB`);
        }
        
        if (!attachment.fileName || attachment.fileName.trim().length === 0) {
          errors.push('Attachment file name is required');
        }
        
        if (!attachment.fileUrl || attachment.fileUrl.trim().length === 0) {
          errors.push('Attachment file URL is required');
        }
      }
    }

    if (errors.length > 0) {
      throw AcademicErrors.validationFailed(errors);
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

    // Validate title if provided
    if (data.title !== undefined) {
      if (data.title.trim().length === 0) {
        errors.push('Assignment title cannot be empty');
      }
      if (data.title.length > 200) {
        errors.push('Assignment title cannot exceed 200 characters');
      }
    }

    // Validate dates if provided
    if (data.assignedDate && data.dueDate) {
      const assignedDate = new Date(data.assignedDate);
      const dueDate = new Date(data.dueDate);
      
      if (assignedDate >= dueDate) {
        errors.push('Due date must be after assigned date');
      }
    }

    // Validate max points if provided
    if (data.maxPoints !== undefined) {
      if (data.maxPoints <= 0) {
        errors.push('Max points must be greater than 0');
      }
      if (data.maxPoints > 1000) {
        errors.push('Max points cannot exceed 1000');
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

    if (data.lateSubmissionPenalty !== undefined && (data.lateSubmissionPenalty < 0 || data.lateSubmissionPenalty > 100)) {
      errors.push('Late submission penalty must be between 0 and 100');
    }

    // Validate file attachments
    if (data.attachments && data.attachments.length > 0) {
      const maxFileSize = 50 * 1024 * 1024; // 50MB
      const maxAttachments = 10;
      
      if (data.attachments.length > maxAttachments) {
        errors.push(`Maximum ${maxAttachments} attachments allowed`);
      }
      
      for (const attachment of data.attachments) {
        if (attachment.fileSize > maxFileSize) {
          errors.push(`File ${attachment.fileName} exceeds maximum size of 50MB`);
        }
      }
    }

    if (errors.length > 0) {
      throw AcademicErrors.validationFailed(errors);
    }
  }

  /**
   * Validate assignment publishing requirements
   * Ensures assignment has all required fields before going live to students
   */
  async validatePublishing(
    assignment: Assignment,
    currentStatus: string
  ): Promise<void> {
    const errors: string[] = [];
    
    // Check if already published
    if (currentStatus === 'published') {
      throw AcademicErrors.assignmentAlreadyPublished(assignment.assignmentId);
    }
    
    // Check required fields for publishing
    if (!assignment.title || assignment.title.trim().length === 0) {
      errors.push('Title is required for publishing');
    }
    
    if (!assignment.instructions || assignment.instructions.trim().length === 0) {
      errors.push('Instructions are required for publishing');
    }
    
    if (!assignment.dueDate) {
      errors.push('Due date is required for publishing');
    }
    
    if (assignment.maxPoints === undefined || assignment.maxPoints <= 0) {
      errors.push('Max points must be greater than 0 for publishing');
    }
    
    // Due date should be in the future (at least 1 hour from now)
    if (assignment.dueDate) {
      const dueDate = new Date(assignment.dueDate);
      const now = new Date();
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
      
      if (dueDate <= oneHourFromNow) {
        errors.push('Due date must be at least 1 hour in the future when publishing');
      }
    }
    
    // Validate assigned date is not in the future
    if (assignment.assignedDate) {
      const assignedDate = new Date(assignment.assignedDate);
      const now = new Date();
      
      if (assignedDate > now) {
        errors.push('Cannot publish assignment with future assigned date. Use draft status and schedule publishing.');
      }
    }
    
    if (errors.length > 0) {
      throw new AcademicException(
        AcademicErrorCode.ASSIGNMENT_ALREADY_PUBLISHED,
        'Publishing validation failed',
        HttpStatus.BAD_REQUEST,
        { errors, assignmentId: assignment.assignmentId }
      );
    }
  }

  /**
   * Validate assignment rubric
   * Ensures rubric criteria are valid and sum correctly
   */
  async validateRubric(
    rubric: AssignmentRubric[],
    expectedMaxPoints?: number
  ): Promise<void> {
    if (!rubric || rubric.length === 0) return; // Rubric is optional
    
    const errors: string[] = [];
    let totalMaxPoints = 0;
    const criteriaNames = new Set<string>();
    
    for (const criterion of rubric) {
      // Validate criterion name
      if (!criterion.criteriaName || criterion.criteriaName.trim().length === 0) {
        errors.push('Rubric criteria must have a name');
      }
      
      // Check for duplicates
      if (criteriaNames.has(criterion.criteriaName)) {
        errors.push(`Duplicate rubric criterion: ${criterion.criteriaName}`);
      }
      criteriaNames.add(criterion.criteriaName);
      
      // Validate max points
      if (criterion.maxPoints === undefined || criterion.maxPoints <= 0) {
        errors.push(`Max points must be positive for criterion: ${criterion.criteriaName}`);
      }
      
      totalMaxPoints += criterion.maxPoints;
    }
    
    // If expected max points provided, rubric total should match
    if (expectedMaxPoints !== undefined && totalMaxPoints !== expectedMaxPoints) {
      errors.push(
        `Rubric total points (${totalMaxPoints}) must equal assignment max points (${expectedMaxPoints})`
      );
    }
    
    // Rubric should have at least 2 criteria
    if (rubric.length === 1) {
      errors.push('Rubric should have at least 2 criteria. For single-criterion grading, rubric is not needed.');
    }
    
    if (errors.length > 0) {
      throw new AcademicException(
        AcademicErrorCode.VALIDATION_FAILED,
        'Rubric validation failed',
        HttpStatus.BAD_REQUEST,
        { errors }
      );
    }
  }

  /**
   * Validate assignment archiving
   * Prevents archiving if there are pending submissions
   */
  async validateArchiving(
    assignment: Assignment,
    hasPendingSubmissions: boolean
  ): Promise<void> {
    const errors: string[] = [];
    
    if (assignment.status === 'archived') {
      errors.push('Assignment is already archived');
    }
    
    // Warn if archiving published assignment with pending work
    if (assignment.status === 'published' && hasPendingSubmissions) {
      errors.push('Assignment has pending student submissions. Consider grading all submissions before archiving.');
    }
    
    if (errors.length > 0) {
      throw new AcademicException(
        AcademicErrorCode.ASSIGNMENT_ARCHIVED,
        'Archiving validation failed',
        HttpStatus.BAD_REQUEST,
        { errors, assignmentId: assignment.assignmentId }
      );
    }
  }
}


