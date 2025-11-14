/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Enrollment Service - Custom Exceptions
 */

import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes.enum';

export class EnrollmentException extends HttpException {
  constructor(
    message: string,
    status: HttpStatus,
    public readonly errorCode: ErrorCode,
    public readonly details?: any
  ) {
    super(
      {
        message,
        errorCode,
        details,
        timestamp: new Date().toISOString()
      },
      status
    );
  }
}

export class StudentNotFoundException extends EnrollmentException {
  constructor(studentId: string) {
    super(
      `Student not found: ${studentId}`,
      HttpStatus.NOT_FOUND,
      ErrorCode.STUDENT_NOT_FOUND,
      { studentId }
    );
  }
}

export class EnrollmentNotFoundException extends EnrollmentException {
  constructor(enrollmentId: string) {
    super(
      `Enrollment not found: ${enrollmentId}`,
      HttpStatus.NOT_FOUND,
      ErrorCode.ENROLLMENT_NOT_FOUND,
      { enrollmentId }
    );
  }
}

export class CapacityExceededException extends EnrollmentException {
  constructor(schoolId: string, gradeLevel: string) {
    super(
      `School capacity exceeded for grade ${gradeLevel}`,
      HttpStatus.BAD_REQUEST,
      ErrorCode.CAPACITY_EXCEEDED,
      { schoolId, gradeLevel }
    );
  }
}

export class DuplicateEnrollmentException extends EnrollmentException {
  constructor(studentId: string, academicYearId: string) {
    super(
      `Student already enrolled in this academic year`,
      HttpStatus.CONFLICT,
      ErrorCode.DUPLICATE_ENROLLMENT,
      { studentId, academicYearId }
    );
  }
}

export class InvalidStatusTransitionException extends EnrollmentException {
  constructor(currentStatus: string, newStatus: string) {
    super(
      `Invalid status transition from ${currentStatus} to ${newStatus}`,
      HttpStatus.BAD_REQUEST,
      ErrorCode.INVALID_STATUS_TRANSITION,
      { currentStatus, newStatus }
    );
  }
}

export class InvoiceNotFoundException extends EnrollmentException {
  constructor(invoiceId: string) {
    super(
      `Invoice not found: ${invoiceId}`,
      HttpStatus.NOT_FOUND,
      ErrorCode.INVOICE_NOT_FOUND,
      { invoiceId }
    );
  }
}

export class PaymentException extends EnrollmentException {
  constructor(message: string, details?: any) {
    super(
      message,
      HttpStatus.BAD_REQUEST,
      ErrorCode.PAYMENT_ERROR,
      details
    );
  }
}

