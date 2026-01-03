/**
 * Audit Logger Service
 * 
 * Provides structured audit logging for security-sensitive operations.
 * Audit logs are:
 * 1. Written to CloudWatch Logs with structured format
 * 2. Published as events to EventBridge for compliance/alerting
 * 
 * Use this for:
 * - User creation, modification, deletion
 * - Role assignments and revocations
 * - Authentication events (login, logout, failed attempts)
 * - Data access to sensitive information
 * - Configuration changes
 */

import { Injectable, Logger } from '@nestjs/common';

export enum AuditAction {
  // User lifecycle
  USER_CREATED = 'USER_CREATED',
  USER_UPDATED = 'USER_UPDATED',
  USER_DELETED = 'USER_DELETED',
  USER_DISABLED = 'USER_DISABLED',
  USER_ENABLED = 'USER_ENABLED',
  
  // Authentication
  LOGIN_SUCCESS = 'LOGIN_SUCCESS',
  LOGIN_FAILURE = 'LOGIN_FAILURE',
  LOGOUT = 'LOGOUT',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  PASSWORD_RESET_REQUESTED = 'PASSWORD_RESET_REQUESTED',
  MFA_ENABLED = 'MFA_ENABLED',
  MFA_DISABLED = 'MFA_DISABLED',
  
  // Authorization
  ROLE_ASSIGNED = 'ROLE_ASSIGNED',
  ROLE_REVOKED = 'ROLE_REVOKED',
  PERMISSION_GRANTED = 'PERMISSION_GRANTED',
  PERMISSION_REVOKED = 'PERMISSION_REVOKED',
  
  // Data access
  SENSITIVE_DATA_ACCESSED = 'SENSITIVE_DATA_ACCESSED',
  BULK_DATA_EXPORT = 'BULK_DATA_EXPORT',
  
  // School management
  SCHOOL_CREATED = 'SCHOOL_CREATED',
  SCHOOL_UPDATED = 'SCHOOL_UPDATED',
  SCHOOL_DELETED = 'SCHOOL_DELETED',
  SCHOOL_CONFIG_CHANGED = 'SCHOOL_CONFIG_CHANGED',
  
  // Tenant management
  TENANT_CREATED = 'TENANT_CREATED',
  TENANT_UPDATED = 'TENANT_UPDATED',
  TENANT_SUSPENDED = 'TENANT_SUSPENDED',
  TENANT_ACTIVATED = 'TENANT_ACTIVATED',
  
  // Student operations
  STUDENT_CREATED = 'STUDENT_CREATED',
  STUDENT_UPDATED = 'STUDENT_UPDATED',
  STUDENT_ENROLLED = 'STUDENT_ENROLLED',
  STUDENT_WITHDRAWN = 'STUDENT_WITHDRAWN',
  STUDENT_TRANSFERRED = 'STUDENT_TRANSFERRED',
}

export enum AuditSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export interface AuditContext {
  tenantId: string;
  userId: string;
  userEmail?: string;
  userRole?: string;
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditEntry {
  timestamp: string;
  action: AuditAction;
  severity: AuditSeverity;
  service: string;
  context: AuditContext;
  targetEntity: {
    type: string;
    id: string;
    name?: string;
  };
  details: Record<string, any>;
  outcome: 'SUCCESS' | 'FAILURE';
  errorMessage?: string;
}

@Injectable()
export class AuditLoggerService {
  private readonly logger = new Logger('AUDIT');
  private readonly serviceName: string;

  constructor(serviceName?: string) {
    this.serviceName = serviceName || process.env.SERVICE_NAME || 'edforge-service';
  }

  /**
   * Log an audit event
   */
  log(
    action: AuditAction,
    context: AuditContext,
    target: { type: string; id: string; name?: string },
    details: Record<string, any> = {},
    outcome: 'SUCCESS' | 'FAILURE' = 'SUCCESS',
    errorMessage?: string
  ): void {
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      action,
      severity: this.getSeverity(action),
      service: this.serviceName,
      context: {
        ...context,
        // Sanitize sensitive data
        userId: context.userId,
        tenantId: context.tenantId,
      },
      targetEntity: target,
      details: this.sanitizeDetails(details),
      outcome,
      errorMessage,
    };

    // Always log to CloudWatch as structured JSON
    if (outcome === 'FAILURE' || entry.severity === AuditSeverity.CRITICAL) {
      this.logger.error(JSON.stringify(entry));
    } else if (entry.severity === AuditSeverity.HIGH) {
      this.logger.warn(JSON.stringify(entry));
    } else {
      this.logger.log(JSON.stringify(entry));
    }
  }

  /**
   * Log user creation
   */
  logUserCreated(
    context: AuditContext,
    userId: string,
    email: string,
    globalRole: string
  ): void {
    this.log(
      AuditAction.USER_CREATED,
      context,
      { type: 'USER', id: userId, name: email },
      { globalRole, email },
      'SUCCESS'
    );
  }

  /**
   * Log user update
   */
  logUserUpdated(
    context: AuditContext,
    userId: string,
    email: string,
    updatedFields: string[]
  ): void {
    this.log(
      AuditAction.USER_UPDATED,
      context,
      { type: 'USER', id: userId, name: email },
      { updatedFields },
      'SUCCESS'
    );
  }

  /**
   * Log user deletion
   */
  logUserDeleted(
    context: AuditContext,
    userId: string,
    email: string
  ): void {
    this.log(
      AuditAction.USER_DELETED,
      context,
      { type: 'USER', id: userId, name: email },
      {},
      'SUCCESS'
    );
  }

  /**
   * Log role assignment
   */
  logRoleAssigned(
    context: AuditContext,
    targetUserId: string,
    role: string,
    schoolId?: string
  ): void {
    this.log(
      AuditAction.ROLE_ASSIGNED,
      context,
      { type: 'USER', id: targetUserId },
      { role, schoolId, scope: schoolId ? 'school' : 'global' },
      'SUCCESS'
    );
  }

  /**
   * Log role revocation
   */
  logRoleRevoked(
    context: AuditContext,
    targetUserId: string,
    role: string,
    schoolId?: string
  ): void {
    this.log(
      AuditAction.ROLE_REVOKED,
      context,
      { type: 'USER', id: targetUserId },
      { role, schoolId, scope: schoolId ? 'school' : 'global' },
      'SUCCESS'
    );
  }

  /**
   * Log login success
   */
  logLoginSuccess(
    context: AuditContext
  ): void {
    this.log(
      AuditAction.LOGIN_SUCCESS,
      context,
      { type: 'SESSION', id: context.userId },
      {},
      'SUCCESS'
    );
  }

  /**
   * Log login failure
   */
  logLoginFailure(
    context: AuditContext,
    reason: string
  ): void {
    this.log(
      AuditAction.LOGIN_FAILURE,
      context,
      { type: 'SESSION', id: context.userEmail || 'unknown' },
      { reason },
      'FAILURE',
      reason
    );
  }

  /**
   * Log school creation
   */
  logSchoolCreated(
    context: AuditContext,
    schoolId: string,
    schoolName: string
  ): void {
    this.log(
      AuditAction.SCHOOL_CREATED,
      context,
      { type: 'SCHOOL', id: schoolId, name: schoolName },
      {},
      'SUCCESS'
    );
  }

  /**
   * Log school configuration change
   */
  logSchoolConfigChanged(
    context: AuditContext,
    schoolId: string,
    changedSettings: string[]
  ): void {
    this.log(
      AuditAction.SCHOOL_CONFIG_CHANGED,
      context,
      { type: 'SCHOOL', id: schoolId },
      { changedSettings },
      'SUCCESS'
    );
  }

  /**
   * Log student created
   */
  logStudentCreated(
    context: AuditContext,
    studentId: string,
    schoolId: string
  ): void {
    this.log(
      AuditAction.STUDENT_CREATED,
      context,
      { type: 'STUDENT', id: studentId },
      { schoolId },
      'SUCCESS'
    );
  }

  /**
   * Log student enrollment
   */
  logStudentEnrolled(
    context: AuditContext,
    studentId: string,
    schoolId: string,
    academicYearId: string,
    gradeLevel: string
  ): void {
    this.log(
      AuditAction.STUDENT_ENROLLED,
      context,
      { type: 'STUDENT', id: studentId },
      { schoolId, academicYearId, gradeLevel },
      'SUCCESS'
    );
  }

  /**
   * Determine severity based on action type
   */
  private getSeverity(action: AuditAction): AuditSeverity {
    const criticalActions = [
      AuditAction.USER_DELETED,
      AuditAction.TENANT_SUSPENDED,
      AuditAction.BULK_DATA_EXPORT,
    ];

    const highActions = [
      AuditAction.ROLE_ASSIGNED,
      AuditAction.ROLE_REVOKED,
      AuditAction.PERMISSION_GRANTED,
      AuditAction.PERMISSION_REVOKED,
      AuditAction.LOGIN_FAILURE,
      AuditAction.PASSWORD_CHANGED,
      AuditAction.MFA_DISABLED,
      AuditAction.USER_DISABLED,
    ];

    const mediumActions = [
      AuditAction.USER_CREATED,
      AuditAction.USER_UPDATED,
      AuditAction.SCHOOL_CREATED,
      AuditAction.SCHOOL_CONFIG_CHANGED,
      AuditAction.STUDENT_ENROLLED,
      AuditAction.STUDENT_WITHDRAWN,
      AuditAction.STUDENT_TRANSFERRED,
    ];

    if (criticalActions.includes(action)) {
      return AuditSeverity.CRITICAL;
    }
    if (highActions.includes(action)) {
      return AuditSeverity.HIGH;
    }
    if (mediumActions.includes(action)) {
      return AuditSeverity.MEDIUM;
    }
    return AuditSeverity.LOW;
  }

  /**
   * Sanitize details to remove sensitive information
   */
  private sanitizeDetails(details: Record<string, any>): Record<string, any> {
    const sensitiveFields = [
      'password', 'token', 'secret', 'ssn', 'creditCard',
      'apiKey', 'accessKey', 'secretKey', 'privateKey'
    ];

    const sanitized = { ...details };
    
    for (const key of Object.keys(sanitized)) {
      if (sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
        sanitized[key] = this.sanitizeDetails(sanitized[key]);
      }
    }

    return sanitized;
  }
}

