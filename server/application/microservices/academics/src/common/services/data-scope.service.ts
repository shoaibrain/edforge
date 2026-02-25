/**
 * Data Scope Service — Row-level security for ABAC
 *
 * Determines what data a user can access based on their school role.
 * Inspired by Ed-Fi Analytics Middle Tier data scope patterns:
 *
 *   - School scope: Principal, VicePrincipal, Staff, Counselor, Nurse, Accountant
 *     → can view all data within their school
 *   - Section scope: Teacher
 *     → can only view data for students in their assigned sections
 *   - Student scope: Parent (children), Student (self)
 *     → can only view data for specific student IDs
 *
 * Usage:
 *   const scope = await dataScopeService.resolveScope(userId, schoolId, context);
 *   if (scope.type === 'section') {
 *     // filter results to scope.studentIds
 *   }
 *
 * Design: Fail-open for MVP — if scope resolution fails, defaults to school scope.
 * This preserves existing behavior while adding scoping where possible.
 */

import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { IdentityClientService } from './identity-client.service';
import { DynamoDBClientService } from './dynamodb-client.service';
import { RequestContext, GSIKeyBuilder } from '../entities';
import type { CourseSection } from '../entities/course.entity';
import type { SectionEnrollment } from '../entities/section-enrollment.entity';

/**
 * Data scope describing what rows a user can access
 */
export interface DataScope {
  /** Scope level: school (all data), section (teacher's students), student (specific IDs) */
  type: 'school' | 'section' | 'student';
  schoolId: string;
  /** Section IDs the user is assigned to (section scope) */
  sectionIds?: string[];
  /** Student IDs the user can access (section/student scope) */
  studentIds?: string[];
  /** The user's resolved role at this school */
  role?: string;
}

/** Roles that get full school-level data access */
const SCHOOL_SCOPE_ROLES = new Set([
  'Principal',
  'VicePrincipal',
  'Accountant',
  'Counselor',
  'Nurse',
  'Staff',
]);

@Injectable()
export class DataScopeService {
  private readonly logger = new Logger(DataScopeService.name);

  constructor(
    private readonly identityClient: IdentityClientService,
    private readonly dynamoDBClient: DynamoDBClientService,
  ) {}

  /**
   * Resolve the data scope for a user at a specific school.
   *
   * @param userId - The user whose scope to resolve
   * @param schoolId - The school context
   * @param context - Academics RequestContext (with email, jwtToken, etc.)
   * @returns DataScope describing what data the user can access
   */
  async resolveScope(
    userId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<DataScope> {
    // TenantAdmin sees everything
    if (context.role === 'TenantAdmin') {
      return { type: 'school', schoolId, role: 'TenantAdmin' };
    }

    try {
      // Build HTTP context for identity service calls
      const httpContext = {
        tenantId: context.tenantId,
        userId: context.userId,
        jwtToken: context.jwtToken,
        userRole: context.role,
      };

      // Look up the user's role at this school via identity service
      const roleResponse = await this.identityClient.getUserRole(
        userId, schoolId, httpContext, context.email,
      );

      if (!roleResponse) {
        this.logger.warn(`No role found for user ${userId} at school ${schoolId} — defaulting to school scope`);
        return { type: 'school', schoolId };
      }

      const { role, staffId } = roleResponse;

      // School-level roles: see all data in the school
      if (SCHOOL_SCOPE_ROLES.has(role)) {
        return { type: 'school', schoolId, role };
      }

      // Teacher: section-scoped (see only their students)
      if (role === 'Teacher') {
        if (!staffId) {
          // Fail-closed: Teacher without staffId gets empty scope, not school-wide
          this.logger.warn(`Teacher ${userId} has no staffId — restricting to empty scope`);
          return { type: 'section', schoolId, sectionIds: [], studentIds: [], role: 'Teacher' };
        }
        return this.resolveTeacherScope(staffId, schoolId, context);
      }

      // Student/Parent: would need student-user mapping (future sprint)
      // For MVP, fall through to school scope
      this.logger.debug(`Role '${role}' — defaulting to school scope for MVP`);
      return { type: 'school', schoolId, role };
    } catch (error: any) {
      // Configurable fail mode: fail-closed throws 403, fail-open defaults to school scope
      if (process.env.DATA_SCOPE_FAIL_CLOSED === 'true') {
        this.logger.error(`Scope resolution failed for ${userId} at ${schoolId} (fail-closed): ${error.message}`);
        throw new ForbiddenException('Unable to resolve data scope — access denied');
      }
      // Fail-open (default for MVP): if scope resolution fails, default to school scope
      // The PermissionGuard already blocked unauthorized users
      this.logger.error(`Scope resolution failed for ${userId} at ${schoolId}: ${error.message}`);
      return { type: 'school', schoolId };
    }
  }

  /**
   * Resolve a teacher's section scope by looking up their assigned sections
   * and the students enrolled in those sections.
   */
  private async resolveTeacherScope(
    staffId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<DataScope> {
    try {
      const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

      // Query GSI1 for sections at this school, filter by teacher
      // GSI1PK: TENANT#{tid}#SCHOOL#{schoolId}, GSI1SK begins_with SECTION#
      const sectionsResult = await this.dynamoDBClient.queryGSI<CourseSection>(
        client,
        'gsi1',
        GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
        'SECTION#',
        'begins_with',
        'primaryTeacherId = :teacherId AND isActive = :isActive',
        { ':teacherId': staffId, ':isActive': true },
      );

      const sectionIds = sectionsResult.items.map(s => s.sectionId);

      if (sectionIds.length === 0) {
        this.logger.debug(`Teacher ${staffId} has no sections at school ${schoolId}`);
        return { type: 'section', schoolId, sectionIds: [], studentIds: [], role: 'Teacher' };
      }

      // Get enrolled students for each section via GSI1
      // GSI1SK begins_with SEC_ENROLL#{sectionId}#
      const studentIdSet = new Set<string>();
      for (const sectionId of sectionIds) {
        const enrollments = await this.dynamoDBClient.queryGSI<SectionEnrollment>(
          client,
          'gsi1',
          GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
          `SEC_ENROLL#${sectionId}#`,
          'begins_with',
          'isActive = :isActive',
          { ':isActive': true },
        );
        for (const enrollment of enrollments.items) {
          if (enrollment.studentId) {
            studentIdSet.add(enrollment.studentId);
          }
        }
      }

      const studentIds = Array.from(studentIdSet);
      this.logger.debug(
        `Teacher ${staffId} scope: ${sectionIds.length} sections, ${studentIds.length} students`,
      );

      return {
        type: 'section',
        schoolId,
        sectionIds,
        studentIds,
        role: 'Teacher',
      };
    } catch (error: any) {
      this.logger.error(`Teacher scope resolution failed for ${staffId}: ${error.message}`);
      // Fail-open: allow school-wide access if teacher scope can't be resolved
      return { type: 'school', schoolId, role: 'Teacher' };
    }
  }

  /**
   * Check if a specific student ID is within the user's data scope.
   */
  isStudentInScope(scope: DataScope, studentId: string): boolean {
    if (scope.type === 'school') return true;
    return scope.studentIds?.includes(studentId) ?? false;
  }

  /**
   * Check if a specific section ID is within the user's data scope.
   */
  isSectionInScope(scope: DataScope, sectionId: string): boolean {
    if (scope.type === 'school') return true;
    if (scope.type === 'section') {
      return scope.sectionIds?.includes(sectionId) ?? false;
    }
    return false;
  }

  /**
   * Filter an array of items to only those within scope.
   * Items must have a studentId property.
   */
  filterByStudentScope<T extends { studentId?: string }>(scope: DataScope, items: T[]): T[] {
    if (scope.type === 'school') return items;
    if (!scope.studentIds || scope.studentIds.length === 0) return [];
    const studentIdSet = new Set(scope.studentIds);
    return items.filter(item => item.studentId && studentIdSet.has(item.studentId));
  }
}
