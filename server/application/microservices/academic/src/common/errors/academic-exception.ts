/**
 * Custom exception class for Academic module
 * Provides standardized error responses with error codes
 */

import { HttpException, HttpStatus } from '@nestjs/common';
import { AcademicErrorCode } from './error-codes.enum';

export interface AcademicErrorResponse {
  errorCode: AcademicErrorCode;
  message: string;
  details?: any;
  timestamp: string;
}

export class AcademicException extends HttpException {
  public readonly errorCode: AcademicErrorCode;
  public readonly details?: any;

  constructor(
    errorCode: AcademicErrorCode,
    message: string,
    statusCode: HttpStatus = HttpStatus.BAD_REQUEST,
    details?: any
  ) {
    const response: AcademicErrorResponse = {
      errorCode,
      message,
      details,
      timestamp: new Date().toISOString()
    };

    super(response, statusCode);
    this.errorCode = errorCode;
    this.details = details;
  }
}

/**
 * Convenience factory methods for common errors
 * Provides consistent error messages and codes across the application
 */
export class AcademicErrors {
  
  // ==================== Classroom Errors ====================
  
  static classroomNotFound(classroomId: string) {
    return new AcademicException(
      AcademicErrorCode.CLASSROOM_NOT_FOUND,
      `Classroom ${classroomId} not found`,
      HttpStatus.NOT_FOUND,
      { classroomId }
    );
  }
  
  static classroomAtCapacity(classroomId: string, capacity: number) {
    return new AcademicException(
      AcademicErrorCode.CLASSROOM_AT_CAPACITY,
      `Classroom ${classroomId} is at full capacity (${capacity} students)`,
      HttpStatus.BAD_REQUEST,
      { classroomId, capacity }
    );
  }
  
  static classroomCodeDuplicate(code: string) {
    return new AcademicException(
      AcademicErrorCode.CLASSROOM_CODE_DUPLICATE,
      `Classroom code ${code} already exists`,
      HttpStatus.CONFLICT,
      { code }
    );
  }

  static classroomInactive(classroomId: string) {
    return new AcademicException(
      AcademicErrorCode.CLASSROOM_INACTIVE,
      `Classroom ${classroomId} is not active`,
      HttpStatus.BAD_REQUEST,
      { classroomId }
    );
  }
  
  // ==================== Enrollment Errors ====================
  
  static studentAlreadyEnrolled(studentId: string, classroomId: string) {
    return new AcademicException(
      AcademicErrorCode.STUDENT_ALREADY_ENROLLED,
      `Student ${studentId} is already enrolled in classroom ${classroomId}`,
      HttpStatus.CONFLICT,
      { studentId, classroomId }
    );
  }
  
  static studentNotEnrolled(studentId: string, classroomId: string) {
    return new AcademicException(
      AcademicErrorCode.STUDENT_NOT_ENROLLED,
      `Student ${studentId} is not enrolled in classroom ${classroomId}`,
      HttpStatus.NOT_FOUND,
      { studentId, classroomId }
    );
  }
  
  static studentNotFound(studentId: string) {
    return new AcademicException(
      AcademicErrorCode.STUDENT_NOT_FOUND,
      `Student ${studentId} not found`,
      HttpStatus.NOT_FOUND,
      { studentId }
    );
  }
  
  // ==================== Assignment Errors ====================
  
  static assignmentNotFound(assignmentId: string) {
    return new AcademicException(
      AcademicErrorCode.ASSIGNMENT_NOT_FOUND,
      `Assignment ${assignmentId} not found`,
      HttpStatus.NOT_FOUND,
      { assignmentId }
    );
  }
  
  static assignmentAlreadyPublished(assignmentId: string) {
    return new AcademicException(
      AcademicErrorCode.ASSIGNMENT_ALREADY_PUBLISHED,
      `Assignment ${assignmentId} is already published and cannot be modified`,
      HttpStatus.BAD_REQUEST,
      { assignmentId }
    );
  }
  
  static assignmentInvalidDates(assignedDate: string, dueDate: string) {
    return new AcademicException(
      AcademicErrorCode.ASSIGNMENT_INVALID_DATES,
      `Due date must be after assigned date`,
      HttpStatus.BAD_REQUEST,
      { assignedDate, dueDate }
    );
  }
  
  // ==================== Grading Errors ====================
  
  static gradeNotFound(gradeId: string) {
    return new AcademicException(
      AcademicErrorCode.GRADE_NOT_FOUND,
      `Grade ${gradeId} not found`,
      HttpStatus.NOT_FOUND,
      { gradeId }
    );
  }
  
  static gradeAlreadyExists(studentId: string, assignmentId: string) {
    return new AcademicException(
      AcademicErrorCode.GRADE_ALREADY_EXISTS,
      `Grade already exists for student ${studentId} on assignment ${assignmentId}`,
      HttpStatus.CONFLICT,
      { studentId, assignmentId }
    );
  }
  
  static gradeInvalidScore(score: number, maxPoints: number) {
    return new AcademicException(
      AcademicErrorCode.GRADE_INVALID_SCORE,
      `Score ${score} exceeds maximum points ${maxPoints}`,
      HttpStatus.BAD_REQUEST,
      { score, maxPoints }
    );
  }
  
  static gradeScaleNotFound(scaleId: string) {
    return new AcademicException(
      AcademicErrorCode.GRADE_SCALE_NOT_FOUND,
      `Grading scale ${scaleId} not found`,
      HttpStatus.NOT_FOUND,
      { scaleId }
    );
  }
  
  // ==================== Attendance Errors ====================
  
  static attendanceNotFound(attendanceId: string) {
    return new AcademicException(
      AcademicErrorCode.ATTENDANCE_NOT_FOUND,
      `Attendance record ${attendanceId} not found`,
      HttpStatus.NOT_FOUND,
      { attendanceId }
    );
  }
  
  static attendanceAlreadyRecorded(studentId: string, date: string) {
    return new AcademicException(
      AcademicErrorCode.ATTENDANCE_ALREADY_RECORDED,
      `Attendance already recorded for student ${studentId} on ${date}`,
      HttpStatus.CONFLICT,
      { studentId, date }
    );
  }
  
  static attendanceFutureDate(date: string) {
    return new AcademicException(
      AcademicErrorCode.ATTENDANCE_FUTURE_DATE,
      `Cannot record attendance for future date: ${date}`,
      HttpStatus.BAD_REQUEST,
      { date }
    );
  }
  
  // ==================== General Errors ====================
  
  static concurrentModification(resource: string, resourceId: string) {
    return new AcademicException(
      AcademicErrorCode.CONCURRENT_MODIFICATION,
      `${resource} ${resourceId} was modified by another user. Please refresh and try again.`,
      HttpStatus.CONFLICT,
      { resource, resourceId, retryable: true }
    );
  }
  
  static validationFailed(errors: string[]) {
    return new AcademicException(
      AcademicErrorCode.VALIDATION_FAILED,
      'Validation failed',
      HttpStatus.BAD_REQUEST,
      { errors }
    );
  }
  
  static unauthorizedAccess(resource: string, action: string) {
    return new AcademicException(
      AcademicErrorCode.UNAUTHORIZED_ACCESS,
      `You are not authorized to ${action} this ${resource}`,
      HttpStatus.FORBIDDEN,
      { resource, action }
    );
  }
  
  static internalError(message: string, error?: any) {
    return new AcademicException(
      AcademicErrorCode.INTERNAL_ERROR,
      message || 'An internal error occurred',
      HttpStatus.INTERNAL_SERVER_ERROR,
      { originalError: error?.message }
    );
  }
}

