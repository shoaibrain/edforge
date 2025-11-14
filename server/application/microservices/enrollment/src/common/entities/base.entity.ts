/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Enrollment Service Entities - Base Entity and Entity Key Builder
 * 
 * ARCHITECTURE NOTES:
 * - All entities stored in ONE DynamoDB table: school-table-{tier}
 * - Partition Key (PK): tenantId - ensures tenant isolation at infrastructure level
 * - Sort Key (SK): entityKey - hierarchical structure for entity relationships
 * - GSIs enable efficient queries across entity types
 * - Optimistic locking via version field prevents concurrent modification issues
 * - All timestamps in ISO 8601 format for global compatibility
 * 
 * Uses shared types from @edforge/shared-types for consistency
 */

// Re-export from shared-types
export type { BaseEntity, Address } from '@edforge/shared-types';

// RequestContext for enrollment service (extends shared RequestContext with additional fields)
export interface RequestContext {
  tenantId: string;
  userId: string;
  userRole: string;
  userName?: string;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  jwtToken?: string; // Optional for compatibility with shared RequestContext
}

/**
 * Entity Key Builder - Constructs hierarchical entity keys
 * 
 * PATTERNS:
 * - Student: STUDENT#studentId
 * - Enrollment: SCHOOL#schoolId#YEAR#yearId#STUDENT#studentId#ENROLLMENT
 * - Staff: STAFF#staffId
 * - Parent: PARENT#parentId
 * - Invoice: SCHOOL#schoolId#YEAR#yearId#STUDENT#studentId#INVOICE#invoiceId
 * - Payment: INVOICE#invoiceId#PAYMENT#paymentId
 */
export class EntityKeyBuilder {
  // Student
  static student(studentId: string): string {
    return `STUDENT#${studentId}`;
  }

  // Enrollment
  static enrollment(schoolId: string, academicYearId: string, studentId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#STUDENT#${studentId}#ENROLLMENT`;
  }

  // Staff
  static staff(staffId: string): string {
    return `STAFF#${staffId}`;
  }

  // Parent
  static parent(parentId: string): string {
    return `PARENT#${parentId}`;
  }

  // Tuition Configuration
  static tuitionConfig(schoolId: string, academicYearId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#TUITION_CONFIG`;
  }

  // Billing Account
  static billingAccount(schoolId: string, academicYearId: string, studentId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#STUDENT#${studentId}#ACCOUNT`;
  }

  // Invoice
  static invoice(schoolId: string, academicYearId: string, studentId: string, invoiceId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#STUDENT#${studentId}#INVOICE#${invoiceId}`;
  }

  // Payment
  static payment(invoiceId: string, paymentId: string): string {
    return `INVOICE#${invoiceId}#PAYMENT#${paymentId}`;
  }
}

